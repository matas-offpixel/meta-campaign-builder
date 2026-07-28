import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getBMTokenKey } from "@/lib/bm/secrets";
import type {
  BMAccessAction,
  BMPage,
  BusinessManager,
  BusinessManagerSummary,
  DetectedNewPage,
} from "@/lib/bm/types";

/**
 * lib/db/business-managers.ts
 *
 * Server-side CRUD for the migration-145 BM tables:
 *   - client_business_managers
 *   - bm_pages
 *   - bm_page_access_events
 *
 * The encrypted token column is NEVER selected into a response — it is written /
 * read only via the set_bm_access_token / get_bm_access_token RPCs.
 *
 * Same regen-pending `AnySupabaseClient` shim as lib/db/d2c.ts so this compiles
 * before the generated types include the new tables.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

function asAny(supabase: AnySupabaseClient): AnySupabaseClient {
  return supabase;
}

/** Public columns for client_business_managers — excludes access_token_encrypted. */
const BM_PUBLIC_COLUMNS =
  "id, client_id, business_id, business_name, added_by_user_id, scopes, token_expired, last_scanned_at, last_error, created_at, updated_at";

function mapBM(raw: Record<string, unknown>): BusinessManager {
  return {
    id: raw.id as string,
    client_id: (raw.client_id as string | null) ?? null,
    business_id: raw.business_id as string,
    business_name: (raw.business_name as string | null) ?? null,
    added_by_user_id: (raw.added_by_user_id as string | null) ?? null,
    scopes: (raw.scopes as string[] | null) ?? [],
    token_expired: Boolean(raw.token_expired),
    last_scanned_at: (raw.last_scanned_at as string | null) ?? null,
    last_error: (raw.last_error as string | null) ?? null,
    created_at: raw.created_at as string,
    updated_at: raw.updated_at as string,
  };
}

function mapPage(raw: Record<string, unknown>): BMPage {
  return {
    id: raw.id as string,
    business_id: raw.business_id as string,
    page_id: raw.page_id as string,
    page_name: (raw.page_name as string | null) ?? null,
    category: (raw.category as string | null) ?? null,
    is_owned_by_bm: Boolean(raw.is_owned_by_bm),
    user_has_access: Boolean(raw.user_has_access),
    user_tasks: (raw.user_tasks as string[] | null) ?? [],
    last_grant_requested_tasks: (raw.last_grant_requested_tasks as string[] | null) ?? null,
    last_grant_at: (raw.last_grant_at as string | null) ?? null,
    followers: (raw.followers as number | null) ?? null,
    avatar_url: (raw.avatar_url as string | null) ?? null,
    first_seen_at: raw.first_seen_at as string,
    last_seen_at: raw.last_seen_at as string,
  };
}

// ─── client_business_managers ────────────────────────────────────────────────

export async function listBusinessManagers(
  supabase: AnySupabaseClient,
): Promise<BusinessManager[]> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("client_business_managers")
    .select(BM_PUBLIC_COLUMNS)
    .order("business_name", { ascending: true });
  if (error) {
    console.error("[bm listBusinessManagers]", error.message);
    return [];
  }
  return (data ?? []).map((r) => mapBM(r as Record<string, unknown>));
}

export async function getBusinessManagerByBizId(
  supabase: AnySupabaseClient,
  bizId: string,
): Promise<BusinessManager | null> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("client_business_managers")
    .select(BM_PUBLIC_COLUMNS)
    .eq("business_id", bizId)
    .maybeSingle();
  if (error) {
    console.error("[bm getBusinessManagerByBizId]", error.message);
    return null;
  }
  return data ? mapBM(data as Record<string, unknown>) : null;
}

/**
 * Insert or update a BM connection (by business_id) and store the encrypted
 * token in one call. Returns the persisted row id.
 */
