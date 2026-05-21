import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createAudienceDraft,
  getAudienceById,
  listSplitChildAudiences,
  updateAudience,
} from "@/lib/db/meta-custom-audiences";
import type { Database } from "@/lib/db/database.types";
import {
  metaAudienceIdempotencyKey,
  withMetaAudienceWriteIdempotency,
} from "@/lib/meta/audience-idempotency";
import {
  buildMetaCustomAudiencePayload,
  chunkPageIds,
  chunkVideoIds,
  MAX_PAGE_ENGAGEMENT_SOURCES,
  MAX_VIDEO_VIEWS_VIDEOS,
  pageEngagementPageIds,
  partAudienceName,
  stripPartSuffix,
} from "@/lib/meta/audience-payload";
import { withActPrefix } from "@/lib/meta/ad-account-id";
import { MetaApiError } from "@/lib/meta/client";
import {
  businessSharedPages,
  pageLabel,
  resolvePageAccess,
  type PageAccessResult,
} from "@/lib/meta/page-access";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient } from "@/lib/supabase/server";
import type {
  MetaCustomAudience,
  MetaCustomAudienceInsert,
} from "@/lib/types/audience";

type TypedSupabaseClient = SupabaseClient<Database>;

// The structural client the idempotency helper accepts. Annotating internal
// helpers with this (instead of the full SupabaseClient<Database>) avoids TS
// "excessively deep" instantiation when the client crosses a call boundary.
type IdempotencyClient = Parameters<typeof withMetaAudienceWriteIdempotency>[0];

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

export { buildMetaCustomAudiencePayload } from "@/lib/meta/audience-payload";

export interface MetaAudienceWriteSuccess {
  audienceId: string;
  metaAudienceId: string;
}

export interface MetaAudienceWriteFailure {
  audienceId: string;
  error: string;
}

export interface MetaAudienceBatchResult {
  successes: MetaAudienceWriteSuccess[];
  failures: MetaAudienceWriteFailure[];
}

export type MetaAudiencePost = (
  path: string,
  body: Record<string, string>,
  token: string,
) => Promise<{ id: string }>;

/** Page-access resolver — injectable so the pre-filter is testable offline. */
export type MetaPageAccessResolver = (
  pageIds: string[],
  token: string,
) => Promise<PageAccessResult>;

/**
 * Subtypes whose multi-page source set Meta builds atomically and that the
 * access prefilter can actually validate.
 *
 * page_engagement_ig is INTENTIONALLY excluded: its source picker
 * (components/audiences/source-picker.tsx IgSourcePicker) stores **Instagram
 * Business Account IDs** (1784140…-prefix) in `pageIds`, not the linked FB Page
 * IDs. The prefilter resolves access against FB Pages (per-page `tasks` probe +
 * the BM owned/client_pages list), so it can't validate IG account IDs —
 * probing them errors (#100, no `tasks` field on IGUser) and they never match
 * the FB-page BM list, which would false-drop every IG page. Excluding IG sends
 * those audiences straight to Meta (pre-#425 behaviour). Proper IG→FB-page
 * mapping is a separate fix tracked outside this PR.
 */
const PAGE_ENGAGEMENT_SUBTYPES = new Set(["page_engagement_fb"]);

/**
 * Subtypes built from a multi-page source set that Meta caps at
 * {@link MAX_PAGE_ENGAGEMENT_SOURCES} sources per audience. All four share the
 * `inclusions.rules` (one OR'd rule per source) shape, so an oversized set is
 * split into multiple ≤5-source audiences. Unlike the prefilter (FB only),
 * chunking is purely a count limit, so it applies to IG and followers too —
 * the cap is enforced regardless of how access is resolved.
 */
const CHUNKABLE_SUBTYPES = new Set([
  "page_engagement_fb",
  "page_engagement_ig",
  "page_followers_fb",
  "page_followers_ig",
]);

export function metaAudienceWritesEnabled(): boolean {
  return process.env.OFFPIXEL_META_AUDIENCE_WRITES_ENABLED === "true";
}

export function assertMetaAudienceWritesEnabled() {
  if (!metaAudienceWritesEnabled()) {
    throw new Error("Meta audience writes are disabled");
  }
}

