import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  describeAssetKind,
  BM_V2_ASSET_KINDS,
  type BMAssetKind,
} from "@/lib/bm/asset-kinds";
import type { BMAccessAction } from "@/lib/bm/types";

/**
 * lib/db/bm-assets.ts
 *
 * Server-side CRUD for the migration-147 BM asset tables:
 *   - bm_ad_accounts
 *   - bm_pixels
 *   - bm_ig_accounts
 *
 * Pages keep their own module (`lib/db/business-managers.ts`, migration 145) —
 * v1 is deliberately untouched here. The generalised audit-event writer below
 * targets the same `bm_page_access_events` table v1 uses, now carrying
 * `asset_type` + `asset_id` (migration 147).
 *
 * Same regen-pending `AnySupabaseClient` shim as `lib/db/business-managers.ts`
 * so this compiles before the generated types include the new tables.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

function asAny(supabase: AnySupabaseClient): AnySupabaseClient {
  return supabase;
}

// ─── Upsert inputs (one per kind — column sets genuinely differ) ──────────────

export interface UpsertAdAccountInput {
  ad_account_id: string;
  account_id: string | null;
  name: string | null;
  account_status: number | null;
  currency: string | null;
  timezone_name: string | null;
  disable_reason: number | null;
  is_owned_by_bm: boolean;
  user_has_access: boolean;
  user_tasks: string[];
}

export interface UpsertPixelInput {
  pixel_id: string;
  name: string | null;
  last_fired_time: string | null;
  creation_time: string | null;
  is_unavailable: boolean | null;
  enable_automatic_matching: boolean | null;
  data_use_setting: string | null;
  is_owned_by_bm: boolean;
  user_has_access: boolean;
  user_tasks: string[];
}

export interface UpsertIgAccountInput {
  ig_asset_id: string;
  ig_user_id: string | null;
  ig_username: string | null;
  profile_pic_url: string | null;
  followers: number | null;
  media_count: number | null;
  is_owned_by_bm: boolean;
  user_has_access: boolean;
  user_tasks: string[];
}

export type UpsertAssetInput =
  | UpsertAdAccountInput
  | UpsertPixelInput
  | UpsertIgAccountInput;

/**
 * Kind-agnostic view model the dashboard tabs render. Flattening the three
 * column sets into one shape keeps the UI a single component per tab rather
 * than three near-duplicates.
 */
export interface BMAssetView {
  kind: BMAssetKind;
  /** The Meta id grants address (act_-prefixed / pixel id / IG business asset id). */
  asset_id: string;
  name: string | null;
  /** Kind-specific secondary line (currency+timezone, pixel state, @handle). */
  subtitle: string | null;
  is_owned_by_bm: boolean;
  user_has_access: boolean;
  user_tasks: string[];
  /** Ad account disabled or pixel unavailable — surfaced but never auto-skipped. */
  inactive: boolean;
  first_seen_at: string;
  last_seen_at: string;
}

/** Per-kind counts for one BM, driving the tab badges. */
export interface BMAssetCounts {
  total: number;
  missingAccess: number;
}