export async function upsertBusinessManagerWithToken(
  supabase: AnySupabaseClient,
  input: {
    businessId: string;
    businessName: string | null;
    addedByUserId: string;
    scopes: string[];
    token: string;
    clientId?: string | null;
  },
): Promise<string | null> {
  const sb = asAny(supabase);
  const row: Record<string, unknown> = {
    business_id: input.businessId,
    business_name: input.businessName,
    added_by_user_id: input.addedByUserId,
    scopes: input.scopes,
  };
  if (input.clientId !== undefined) row.client_id = input.clientId;

  const { data, error } = await sb
    .from("client_business_managers")
    .upsert(row, { onConflict: "business_id" })
    .select("id")
    .maybeSingle();
  if (error || !data) {
    console.error("[bm upsertBusinessManager]", error?.message);
    return null;
  }
  const id = (data as { id: string }).id;

  const key = getBMTokenKey();
  const { error: rpcError } = await sb.rpc("set_bm_access_token", {
    p_id: id,
    p_token: input.token,
    p_key: key,
  });
  if (rpcError) {
    console.error("[bm set_bm_access_token]", rpcError.message);
    return null;
  }
  return id;
}

/** Decrypts the stored user OAuth token for a BM row. Returns null when absent. */
export async function getBusinessManagerToken(
  supabase: AnySupabaseClient,
  id: string,
): Promise<string | null> {
  const sb = asAny(supabase);
  const key = getBMTokenKey();
  const { data, error } = await sb.rpc("get_bm_access_token", {
    p_id: id,
    p_key: key,
  });
  if (error) {
    console.error("[bm get_bm_access_token]", error.message);
    throw new Error(
      "Could not decrypt BM access token. Reconnect the Business Manager or check BM_TOKEN_KEY.",
    );
  }
  return (data as string | null) ?? null;
}

/** Flag a BM's token as expired (Meta subcode 190) — surfaces reconnect banner. */
export async function markBusinessManagerTokenExpired(
  supabase: AnySupabaseClient,
  bizId: string,
  detail?: string,
): Promise<void> {
  const sb = asAny(supabase);
  const { error } = await sb
    .from("client_business_managers")
    .update({ token_expired: true, last_error: detail ?? "token_expired" })
    .eq("business_id", bizId);
  if (error) console.error("[bm markTokenExpired]", error.message);
}

/** Stamp last_scanned_at (and optional last_error) after a scan run. */
export async function updateBusinessManagerScanState(
  supabase: AnySupabaseClient,
  bizId: string,
  opts: { lastError?: string | null } = {},
): Promise<void> {
  const sb = asAny(supabase);
  const patch: Record<string, unknown> = {
    last_scanned_at: new Date().toISOString(),
  };
  if (opts.lastError !== undefined) patch.last_error = opts.lastError;
  const { error } = await sb
    .from("client_business_managers")
    .update(patch)
    .eq("business_id", bizId);
  if (error) console.error("[bm updateScanState]", error.message);
}

/** BM rows decorated with client_name + page counts for the list UI. */
export async function listBusinessManagerSummaries(
  supabase: AnySupabaseClient,
): Promise<BusinessManagerSummary[]> {
  const sb = asAny(supabase);
  const bms = await listBusinessManagers(sb);
  if (bms.length === 0) return [];

  // Page counts — fetch minimal columns and aggregate in JS.
  const { data: pageRows, error: pageErr } = await sb
    .from("bm_pages")
    .select("business_id, user_has_access");
  if (pageErr) console.error("[bm summaries pages]", pageErr.message);

  const totals = new Map<string, { total: number; missing: number }>();
  for (const r of (pageRows ?? []) as { business_id: string; user_has_access: boolean }[]) {
    const t = totals.get(r.business_id) ?? { total: 0, missing: 0 };
    t.total += 1;
    if (!r.user_has_access) t.missing += 1;
    totals.set(r.business_id, t);
  }

  // Client names.
  const clientIds = Array.from(
    new Set(bms.map((b) => b.client_id).filter((v): v is string => !!v)),
  );
  const clientNames = new Map<string, string>();
  if (clientIds.length > 0) {
    const { data: clientRows } = await sb
      .from("clients")
      .select("id, name")
      .in("id", clientIds);
    for (const c of (clientRows ?? []) as { id: string; name: string }[]) {
      clientNames.set(c.id, c.name);
    }
  }

  return bms.map((b) => {
    const t = totals.get(b.business_id) ?? { total: 0, missing: 0 };
    return {
      ...b,
      client_name: b.client_id ? clientNames.get(b.client_id) ?? null : null,
      total_pages: t.total,
      missing_access_count: t.missing,
    };
  });
}