export async function createMetaCustomAudience(
  audienceId: string,
  options: {
    userId: string;
    supabase?: TypedSupabaseClient;
    request?: MetaAudiencePost;
    pageAccess?: MetaPageAccessResolver;
  },
): Promise<MetaCustomAudience> {
  assertMetaAudienceWritesEnabled();
  const supabase = options.supabase ?? (await createClient());
  const audience = await getAudienceById(audienceId);
  if (!audience || audience.userId !== options.userId) {
    throw new Error("Audience not found");
  }
  if (audience.status !== "draft" && audience.status !== "failed") {
    throw new Error("Only draft or failed audiences can be created on Meta");
  }

  const { token } = await resolveServerMetaToken(supabase, options.userId);
  const idempotencyKey = metaAudienceIdempotencyKey(audience.id, options.userId);

  await updateAudience(audience.id, { status: "creating", statusError: null });
  try {
    const { audience: audienceForWrite, warning } =
      await prefilterPageEngagementAccess(audience, token, {
        supabase,
        override: options.pageAccess,
      });
    const post = options.request ?? postMetaAudienceForm;
    const pageIds = pageEngagementPageIds(audienceForWrite);

    // Oversized page-engagement set → split into ≤5-source audiences (Meta's
    // hard cap). Returns the primary row; extra parts are persisted as siblings.
    if (
      CHUNKABLE_SUBTYPES.has(audience.audienceSubtype) &&
      pageIds.length > MAX_PAGE_ENGAGEMENT_SOURCES
    ) {
      return await writeSplitPageEngagement({
        supabase,
        audience,
        audienceForWrite,
        pageIds,
        token,
        post,
        userId: options.userId,
        warning,
      });
    }

    // Oversized video-views set → split into ≤200-video audiences (Meta's
    // hard cap, #2654 subcode 1870231). Same two-phase write as page split.
    if (audience.audienceSubtype === "video_views") {
      const videoIds = videoViewVideoIds(audienceForWrite);
      if (videoIds.length > MAX_VIDEO_VIEWS_VIDEOS) {
        return await writeSplitVideoViews({
          supabase,
          audience,
          videoIds,
          token,
          post,
          userId: options.userId,
        });
      }
    }

    const payload = buildMetaCustomAudiencePayload(audienceForWrite);
    const metaAudienceId = await createOneMetaAudience({
      payload,
      adAccountId: audience.metaAdAccountId,
      token,
      post,
      supabase,
      idempotencyKey,
      userId: options.userId,
      audienceId: audience.id,
    });

    const updated = await updateAudience(audience.id, {
      status: "ready",
      metaAudienceId,
      // Non-fatal warning (dropped pages) recorded on a successful create.
      statusError: warning,
    });
    if (!updated) throw new Error("Audience not found after Meta write");
    return updated;
  } catch (err) {
    const message = formatMetaWriteError(err);
    const updated = await updateAudience(audience.id, {
      status: "failed",
      statusError: message,
    });
    if (updated) return updated;
    throw err;
  }
}

/**
 * For multi-page page-engagement audiences, drop pages we can't access BEFORE
 * building the rule, so Meta doesn't atomically reject the whole create with
 * #200 subcode 1713153. Returns the (possibly rewritten) audience plus a
 * non-fatal warning when some pages were dropped.
 *
 *   - 0 pages accessible → throws (caught upstream → status "failed").
 *   - some accessible    → builds from the accessible subset + warning.
 *   - all accessible     → audience unchanged, no warning.
 *
 * Access is resolved from TWO sources (see resolvePageAccess): the per-page
 * tasks probe AND the client's Business Manager page list (owned + partner-
 * shared). The BM list rescues "Ads and Insights" partner-shared pages whose
 * personal-token tasks probe is empty. If the client has no meta_business_id we
 * fall back to the per-page probe alone.
 *
 * Single-page audiences are left untouched: there is no atomic-set hazard, and
 * Meta's own error is clear enough for the one-page case.
 */