function toView(kind: BMAssetKind, raw: Record<string, unknown>): BMAssetView {
  const descriptor = describeAssetKind(kind);
  const assetId = String(raw[descriptor.idColumn] ?? "");
  const tasks = (raw.user_tasks as string[] | null) ?? [];

  let name: string | null = null;
  let subtitle: string | null = null;
  let inactive = false;

  if (kind === "ad_account") {
    name = (raw.name as string | null) ?? null;
    const currency = (raw.currency as string | null) ?? null;
    const tz = (raw.timezone_name as string | null) ?? null;
    subtitle = [currency, tz].filter(Boolean).join(" · ") || null;
    // Meta account_status: 1 = ACTIVE. Anything else is disabled/closed/pending.
    const status = raw.account_status as number | null;
    inactive = status !== null && status !== undefined && status !== 1;
  } else if (kind === "pixel") {
    name = (raw.name as string | null) ?? null;
    const lastFired = raw.last_fired_time as string | null;
    subtitle = lastFired ? `Last fired ${lastFired}` : "No recent activity";
    inactive = Boolean(raw.is_unavailable);
  } else if (kind === "ig_account") {
    const username = (raw.ig_username as string | null) ?? null;
    name = username ? `@${username}` : null;
    const followers = raw.followers as number | null;
    subtitle = typeof followers === "number" ? `${followers.toLocaleString()} followers` : null;
  }

  return {
    kind,
    asset_id: assetId,
    name,
    subtitle,
    is_owned_by_bm: Boolean(raw.is_owned_by_bm),
    user_has_access: Boolean(raw.user_has_access),
    user_tasks: tasks,
    inactive,
    first_seen_at: raw.first_seen_at as string,
    last_seen_at: raw.last_seen_at as string,
  };
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** All assets of one kind under a BM, missing-access first (the actionable set). */
export async function getBMAssets(
  supabase: AnySupabaseClient,
  kind: BMAssetKind,
  bizId: string,
): Promise<BMAssetView[]> {
  const descriptor = describeAssetKind(kind);
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from(descriptor.table)
    .select("*")
    .eq("business_id", bizId)
    .order("user_has_access", { ascending: true })
    .order(descriptor.nameColumn, { ascending: true });
  if (error) {
    console.error(`[bm getBMAssets ${kind}]`, error.message);
    return [];
  }
  return (data ?? []).map((r) => toView(kind, r as Record<string, unknown>));
}

/**
 * Per-kind totals for every BM in one round trip per kind, keyed
 * `business_id` → counts. Used by the dashboard to badge tabs without loading
 * every asset row.
 */
export async function getBMAssetCountsByKind(
  supabase: AnySupabaseClient,
  kind: BMAssetKind,
): Promise<Map<string, BMAssetCounts>> {
  const descriptor = describeAssetKind(kind);
  const sb = asAny(supabase);
  const out = new Map<string, BMAssetCounts>();
  const { data, error } = await sb
    .from(descriptor.table)
    .select("business_id, user_has_access");
  if (error) {
    console.error(`[bm getBMAssetCountsByKind ${kind}]`, error.message);
    return out;
  }
  for (const row of (data ?? []) as { business_id: string; user_has_access: boolean }[]) {
    const entry = out.get(row.business_id) ?? { total: 0, missingAccess: 0 };
    entry.total += 1;
    if (!row.user_has_access) entry.missingAccess += 1;
    out.set(row.business_id, entry);
  }
  return out;
}

/** Counts for all three v2 kinds at once. */
export async function getAllBMAssetCounts(
  supabase: AnySupabaseClient,
): Promise<Record<BMAssetKind, Map<string, BMAssetCounts>>> {
  const entries = await Promise.all(
    BM_V2_ASSET_KINDS.map(
      async (kind) => [kind, await getBMAssetCountsByKind(supabase, kind)] as const,
    ),
  );
  const result = {} as Record<BMAssetKind, Map<string, BMAssetCounts>>;
  for (const [kind, counts] of entries) result[kind] = counts;
  // Pages are counted by the v1 summary query; keep the shape total.
  result.page = new Map();
  return result;
}

/** Asset ids of one kind under a BM that the operator currently lacks access to. */
export async function getMissingAccessAssetIds(
  supabase: AnySupabaseClient,
  kind: BMAssetKind,
  bizId: string,
): Promise<string[]> {
  const descriptor = describeAssetKind(kind);
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from(descriptor.table)
    .select(descriptor.idColumn)
    .eq("business_id", bizId)
    .eq("user_has_access", false);
  if (error) {
    console.error(`[bm getMissingAccessAssetIds ${kind}]`, error.message);
    return [];
  }
  return (data ?? []).map((r) =>
    String((r as unknown as Record<string, unknown>)[descriptor.idColumn]),
  );
}

// ─── Writes ──────────────────────────────────────────────────────────────────

/**
 * Upsert a batch of assets for a BM. Returns the asset ids that did NOT already
 * exist, so the caller can log `detected_new` events — same contract as
 * `upsertBMPages`.
 */
export async function upsertBMAssets(
  supabase: AnySupabaseClient,
  kind: BMAssetKind,
  bizId: string,
  assets: UpsertAssetInput[],
): Promise<{ newAssetIds: string[] }> {
  if (assets.length === 0) return { newAssetIds: [] };
  const descriptor = describeAssetKind(kind);
  const sb = asAny(supabase);

  const { data: existing } = await sb
    .from(descriptor.table)
    .select(descriptor.idColumn)
    .eq("business_id", bizId);
  const existingIds = new Set(
    ((existing ?? []) as unknown as Record<string, unknown>[]).map((r) =>
      String(r[descriptor.idColumn]),
    ),
  );

  const now = new Date().toISOString();
  const rows = assets.map((asset) => ({
    ...asset,
    business_id: bizId,
    last_seen_at: now,
  }));

  const { error } = await sb
    .from(descriptor.table)
    .upsert(rows, { onConflict: `business_id,${descriptor.idColumn}` });
  if (error) {
    console.error(`[bm upsertBMAssets ${kind}]`, error.message);
    return { newAssetIds: [] };
  }

  const newAssetIds = assets
    .map((a) => String((a as unknown as Record<string, unknown>)[descriptor.idColumn]))
    .filter((id) => !existingIds.has(id));
  return { newAssetIds };
}

/**
 * Flip one asset's access flag after a grant, recording the tasks Meta actually
 * stored (not the tasks we asked for — Meta expands them).
 */
export async function setAssetAccessFlag(
  supabase: AnySupabaseClient,
  kind: BMAssetKind,
  bizId: string,
  assetId: string,
  hasAccess: boolean,
  userTasks: string[],
): Promise<void> {
  const descriptor = describeAssetKind(kind);
  const sb = asAny(supabase);
  const { error } = await sb
    .from(descriptor.table)
    .update({
      user_has_access: hasAccess,
      user_tasks: userTasks,
      last_seen_at: new Date().toISOString(),
    })
    .eq("business_id", bizId)
    .eq(descriptor.idColumn, assetId);
  if (error) console.error(`[bm setAssetAccessFlag ${kind}]`, error.message);
}

export interface AssetAccessEventInput {
  businessId: string;
  kind: BMAssetKind;
  assetId: string;
  userId: string | null;
  action: BMAccessAction;
  detail?: Record<string, unknown>;
}

function toEventRow(input: AssetAccessEventInput): Record<string, unknown> {
  return {
    business_id: input.businessId,
    asset_type: input.kind,
    asset_id: input.assetId,
    // Page rows populate page_id too, so migration-145 readers keep working.
    // Non-page rows leave it null (the column was relaxed to nullable in 147).
    page_id: input.kind === "page" ? input.assetId : null,
    user_id: input.userId,
    action: input.action,
    detail: input.detail ?? {},
  };
}

/** Append one generalised audit event. */
export async function logAssetAccessEvent(
  supabase: AnySupabaseClient,
  input: AssetAccessEventInput,
): Promise<void> {
  const sb = asAny(supabase);
  const { error } = await sb.from("bm_page_access_events").insert(toEventRow(input));
  if (error) console.error("[bm logAssetAccessEvent]", error.message);
}

/**
 * Bulk-insert generalised audit events in ONE round trip. Callers should chunk
 * large batches (100 rows) and checkpoint between chunks — see the 2026-07-09
 * scan-timeout fix that motivated the page-side equivalent.
 */
export async function logAssetAccessEventsBulk(
  supabase: AnySupabaseClient,
  events: AssetAccessEventInput[],
): Promise<void> {
  if (events.length === 0) return;
  const sb = asAny(supabase);
  const { error } = await sb.from("bm_page_access_events").insert(events.map(toEventRow));
  if (error) console.error("[bm logAssetAccessEventsBulk]", error.message);
}