// ─── bm_pages ─────────────────────────────────────────────────────────────────

export async function getBMPages(
  supabase: AnySupabaseClient,
  bizId: string,
): Promise<BMPage[]> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("bm_pages")
    .select("*")
    .eq("business_id", bizId)
    .order("user_has_access", { ascending: true })
    .order("page_name", { ascending: true });
  if (error) {
    console.error("[bm getBMPages]", error.message);
    return [];
  }
  return (data ?? []).map((r) => mapPage(r as Record<string, unknown>));
}

export interface UpsertPageInput {
  page_id: string;
  page_name: string | null;
  category: string | null;
  is_owned_by_bm: boolean;
  user_has_access: boolean;
  /** The operator's real page tasks from Meta (migration 149) — evidence, not a verdict. */
  user_tasks: string[];
  followers: number | null;
  avatar_url: string | null;
}

/**
 * Upsert a batch of pages for a BM. Returns the page_ids that did NOT already
 * exist (i.e. newly-detected pages) so the caller can log `detected_new` events.
 */
export async function upsertBMPages(
  supabase: AnySupabaseClient,
  bizId: string,
  pages: UpsertPageInput[],
): Promise<{ newPageIds: string[] }> {
  const sb = asAny(supabase);
  if (pages.length === 0) return { newPageIds: [] };

  // Which page_ids already exist? Anything not in this set is newly detected.
  const { data: existing } = await sb
    .from("bm_pages")
    .select("page_id")
    .eq("business_id", bizId);
  const existingIds = new Set(
    ((existing ?? []) as { page_id: string }[]).map((r) => r.page_id),
  );

  const now = new Date().toISOString();
  const rows = pages.map((p) => ({
    business_id: bizId,
    page_id: p.page_id,
    page_name: p.page_name,
    category: p.category,
    is_owned_by_bm: p.is_owned_by_bm,
    user_has_access: p.user_has_access,
    user_tasks: p.user_tasks,
    followers: p.followers,
    avatar_url: p.avatar_url,
    last_seen_at: now,
  }));

  const { error } = await sb
    .from("bm_pages")
    .upsert(rows, { onConflict: "business_id,page_id" });
  if (error) {
    console.error("[bm upsertBMPages]", error.message);
    return { newPageIds: [] };
  }

  const newPageIds = pages
    .map((p) => p.page_id)
    .filter((id) => !existingIds.has(id));
  return { newPageIds };
}

/** Minimal `bm_pages` projection consumed by the audience-builder page source union. */
export interface BMPageForAudienceSource {
  page_id: string;
  page_name: string | null;
  category: string | null;
}

/**
 * Pages under a Business Manager the operator has confirmed access to
 * (`user_has_access = true`), regardless of `is_owned_by_bm` — this is the
 * backfill source for pages shared into the BM by a different Business
 * Manager (e.g. client-shared pages), which Meta's `/me/accounts` +
 * `owned_pages` + `client_pages` audience-source query can miss. See
 * lib/audiences/page-source-union.ts.
 */