async function prefilterPageEngagementAccess(
  audience: MetaCustomAudience,
  token: string,
  deps: {
    supabase: TypedSupabaseClient;
    /** Test/override hook — when set, bypasses BM resolution entirely. */
    override?: MetaPageAccessResolver;
  },
): Promise<{ audience: MetaCustomAudience; warning: string | null }> {
  if (!PAGE_ENGAGEMENT_SUBTYPES.has(audience.audienceSubtype)) {
    return { audience, warning: null };
  }

  const requested = pageEngagementPageIds(audience);
  if (requested.length <= 1) {
    return { audience, warning: null };
  }

  const resolve =
    deps.override ?? (await buildBmAwareResolver(deps.supabase, audience));
  const { accessiblePageIds, dropped, names } = await resolve(requested, token);
  const totalDistinct = accessiblePageIds.length + dropped.length;

  if (accessiblePageIds.length === 0) {
    const blocked = dropped.map((d) => pageLabel(d.pageId, names)).join(", ");
    throw new Error(
      `No accessible pages — neither your token nor the client's Business ` +
        `Manager can access: ${blocked}. Ask the client to grant page access.`,
    );
  }

  if (dropped.length === 0) {
    return { audience, warning: null };
  }

  const droppedLabels = dropped.map((d) => pageLabel(d.pageId, names)).join(", ");
  const warning =
    `Created from ${accessiblePageIds.length} of ${totalDistinct} pages. ` +
    `Dropped (no token or BM access): ${droppedLabels}.`;
  console.warn(`[audience-write] ${audience.id}: ${warning}`);

  return { audience: withPageIds(audience, accessiblePageIds), warning };
}

/**
 * Build a page-access resolver wired to the client's Business Manager. Resolves
 * the client's stored `meta_business_id`; when present, the resolver also checks
 * the BM owned/partner-shared page list. When absent, it degrades to the
 * per-page tasks probe alone (PR #425 behaviour).
 */
async function buildBmAwareResolver(
  supabase: TypedSupabaseClient,
  audience: MetaCustomAudience,
): Promise<MetaPageAccessResolver> {
  const businessId = await resolveClientBusinessId(supabase, audience.clientId);
  const businessPages = businessId ? businessSharedPages(businessId) : undefined;
  if (!businessId) {
    console.warn(
      `[audience-write] ${audience.id}: client ${audience.clientId} has no ` +
        `meta_business_id — falling back to user-token-only page access probe.`,
    );
  }
  return (pageIds, tok) => resolvePageAccess(pageIds, tok, { businessPages });
}

