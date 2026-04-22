import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CreativeDatePreset,
  CreativeInsightRow,
} from "@/lib/types/intelligence";

/**
 * lib/db/creative-insight-snapshots.ts
 *
 * Read + write helpers for `creative_insight_snapshots` (migration
 * 032). The table is a CACHE keyed on
 * `(user_id, ad_account_id, ad_id, date_preset)` — one row per
 * ad/window — that backs the heatmap so the route doesn't have to
 * page Meta synchronously on every load.
 *
 * Two exports only by design: the route never sees DB shapes, and we
 * don't expose a generic `delete` / `list` surface. The cron writes
 * via `upsertCreativeSnapshots` (service-role) and the route reads
 * via `readCachedCreativeSnapshots` (user-scoped). Anything else
 * means we're using the cache for something it isn't.
 */

/**
 * Narrow row shape for `creative_insight_snapshots`. Mirrors the
 * migration column-for-column. We keep this hand-typed rather than
 * pulling from `Database["public"]["Tables"]["creative_insight_snapshots"]`
 * because `database.types.ts` is regenerated via `supabase gen types
 * typescript --local` against a live local Supabase, which not every
 * checkout has running. Same fallback pattern as
 * `lib/db/ticket-snapshots.ts` / `lib/db/ticketing.ts`.
 */
interface SnapshotRow {
  id: string;
  user_id: string;
  ad_account_id: string;
  ad_id: string;
  date_preset: CreativeDatePreset;
  snapshot_at: string;
  ad_name: string | null;
  ad_status: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  campaign_objective: string | null;
  adset_id: string | null;
  creative_id: string | null;
  creative_name: string | null;
  thumbnail_url: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  frequency: number | null;
  reach: number | null;
  link_clicks: number | null;
  purchases: number | null;
  registrations: number | null;
  cpl: number | null;
  fatigue_score: "ok" | "warning" | "critical" | null;
  raw_insights: unknown;
  created_at: string;
}

type SnapshotInsert = Omit<SnapshotRow, "id" | "snapshot_at" | "created_at"> & {
  snapshot_at?: string;
};

const TABLE = "creative_insight_snapshots";

function num(v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v)) return 0;
  return Number(v);
}

function fatigueOrOk(
  v: SnapshotRow["fatigue_score"],
): CreativeInsightRow["fatigueScore"] {
  return v ?? "ok";
}

/**
 * Map a CreativeInsightRow (the wire/UI shape) → the DB row insert
 * shape. Keeps the conversion in one place so the route + cron stay
 * unaware of column names.
 */
function rowToInsert(
  row: CreativeInsightRow,
  userId: string,
  adAccountId: string,
  datePreset: CreativeDatePreset,
): SnapshotInsert {
  return {
    user_id: userId,
    ad_account_id: adAccountId,
    ad_id: row.adId,
    date_preset: datePreset,
    ad_name: row.adName ?? null,
    ad_status: row.status,
    campaign_id: row.campaignId,
    campaign_name: row.campaignName,
    campaign_objective: row.campaignObjective,
    adset_id: row.adsetId,
    creative_id: row.creativeId,
    creative_name: row.creativeName,
    thumbnail_url: row.thumbnailUrl,
    spend: row.spend,
    impressions: row.impressions,
    clicks: row.clicks,
    ctr: row.ctr,
    cpm: row.cpm,
    cpc: row.cpc,
    frequency: row.frequency,
    reach: row.reach,
    link_clicks: row.linkClicks,
    purchases: row.purchases,
    registrations: row.registrations,
    cpl: row.cpl,
    fatigue_score: row.fatigueScore,
    raw_insights: null,
    snapshot_at: new Date().toISOString(),
  };
}

/**
 * Map a DB row → CreativeInsightRow. Tags are always empty here —
 * the route layer joins them in from `creative_tags` after the read,
 * matching the live-fetch path's behaviour.
 */
function rowFromDb(row: SnapshotRow): CreativeInsightRow {
  const linkClicks = row.link_clicks ?? 0;
  const spend = num(row.spend);
  return {
    adId: row.ad_id,
    adName: row.ad_name ?? "",
    status: row.ad_status,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    campaignObjective: row.campaign_objective,
    adsetId: row.adset_id,
    creativeId: row.creative_id,
    creativeName: row.creative_name,
    thumbnailUrl: row.thumbnail_url,
    spend,
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    ctr: num(row.ctr),
    cpm: num(row.cpm),
    cpc: num(row.cpc),
    frequency: num(row.frequency),
    reach: num(row.reach),
    linkClicks,
    purchases: num(row.purchases),
    registrations: num(row.registrations),
    cpl: row.cpl,
    fatigueScore: fatigueOrOk(row.fatigue_score),
    tags: [],
  };
}