export async function getBMPagesWithUserAccess(
  supabase: AnySupabaseClient,
  businessId: string,
): Promise<BMPageForAudienceSource[]> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("bm_pages")
    .select("page_id, page_name, category")
    .eq("business_id", businessId)
    .eq("user_has_access", true);
  if (error) {
    console.error("[bm getBMPagesWithUserAccess]", error.message);
    return [];
  }
  return (data ?? []) as BMPageForAudienceSource[];
}

/**
 * Pages we have POSITIVE evidence the operator holds no role on — the condition
 * that makes Meta refuse an audience with subcode 1713140.
 *
 * Asymmetric on purpose, the same rule PR #725 settled on for IG identities: a
 * page is only reported when a scanned `bm_pages` row says `user_has_access =
 * false` and NO row says otherwise. A page with no row at all is unknown, not
 * bad — an unscanned Business Manager or a page held outside every connected BM
 * would otherwise get warned about for no reason, and a warning that fires on
 * absence of evidence trains operators to ignore it.
 *
 * Queried across all businesses rather than one, because `user_has_access` comes
 * from `/me/accounts`, which is global: a role seen through ANY business is a
 * role.
 */
export async function getPagesWithoutOperatorRole(
  supabase: AnySupabaseClient,
  pageIds: string[],
): Promise<Set<string>> {
  if (pageIds.length === 0) return new Set();
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("bm_pages")
    .select("page_id, user_has_access")
    .in("page_id", pageIds);
  if (error) {
    console.error("[bm getPagesWithoutOperatorRole]", error.message);
    return new Set();
  }
  const rows = (data ?? []) as { page_id: string; user_has_access: boolean }[];
  const withRole = new Set(rows.filter((r) => r.user_has_access).map((r) => r.page_id));
  return new Set(
    rows.filter((r) => !r.user_has_access && !withRole.has(r.page_id)).map((r) => r.page_id),
  );
}

/**
 * Where an audience seed lives, and whether the operator holds a role on it.
 *
 * `grantAssetId` is the id to POST to `/{id}/assigned_users`, which is NOT always
 * the id the audience rule used — see {@link findAudienceSeedLocations}.
 */
export interface AudienceSeedLocation {
  /** The id exactly as it appeared in the audience rule's event_sources. */
  sourceId: string;
  kind: "page" | "ig";
  businessId: string;
  /** The id the grant edge expects. Differs from `sourceId` for IG. */
  grantAssetId: string;
  name: string | null;
  userHasAccess: boolean;
  userTasks: string[];
}

/**
 * Locate audience seed ids across the BM asset tables.
 *
 * ── The IG id-space trap ────────────────────────────────────────────────────
 * A `page_engagement_ig` audience rule carries Instagram **user** ids
 * (`17841…`), because that is what `/{ad_account}/instagram_accounts` returns and
 * what `object_story_spec.instagram_user_id` expects. The business-asset grant
 * edge, however, is keyed by the Instagram **business asset** id — a different id
 * space entirely. Migration 147 stores both columns precisely so this lookup can
 * match on `ig_user_id` and return `ig_asset_id` for the grant. Feeding one space
 * where the other is expected is the failure mode PR #725 was built to prevent,
 * so the two ids are kept in separate fields here rather than one `id`.
 *
 * Pages have no such split: the audience rule id and the grant id are both the
 * page id.
 *
 * A seed present in several BMs yields several rows; the caller decides which BM
 * to act through (it needs a live token for that BM).
 */
