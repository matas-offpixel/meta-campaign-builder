import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getAudienceById,
  updateAudience,
} from "@/lib/db/meta-custom-audiences";
import type { Database } from "@/lib/db/database.types";
import {
  metaAudienceIdempotencyKey,
  withMetaAudienceWriteIdempotency,
} from "@/lib/meta/audience-idempotency";
import {
  buildMetaCustomAudiencePayload,
  pageEngagementPageIds,
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
import type { MetaCustomAudience } from "@/lib/types/audience";

type TypedSupabaseClient = SupabaseClient<Database>;

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
    const payload = buildMetaCustomAudiencePayload(audienceForWrite);
    const post = options.request ?? postMetaAudienceForm;
    const metaAudienceId = await withMetaAudienceWriteIdempotency(
      supabase,
      {
        idempotencyKey,
        userId: options.userId,
        audienceId: audience.id,
      },
      async () => {
        const result = await post(
          `/${withActPrefix(audience.metaAdAccountId)}/customaudiences`,
          payload,
          token,
        );
        if (!result.id) throw new Error("Meta returned no audience id");
        return result.id;
      },
    );

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
          throw new Error("Meta audience id missing after write");
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