interface UpsertParams {
  /**
   * Either a service-role client (cron path) or a user-scoped client
   * (manual refresh from the route). Both work — RLS owner policies
   * accept the user-scoped path because `user_id = auth.uid()`, and
   * the service-role client bypasses RLS entirely.
   */
  supabase: SupabaseClient;
  userId: string;
  adAccountId: string;
  datePreset: CreativeDatePreset;
  rows: CreativeInsightRow[];
}

/**
 * Upsert one row per ad into `creative_insight_snapshots`, conflicting
 * on `(user_id, ad_account_id, ad_id, date_preset)` — one row per
 * ad/window. Returns the count of rows actually written so the cron
 * + route can report it.
 *
 * Empty `rows` short-circuits to 0 — Supabase's REST insert with an
 * empty array is a 400, and we'd rather no-op than try.
 */
export async function upsertCreativeSnapshots(
  params: UpsertParams,
): Promise<{ written: number }> {
  const { supabase, userId, adAccountId, datePreset, rows } = params;
  if (rows.length === 0) return { written: 0 };

  const inserts = rows.map((r) =>
    rowToInsert(r, userId, adAccountId, datePreset),
  );

  // Cast through `any` because regenerated Supabase types haven't
  // caught up with migration 032 on every checkout. The cast is
  // contained to this module so callers see the typed surface only.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { data, error } = await sb
    .from(TABLE)
    .upsert(inserts, {
      onConflict: "user_id,ad_account_id,ad_id,date_preset",
    })
    .select("id");

  if (error) {
    console.warn(
      "[creative-insight-snapshots upsert] error:",
      error.message,
    );
    return { written: 0 };
  }
  return { written: Array.isArray(data) ? data.length : inserts.length };
}

interface ReadParams {
  /**
   * Caller asserts the user is signed in. RLS still gates the row
   * set to `user_id = auth.uid()` when this is a user-scoped client;
   * passing a service-role client would bypass that, which is fine
   * for the cron but never appropriate for the read route.
   */
  supabase: SupabaseClient;
  userId: string;
  adAccountId: string;
  datePreset: CreativeDatePreset;
}

interface ReadResult {
  rows: CreativeInsightRow[];
  /**
   * `MAX(snapshot_at)` across the returned set. `null` when no rows
   * exist — the route uses that to drive the "needs refresh" hint
   * rather than rendering an empty heatmap.
   */
  snapshotAt: string | null;
}

export async function readCachedCreativeSnapshots(
  params: ReadParams,
): Promise<ReadResult> {
  const { supabase, userId, adAccountId, datePreset } = params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { data, error } = await sb
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .eq("ad_account_id", adAccountId)
    .eq("date_preset", datePreset)
    .order("snapshot_at", { ascending: false });

  if (error) {
    console.warn(
      "[creative-insight-snapshots read] error:",
      error.message,
    );
    return { rows: [], snapshotAt: null };
  }

  const dbRows = (data ?? []) as SnapshotRow[];
  if (dbRows.length === 0) return { rows: [], snapshotAt: null };

  let maxSnapshotAt: string | null = null;
  for (const r of dbRows) {
    if (!maxSnapshotAt || r.snapshot_at > maxSnapshotAt) {
      maxSnapshotAt = r.snapshot_at;
    }
  }

  return {
    rows: dbRows.map(rowFromDb),
    snapshotAt: maxSnapshotAt,
  };
}

/**
 * Distinct `(user_id, ad_account_id)` pairs that have at least one
 * snapshot row — the warm-set the cron iterates. Service-role only:
 * we read across users.
 */
export async function listWarmPairs(
  supabase: SupabaseClient,
): Promise<{ userId: string; adAccountId: string }[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { data, error } = await sb
    .from(TABLE)
    .select("user_id, ad_account_id");

  if (error) {
    console.warn(
      "[creative-insight-snapshots listWarmPairs] error:",
      error.message,
    );
    return [];
  }

  const seen = new Set<string>();
  const out: { userId: string; adAccountId: string }[] = [];
  for (const row of (data ?? []) as Pick<
    SnapshotRow,
    "user_id" | "ad_account_id"
  >[]) {
    const key = `${row.user_id}::${row.ad_account_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ userId: row.user_id, adAccountId: row.ad_account_id });
  }
  return out;
}