export async function findAudienceSeedLocations(
  supabase: AnySupabaseClient,
  sourceIds: string[],
): Promise<AudienceSeedLocation[]> {
  if (sourceIds.length === 0) return [];
  const sb = asAny(supabase);
  const out: AudienceSeedLocation[] = [];

  const { data: pageRows, error: pageErr } = await sb
    .from("bm_pages")
    .select("page_id, page_name, business_id, user_has_access, user_tasks")
    .in("page_id", sourceIds);
  if (pageErr) console.error("[bm findAudienceSeedLocations pages]", pageErr.message);
  for (const r of (pageRows ?? []) as {
    page_id: string;
    page_name: string | null;
    business_id: string;
    user_has_access: boolean;
    user_tasks: string[] | null;
  }[]) {
    out.push({
      sourceId: r.page_id,
      kind: "page",
      businessId: r.business_id,
      grantAssetId: r.page_id,
      name: r.page_name,
      userHasAccess: Boolean(r.user_has_access),
      userTasks: r.user_tasks ?? [],
    });
  }

  const { data: igRows, error: igErr } = await sb
    .from("bm_ig_accounts")
    .select("ig_user_id, ig_asset_id, ig_username, business_id, user_has_access, user_tasks")
    .in("ig_user_id", sourceIds);
  if (igErr) console.error("[bm findAudienceSeedLocations ig]", igErr.message);
  for (const r of (igRows ?? []) as {
    ig_user_id: string | null;
    ig_asset_id: string;
    ig_username: string | null;
    business_id: string;
    user_has_access: boolean;
    user_tasks: string[] | null;
  }[]) {
    if (!r.ig_user_id) continue;
    out.push({
      sourceId: r.ig_user_id,
      kind: "ig",
      businessId: r.business_id,
      grantAssetId: r.ig_asset_id,
      name: r.ig_username,
      userHasAccess: Boolean(r.user_has_access),
      userTasks: r.user_tasks ?? [],
    });
  }

  return out;
}

/** Flip a single page's access flag (after a successful grant). */
export async function setPageAccessFlag(
  supabase: AnySupabaseClient,
  bizId: string,
  pageId: string,
  hasAccess: boolean,
): Promise<void> {
  const sb = asAny(supabase);
  const { error } = await sb
    .from("bm_pages")
    .update({ user_has_access: hasAccess, last_seen_at: new Date().toISOString() })
    .eq("business_id", bizId)
    .eq("page_id", pageId);
  if (error) console.error("[bm setPageAccessFlag]", error.message);
}

/**
 * Write one page's observed task state after a read-back (migration 149).
 *
 * Deliberately an UPDATE, not an upsert: an upsert would have to supply every
 * column and would reset `is_owned_by_bm` to its default, silently reclassifying
 * client-shared pages as BM-owned. Callers only ever reconcile pages a scan has
 * already inserted.
 */
export async function setPageTaskState(
  supabase: AnySupabaseClient,
  bizId: string,
  pageId: string,
  state: { userHasAccess: boolean; userTasks: string[] },
): Promise<void> {
  const sb = asAny(supabase);
  const { error } = await sb
    .from("bm_pages")
    .update({
      user_has_access: state.userHasAccess,
      user_tasks: state.userTasks,
      last_seen_at: new Date().toISOString(),
    })
    .eq("business_id", bizId)
    .eq("page_id", pageId);
  if (error) console.error("[bm setPageTaskState]", error.message);
}

/**
 * Record what a grant ASKED Meta for (migration 149).
 *
 * Stored separately from `user_tasks`, which holds what Meta subsequently
 * reported. The delta between the two is the only reliable record of what Meta
 * actually did with a request — it expands some tasks and can quietly ignore
 * others — and it is the evidence the subcode-1713140 investigation needs.
 */
export async function recordPageGrantRequest(
  supabase: AnySupabaseClient,
  bizId: string,
  pageId: string,
  requestedTasks: string[],
): Promise<void> {
  const sb = asAny(supabase);
  const { error } = await sb
    .from("bm_pages")
    .update({
      last_grant_requested_tasks: requestedTasks,
      last_grant_at: new Date().toISOString(),
    })
    .eq("business_id", bizId)
    .eq("page_id", pageId);
  if (error) console.error("[bm recordPageGrantRequest]", error.message);
}

// ─── bm_page_access_events ────────────────────────────────────────────────────