/** Read the client's stored Meta Business Manager id; null if unset or on error. */
async function resolveClientBusinessId(
  supabase: TypedSupabaseClient,
  clientId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("clients")
      .select("meta_business_id")
      .eq("id", clientId)
      .maybeSingle();
    if (error) {
      console.warn(
        `[audience-write] meta_business_id lookup failed for client ${clientId}: ${error.message}`,
      );
      return null;
    }
    const bid = (data as { meta_business_id?: string | null } | null)
      ?.meta_business_id;
    return bid && bid.trim() ? bid.trim() : null;
  } catch (err) {
    console.warn(
      "[audience-write] meta_business_id lookup threw:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/** Shallow clone with the page source narrowed to `pageIds` (accessible subset). */
function withPageIds(
  audience: MetaCustomAudience,
  pageIds: string[],
): MetaCustomAudience {
  return {
    ...audience,
    sourceId: pageIds.join(","),
    sourceMeta: { ...(audience.sourceMeta as Record<string, unknown>), pageIds },
  };
}

/** Create one Custom Audience on Meta (idempotent). Returns the Meta audience id. */
async function createOneMetaAudience(args: {
  payload: Record<string, string>;
  adAccountId: string;
  token: string;
  post: MetaAudiencePost;
  supabase: IdempotencyClient;
  idempotencyKey: string;
  userId: string;
  audienceId: string;
}): Promise<string> {
  return withMetaAudienceWriteIdempotency(
    args.supabase,
    {
      idempotencyKey: args.idempotencyKey,
      userId: args.userId,
      audienceId: args.audienceId,
    },
    async () => {
      const result = await args.post(
        `/${withActPrefix(args.adAccountId)}/customaudiences`,
        args.payload,
        args.token,
      );
      if (!result.id) throw new Error("Meta returned no audience id");
      return result.id;
    },
  );
}

/**
 * Split an oversized page-engagement source set into multiple ≤5-source Custom
 * Audiences (Meta's hard cap; see {@link MAX_PAGE_ENGAGEMENT_SOURCES}). Each part
 * is a valid OR'd-rules audience; together they mean "engaged with ANY of these
 * pages" once both are selected at ad-set targeting.
 *
 * Two phases keep retries safe:
 *   1. Create EVERY part's Meta audience first (idempotent per part). No DB row is
 *      mutated until all Meta creates succeed, so a mid-way failure leaves the
 *      original row intact (full page set) for a clean re-chunk on retry.
 *   2. Persist rows: extra parts as sibling rows (find-or-create by
 *      source_meta.splitParentId, so a retry never duplicates them), primary row
 *      updated LAST so it only flips to "ready" once every sibling exists.
 *
 * Returns the primary (part 1) row; siblings surface in the UI on refresh.
 */
async function writeSplitPageEngagement(args: {
  supabase: IdempotencyClient;
  audience: MetaCustomAudience;
  audienceForWrite: MetaCustomAudience;
  pageIds: string[];
  token: string;
  post: MetaAudiencePost;
  userId: string;
  warning: string | null;
}): Promise<MetaCustomAudience> {
  const { supabase, audience, audienceForWrite, pageIds, token, post, userId, warning } =
    args;
  const chunks = chunkPageIds(pageIds, MAX_PAGE_ENGAGEMENT_SOURCES);
  const total = chunks.length;
  const baseName = stripPartSuffix(audience.name);
  console.log(
    `[audience-write] ${audience.id}: ${pageIds.length} sources exceed Meta's ` +
      `${MAX_PAGE_ENGAGEMENT_SOURCES}-source cap — splitting into ${total} audiences.`,
  );

  // Phase 1 — create all Meta audiences (idempotent per part). No row writes yet.
  const metaIds: string[] = [];
  for (let part = 0; part < total; part++) {
    const partAudience = withPageIds(
      { ...audienceForWrite, name: partAudienceName(baseName, part, total) },
      chunks[part],
    );
    const metaId = await createOneMetaAudience({
      payload: buildMetaCustomAudiencePayload(partAudience),
      adAccountId: audience.metaAdAccountId,
      token,
      post,
      supabase,
      idempotencyKey: metaAudienceIdempotencyKey(audience.id, userId, part),
      userId,
      audienceId: audience.id,
    });
    metaIds.push(metaId);
  }

  // Phase 2 — persist rows. Siblings first (find-or-create), primary last.
  const existingByPart = new Map<number, string>();
  for (const child of await listSplitChildAudiences(audience.id)) {
    const part = Number((child.sourceMeta as Record<string, unknown>).splitPart);
    if (Number.isInteger(part)) existingByPart.set(part, child.id);
  }

  for (let part = 1; part < total; part++) {
    const name = partAudienceName(baseName, part, total);
    const sourceMeta = splitPartSourceMeta(audienceForWrite.sourceMeta, chunks[part], {
      splitParentId: audience.id,
      splitPart: part,
      splitTotal: total,
    });
    const childId =
      existingByPart.get(part) ??
      (await createAudienceDraft(splitChildInsert(audience, name, chunks[part], sourceMeta)))
        .id;
    await updateAudience(childId, {
      status: "ready",
      metaAudienceId: metaIds[part],
      name,
      sourceId: chunks[part].join(","),
      sourceMeta,
      statusError: null,
    });
  }

  const primary = await updateAudience(audience.id, {
    status: "ready",
    metaAudienceId: metaIds[0],
    name: partAudienceName(baseName, 0, total),
    sourceId: chunks[0].join(","),
    sourceMeta: splitPartSourceMeta(audienceForWrite.sourceMeta, chunks[0], {
      splitPart: 0,
      splitTotal: total,
    }),
    statusError: warning,
  });
  if (!primary) throw new Error("Audience not found after Meta write");
  return primary;
}

/** source_meta for a page-engagement split part: narrow pageIds + add split markers. */
function splitPartSourceMeta(
  parentMeta: MetaCustomAudience["sourceMeta"],
  chunk: string[],
  markers: { splitParentId?: string; splitPart: number; splitTotal: number },
): Record<string, unknown> {
  return {
    ...(parentMeta as Record<string, unknown>),
    pageIds: chunk,
    ...markers,
  };
}

/** source_meta for a video-views split part: narrow videoIds + add split markers. */
function videoSplitPartSourceMeta(
  parentMeta: MetaCustomAudience["sourceMeta"],
  chunk: string[],
  markers: { splitParentId?: string; splitPart: number; splitTotal: number },
): Record<string, unknown> {
  return {
    ...(parentMeta as Record<string, unknown>),
    videoIds: chunk,
    ...markers,
  };
}

/** Insert input for a split sibling row, copied from the parent audience. */
function splitChildInsert(
  parent: MetaCustomAudience,
  name: string,
  chunk: string[],
  sourceMeta: Record<string, unknown>,
): MetaCustomAudienceInsert {
  return {
    userId: parent.userId,
    clientId: parent.clientId,
    eventId: parent.eventId,
    name,
    funnelStage: parent.funnelStage,
    audienceSubtype: parent.audienceSubtype,
    retentionDays: parent.retentionDays,
    sourceId: chunk.join(","),
    sourceMeta,
    metaAdAccountId: parent.metaAdAccountId,
  };
}

/** Extract the videoIds array from a video_views audience's sourceMeta. */
function videoViewVideoIds(audience: MetaCustomAudience): string[] {
  const sm = audience.sourceMeta as { videoIds?: unknown };
  return Array.isArray(sm.videoIds) ? sm.videoIds.map(String) : [];
}

/** Shallow clone with the videoIds narrowed to a chunk subset. */
function withVideoIds(
  audience: MetaCustomAudience,
  videoIds: string[],
): MetaCustomAudience {
  return {
    ...audience,
    sourceId: videoIds.join(","),
    sourceMeta: { ...(audience.sourceMeta as Record<string, unknown>), videoIds },
  };
}

/**
 * Split an oversized video-views source set into multiple ≤200-video Custom
 * Audiences (Meta's hard cap; see {@link MAX_VIDEO_VIEWS_VIDEOS}). Each part
 * is a valid video-views audience with the same threshold/retention/contextId
 * but a distinct subset of videoIds; together they cover all videos at
 * ad-set targeting when both are selected with OR.
 *
 * Mirrors {@link writeSplitPageEngagement} exactly:
 *   1. Create EVERY part's Meta audience first (idempotent per part).
 *   2. Persist sibling rows (find-or-create by splitParentId), primary last.
 *
 * Returns the primary (part 1) row; siblings surface in the UI on refresh.
 */
async function writeSplitVideoViews(args: {
  supabase: IdempotencyClient;
  audience: MetaCustomAudience;
  videoIds: string[];
  token: string;
  post: MetaAudiencePost;
  userId: string;
}): Promise<MetaCustomAudience> {
  const { supabase, audience, videoIds, token, post, userId } = args;
  const chunks = chunkVideoIds(videoIds, MAX_VIDEO_VIEWS_VIDEOS);
  const total = chunks.length;
  const baseName = stripPartSuffix(audience.name);
  console.log(
    `[audience-write] ${audience.id}: ${videoIds.length} videos exceed Meta's ` +
      `${MAX_VIDEO_VIEWS_VIDEOS}-video cap — splitting into ${total} audiences.`,
  );

  // Phase 1 — create all Meta audiences (idempotent per part). No row writes yet.
  const metaIds: string[] = [];
  for (let part = 0; part < total; part++) {
    const partAudience = withVideoIds(
      { ...audience, name: partAudienceName(baseName, part, total) },
      chunks[part]!,
    );
    const metaId = await createOneMetaAudience({
      payload: buildMetaCustomAudiencePayload(partAudience),
      adAccountId: audience.metaAdAccountId,
      token,
      post,
      supabase,
      idempotencyKey: metaAudienceIdempotencyKey(audience.id, userId, part),
      userId,
      audienceId: audience.id,
    });
    metaIds.push(metaId);
  }

  // Phase 2 — persist rows. Siblings first (find-or-create), primary last.
  const existingByPart = new Map<number, string>();
  for (const child of await listSplitChildAudiences(audience.id)) {
    const part = Number((child.sourceMeta as Record<string, unknown>).splitPart);
    if (Number.isInteger(part)) existingByPart.set(part, child.id);
  }

  for (let part = 1; part < total; part++) {
    const name = partAudienceName(baseName, part, total);
    const sourceMeta = videoSplitPartSourceMeta(audience.sourceMeta, chunks[part]!, {
      splitParentId: audience.id,
      splitPart: part,
      splitTotal: total,
    });
    const childId =
      existingByPart.get(part) ??
      (await createAudienceDraft(splitChildInsert(audience, name, chunks[part]!, sourceMeta)))
        .id;
    await updateAudience(childId, {
      status: "ready",
      metaAudienceId: metaIds[part],
      name,
      sourceId: chunks[part]!.join(","),
      sourceMeta,
      statusError: null,
    });
  }

  const primary = await updateAudience(audience.id, {
    status: "ready",
    metaAudienceId: metaIds[0],
    name: partAudienceName(baseName, 0, total),
    sourceId: chunks[0]!.join(","),
    sourceMeta: videoSplitPartSourceMeta(audience.sourceMeta, chunks[0]!, {
      splitPart: 0,
      splitTotal: total,
    }),
    statusError: null,
  });
  if (!primary) throw new Error("Audience not found after Meta write");
  return primary;
}

export async function createMetaCustomAudienceBatch(
  audienceIds: string[],
  options: {
    userId: string;
    supabase?: TypedSupabaseClient;
    request?: MetaAudiencePost;
    pageAccess?: MetaPageAccessResolver;
  },
): Promise<MetaAudienceBatchResult> {
  assertMetaAudienceWritesEnabled();
  const successes: MetaAudienceWriteSuccess[] = [];
  const failures: MetaAudienceWriteFailure[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < audienceIds.length) {
      const audienceId = audienceIds[cursor];
      cursor += 1;
      try {
        const updated = await createMetaCustomAudience(audienceId, options);
        if (!updated.metaAudienceId) {
          // createMetaCustomAudience catches Meta errors internally and stores
          // them as statusError on the failed row. Surface the stored error so
          // callers see the real Meta message (e.g. "#2654 too big") rather
          // than a generic "missing after write" placeholder.
          throw new Error(
            updated.statusError ?? "Meta audience id missing after write",
          );
        }
        successes.push({
          audienceId,
          metaAudienceId: updated.metaAudienceId,
        });
      } catch (err) {
        failures.push({
          audienceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(3, audienceIds.length) }, worker));
  return { successes, failures };
}

export async function archiveMetaCustomAudience(
  audienceId: string,
  options: { userId: string; supabase?: TypedSupabaseClient },
): Promise<boolean> {
  const audience = await getAudienceById(audienceId);
  if (!audience || audience.userId !== options.userId) return false;
  if (metaAudienceWritesEnabled() && audience.metaAudienceId) {
    const supabase = options.supabase ?? (await createClient());
    const { token } = await resolveServerMetaToken(supabase, options.userId);
    await deleteMetaAudience(
      audience.metaAdAccountId,
      audience.metaAudienceId,
      token,
    ).catch((err) => {
      console.warn(
        "[archiveMetaCustomAudience] Meta delete failed; archiving locally:",
        err instanceof Error ? err.message : String(err),
      );
    });
  }
  const updated = await updateAudience(audienceId, { status: "archived" });
  return Boolean(updated);
}

async function postMetaAudienceForm(
  path: string,
  body: Record<string, string>,
  token: string,
): Promise<{ id: string }> {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("access_token", token);

  // DIAGNOSTIC: log the exact form payload being sent to Meta (without token).
  // Remove this logging once audience writes are stable across all subtypes.
  console.log(
    `[audience-write] POST ${path}\n` +
      `  full body: ${JSON.stringify(body, null, 2)}\n` +
      `  url-encoded body: ${new URLSearchParams(body).toString()}`,
  );

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok || json.error) {
    const e = (json.error ?? {}) as Record<string, unknown>;
    // DIAGNOSTIC: log full error response from Meta for debugging.
    console.error(
      `[audience-write] Meta rejected payload for ${path}:\n`,
      JSON.stringify(e, null, 2),
    );
    throw new MetaApiError(
      (e.message as string) ?? `HTTP ${response.status}`,
      e.code as number | undefined,
      e.type as string | undefined,
      e.fbtrace_id as string | undefined,
      e.error_subcode as number | undefined,
      (e.error_user_msg ?? e.error_user_title) as string | undefined,
      e as Record<string, unknown>,
    );
  }
  return json as { id: string };
}

async function deleteMetaAudience(
  adAccountId: string,
  metaAudienceId: string,
  token: string,
): Promise<void> {
  const url = new URL(
    `${BASE}/${withActPrefix(adAccountId)}/customaudiences/${metaAudienceId}`,
  );
  url.searchParams.set("access_token", token);
  const response = await fetch(url.toString(), {
    method: "DELETE",
    cache: "no-store",
  });
  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const error = (json.error ?? {}) as Record<string, unknown>;
    throw new Error((error.message as string | undefined) ?? `HTTP ${response.status}`);
  }
}

function formatMetaWriteError(err: unknown): string {
  if (err instanceof MetaApiError) {
    const suffix = [
      err.code ? `code ${err.code}` : null,
      err.subcode ? `subcode ${err.subcode}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return suffix ? `${err.message} (${suffix})` : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