export async function logAccessEvent(
  supabase: AnySupabaseClient,
  input: {
    businessId: string;
    pageId: string;
    userId: string | null;
    action: BMAccessAction;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  const sb = asAny(supabase);
  const { error } = await sb.from("bm_page_access_events").insert({
    business_id: input.businessId,
    page_id: input.pageId,
    user_id: input.userId,
    action: input.action,
    detail: input.detail ?? {},
  });
  if (error) console.error("[bm logAccessEvent]", error.message);
}

/**
 * Bulk-insert several `bm_page_access_events` rows in ONE round trip.
 *
 * Added for the 2026-07-09 scan-timeout fix: `scanBusinessManager` used to
 * call `logAccessEvent` once per newly-detected page — 700+ sequential
 * awaited inserts on a large BM (Columbo Group, ~1060 pages) was the actual
 * time sink behind the 120s timeout, not the Meta API fetch. Callers should
 * chunk large batches (e.g. 100 rows) themselves so a single insert stays
 * fast and so progress can be checkpointed between chunks.
 */
export async function logAccessEventsBulk(
  supabase: AnySupabaseClient,
  events: {
    businessId: string;
    pageId: string;
    userId: string | null;
    action: BMAccessAction;
    detail?: Record<string, unknown>;
  }[],
): Promise<void> {
  if (events.length === 0) return;
  const sb = asAny(supabase);
  const { error } = await sb.from("bm_page_access_events").insert(
    events.map((e) => ({
      business_id: e.businessId,
      page_id: e.pageId,
      user_id: e.userId,
      action: e.action,
      detail: e.detail ?? {},
    })),
  );
  if (error) console.error("[bm logAccessEventsBulk]", error.message);
}

/** New-page inbox: detected_new events in the last `days`, joined to BM + client. */
export async function listDetectedNewPages(
  supabase: AnySupabaseClient,
  days = 7,
): Promise<DetectedNewPage[]> {
  const sb = asAny(supabase);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data: events, error } = await sb
    .from("bm_page_access_events")
    .select("business_id, page_id, at")
    .eq("action", "detected_new")
    .gte("at", since)
    .order("at", { ascending: false });
  if (error) {
    console.error("[bm listDetectedNewPages]", error.message);
    return [];
  }
  const rows = (events ?? []) as { business_id: string; page_id: string; at: string }[];
  if (rows.length === 0) return [];

  // Dedupe to the most-recent detection per (business, page).
  const seen = new Set<string>();
  const deduped: { business_id: string; page_id: string; at: string }[] = [];
  for (const r of rows) {
    const k = `${r.business_id}:${r.page_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(r);
  }

  const bizIds = Array.from(new Set(deduped.map((r) => r.business_id)));
  const pageIds = Array.from(new Set(deduped.map((r) => r.page_id)));

  const { data: pageRows } = await sb
    .from("bm_pages")
    .select("business_id, page_id, page_name, category, avatar_url, user_has_access")
    .in("business_id", bizIds)
    .in("page_id", pageIds);
  const pageMap = new Map<string, Record<string, unknown>>();
  for (const p of (pageRows ?? []) as Record<string, unknown>[]) {
    pageMap.set(`${p.business_id}:${p.page_id}`, p);
  }

  const bms = await listBusinessManagerSummaries(sb);
  const bmMap = new Map(bms.map((b) => [b.business_id, b]));

  return deduped.map((r) => {
    const p = pageMap.get(`${r.business_id}:${r.page_id}`);
    const bm = bmMap.get(r.business_id);
    return {
      business_id: r.business_id,
      business_name: bm?.business_name ?? null,
      client_name: bm?.client_name ?? null,
      page_id: r.page_id,
      page_name: (p?.page_name as string | null) ?? null,
      category: (p?.category as string | null) ?? null,
      avatar_url: (p?.avatar_url as string | null) ?? null,
      detected_at: r.at,
      user_has_access: Boolean(p?.user_has_access),
    };
  });
}
