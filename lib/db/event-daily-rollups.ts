import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * lib/db/event-daily-rollups.ts
 *
 * Server-side CRUD for the `event_daily_rollups` table introduced in
 * migration 039. One row per `(event_id, date)`; rows are auto-upserted
 * by the sync route from Meta + Eventbrite, and the `notes` column is
 * the only operator-editable field.
 *
 * The Supabase generated types in `lib/db/database.types.ts` won't
 * include this table until we re-run `supabase gen types`. Until then
 * every query goes through a typed cast, mirroring the pattern in
 * `lib/db/ticketing.ts`.
 */

export interface EventDailyRollup {
  id: string;
  user_id: string;
  event_id: string;
  /** YYYY-MM-DD date string (Postgres `date`, not `timestamptz`). */
  date: string;
  ad_spend: number | null;
  link_clicks: number | null;
  tickets_sold: number | null;
  revenue: number | null;
  /** Per-day Meta complete_registration actions (rollup-sync). */
  meta_regs: number | null;
  /**
   * Per-event allocated spend (migration 046). Specific-opponent
   * spend + this event's share of the venue-wide generic pool.
   * NULL when allocation has not run for this (event, date);
   * reporting falls back to `ad_spend` in that case.
   */
  ad_spend_allocated: number | null;
  /** Spend from ads that whole-word matched this event's opponent. */
  ad_spend_specific: number | null;
  /** This event's share of the venue-generic ad pool. */
  ad_spend_generic_share: number | null;
  /**
   * Per-event share of the venue's presale-campaign spend (migration
   * 048). Presale-marked campaigns no longer enter the ad_spend_*
   * allocator — their spend is split evenly across every event at the
   * venue and written here. Powers the PRE-REG column on the dashboard;
   * reporting falls back to `events.prereg_spend` when null.
   */
  ad_spend_presale: number | null;
  tiktok_spend: number | null;
  tiktok_impressions: number | null;
  tiktok_reach: number | null;
  tiktok_clicks: number | null;
  tiktok_video_views: number | null;
  tiktok_video_views_2s: number | null;
  tiktok_video_views_6s: number | null;
  tiktok_video_views_100p: number | null;
  tiktok_avg_play_time_ms: number | null;
  tiktok_post_engagement: number | null;
  tiktok_results: number | null;
  meta_impressions: number | null;
  meta_reach: number | null;
  meta_video_plays_3s: number | null;
  meta_video_plays_15s: number | null;
  meta_video_plays_p100: number | null;
  meta_engagements: number | null;
  google_ads_spend: number | null;
  google_ads_impressions: number | null;
  google_ads_clicks: number | null;
  google_ads_conversions: number | null;
  google_ads_video_views: number | null;
  source_meta_at: string | null;
  source_eventbrite_at: string | null;
  source_tiktok_at: string | null;
  source_google_ads_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

function asAny(supabase: AnySupabaseClient): AnySupabaseClient {
  return supabase;
}

/**
 * Read every rollup row for a single event, sorted by date (newest
 * first to match the table render order). Returns an empty array on
 * any error so the page degrades to "no data yet" rather than 500-ing.
 */
export async function listRollupsForEvent(
  supabase: AnySupabaseClient,
  eventId: string,
): Promise<EventDailyRollup[]> {
  const { data, error } = await asAny(supabase)
    .from("event_daily_rollups")
    .select("*")
    .eq("event_id", eventId)
    .order("date", { ascending: false });
  if (error) {
    console.warn("[event-daily-rollups list]", error.message);
    return [];
  }
  return (data ?? []) as unknown as EventDailyRollup[];
}

/**
 * Update the `notes` field on a single (event, date) row. Returns the
 * updated row on success; null when no row exists (the UI should treat
 * this as "the sync hasn't created the row yet — sync first").
 *
 * Kept for back-compat — the PATCH route now uses
 * `upsertRollupManualEntry` so an operator can write notes for a date
 * the sync has never reached. Re-exported for any caller that still
 * wants the strict update-or-404 semantics.
 *
 * RLS handles the user-id scoping, so we don't double-check ownership
 * here. The PATCH route does the auth + event ownership check
 * upstream so a 404 here is a real "no row" signal.
 */
export async function updateRollupNotes(
  supabase: AnySupabaseClient,
  args: { eventId: string; date: string; notes: string | null },
): Promise<EventDailyRollup | null> {
  const { data, error } = await asAny(supabase)
    .from("event_daily_rollups")
    .update({ notes: args.notes })
    .eq("event_id", args.eventId)
    .eq("date", args.date)
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[event-daily-rollups updateNotes]", error.message);
    throw new Error(error.message);
  }
  return (data as unknown as EventDailyRollup) ?? null;
}

/**
 * Operator-driven partial upsert of the manual-editable columns on a
 * single `(event_id, date)` row: `tickets_sold`, `revenue`, `notes`.
 *
 * Why upsert (not update):
 *   In weekly cadence mode (see migration 040 + the
 *   `buildWeeklyDisplayRows` helper), operators write tickets/revenue
 *   to the W/C Monday — which may have no `event_daily_rollups` row
 *   yet because the Eventbrite sync never produced one (Junction 2 /
 *   Bridge get a weekly W/C report by email; Eventbrite isn't
 *   wired). Upsert means the popover writes the row on first save
 *   and updates it thereafter. Same applies in daily mode for any
 *   date with no Meta spend or Eventbrite sale.
 *
 * Why partial:
 *   This endpoint is the operator-edit lane only. `ad_spend`,
 *   `link_clicks`, and the `source_*_at` timestamps are owned by the
 *   sync pipeline; we never touch them here. Each input field is
 *   independent — passing `tickets_sold: 5` and leaving `revenue`
 *   undefined writes only `tickets_sold` and leaves any existing
 *   `revenue` untouched. Passing `null` explicitly clears the column.
 *
 *   On insert (the row didn't exist), the `user_id` column is
 *   required by the table's RLS policy + the unique-key composite is
 *   `(event_id, date)`. Caller passes both.
 *
 * Returns the upserted row.
 */
export async function upsertRollupManualEntry(
  supabase: AnySupabaseClient,
  args: {
    userId: string;
    eventId: string;
    date: string;
    /** Omit to leave existing column untouched. Pass `null` to clear. */
    tickets_sold?: number | null;
    /** Omit to leave existing column untouched. Pass `null` to clear. */
    revenue?: number | null;
    /** Omit to leave existing column untouched. Pass `null` to clear. */
    notes?: string | null;
  },
): Promise<EventDailyRollup> {
  // Build a payload containing only the columns the operator actually
  // submitted. Supabase's upsert overwrites every column in the
  // payload, so omitting a key is what preserves the current value
  // (vs. blanking it). The `user_id` + `event_id` + `date` triple is
  // always present so the insert path satisfies RLS + the unique
  // constraint.
  const payload: Record<string, unknown> = {
    user_id: args.userId,
    event_id: args.eventId,
    date: args.date,
  };
  if (Object.prototype.hasOwnProperty.call(args, "tickets_sold")) {
    payload.tickets_sold = args.tickets_sold;
  }
  if (Object.prototype.hasOwnProperty.call(args, "revenue")) {
    payload.revenue = args.revenue;
  }
  if (Object.prototype.hasOwnProperty.call(args, "notes")) {
    payload.notes = args.notes;
  }

  const { data, error } = await asAny(supabase)
    .from("event_daily_rollups")
    .upsert(payload, { onConflict: "event_id,date" })
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[event-daily-rollups upsertManual]", error.message);
    throw new Error(error.message);
  }
  if (!data) {
    // Defensive: a successful upsert with `select().maybeSingle()`
    // should always return the row. If it doesn't, surface the issue
    // rather than silently returning a fake row.
    throw new Error("Upsert returned no row");
  }
  return data as unknown as EventDailyRollup;
}

/**
 * Bulk upsert rollup rows from a sync run. Each row is keyed by
 * `(event_id, date)`; columns set on existing rows overwrite, and
 * `notes` is left alone (we only touch the synced fields, never the
 * operator-entered note).
 *
 * Why two upserts (one per source) instead of one combined upsert:
 *   The Meta data and Eventbrite data are fetched independently and
 *   may succeed/fail separately. Running them as two upserts means a
 *   failed Eventbrite fetch doesn't blank out today's Meta row, and
 *   vice versa. Each call only writes the columns it owns, so they
 *   compose cleanly on the same `(event_id, date)` key.
 */
export interface MetaUpsertRow {
  date: string;
  ad_spend: number;
  link_clicks: number;
  meta_regs: number;
  meta_impressions?: number;
  meta_reach?: number;
  meta_video_plays_3s?: number;
  meta_video_plays_15s?: number;
  meta_video_plays_p100?: number;
  meta_engagements?: number;
}

export async function upsertMetaRollups(
  supabase: AnySupabaseClient,
  args: { userId: string; eventId: string; rows: MetaUpsertRow[] },
): Promise<void> {
  if (args.rows.length === 0) return;
  const now = new Date().toISOString();
  const payload = args.rows.map((r) => ({
    user_id: args.userId,
    event_id: args.eventId,
    date: r.date,
    ad_spend: r.ad_spend,
    link_clicks: r.link_clicks,
    meta_regs: r.meta_regs,
    meta_impressions: r.meta_impressions ?? null,
    meta_reach: r.meta_reach ?? null,
    meta_video_plays_3s: r.meta_video_plays_3s ?? null,
    meta_video_plays_15s: r.meta_video_plays_15s ?? null,
    meta_video_plays_p100: r.meta_video_plays_p100 ?? null,
    meta_engagements: r.meta_engagements ?? null,
    source_meta_at: now,
  }));
  // Note: `onConflict: "event_id,date"` — the unique constraint name
  // doesn't matter to Supabase; what matters is the column tuple.
  const { error } = await asAny(supabase)
    .from("event_daily_rollups")
    .upsert(payload, { onConflict: "event_id,date" });
  if (error) {
    console.warn("[event-daily-rollups upsertMeta]", error.message);
    throw new Error(error.message);
  }
}

export interface EventbriteUpsertRow {
  date: string;
  tickets_sold: number;
  revenue: number | null;
}

export async function upsertEventbriteRollups(
  supabase: AnySupabaseClient,
  args: { userId: string; eventId: string; rows: EventbriteUpsertRow[] },
): Promise<void> {
  if (args.rows.length === 0) return;
  const now = new Date().toISOString();
  const payload = args.rows.map((r) => ({
    user_id: args.userId,
    event_id: args.eventId,
    date: r.date,
    tickets_sold: r.tickets_sold,
    revenue: r.revenue,
    source_eventbrite_at: now,
  }));
  const { error } = await asAny(supabase)
    .from("event_daily_rollups")
    .upsert(payload, { onConflict: "event_id,date" });
  if (error) {
    console.warn("[event-daily-rollups upsertEventbrite]", error.message);
    throw new Error(error.message);
  }
}

export async function clearHistoricalCurrentSnapshotTicketPadding(
  supabase: AnySupabaseClient,
  args: { eventId: string },
): Promise<void> {
  const { data: firstData, error: firstError } = await asAny(supabase)
    .from("event_daily_rollups")
    .select("date")
    .eq("event_id", args.eventId)
    .not("source_eventbrite_at", "is", null)
    .or("tickets_sold.gt.0,revenue.gt.0")
    .order("date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (firstError) {
    console.warn(
      "[event-daily-rollups clearCurrentSnapshotPadding:first]",
      firstError.message,
    );
    throw new Error(firstError.message);
  }
  const firstDataDate =
    typeof firstData?.date === "string" ? firstData.date : null;
  if (!firstDataDate) return;

  const { error } = await asAny(supabase)
    .from("event_daily_rollups")
    .update({
      tickets_sold: null,
      revenue: null,
      source_eventbrite_at: null,
    })
    .eq("event_id", args.eventId)
    .lt("date", firstDataDate)
    .not("source_eventbrite_at", "is", null)
    .eq("tickets_sold", 0)
    .eq("revenue", 0);
  if (error) {
    console.warn(
      "[event-daily-rollups clearCurrentSnapshotPadding]",
      error.message,
    );
    throw new Error(error.message);
  }
}

export interface TikTokUpsertRow {
  date: string;
  tiktok_spend: number;
  tiktok_impressions: number;
  tiktok_reach?: number | null;
  tiktok_clicks: number;
  tiktok_video_views: number;
  tiktok_video_views_2s?: number | null;
  tiktok_video_views_6s?: number | null;
  tiktok_video_views_100p?: number | null;
  tiktok_avg_play_time_ms?: number | null;
  tiktok_post_engagement?: number | null;
  tiktok_results: number;
}

/**
 * Bulk upsert TikTok-owned columns on `event_daily_rollups`.
 *
 * Isolation invariant: this writes ONLY `tiktok_*` + `source_tiktok_at`.
 * Meta budget columns (`ad_spend`, `link_clicks`, `meta_regs`,
 * `ad_spend_*`) and Eventbrite ticket columns are deliberately omitted so a
 * TikTok sync can never overwrite existing Meta / ticketing values.
 */
export async function upsertTikTokRollups(
  supabase: AnySupabaseClient,
  args: { userId: string; eventId: string; rows: TikTokUpsertRow[] },
): Promise<void> {
  if (args.rows.length === 0) return;
  const now = new Date().toISOString();
  const payload = args.rows.map((r) => ({
    user_id: args.userId,
    event_id: args.eventId,
    date: r.date,
    tiktok_spend: r.tiktok_spend,
    tiktok_impressions: r.tiktok_impressions,
    tiktok_reach: r.tiktok_reach ?? null,
    tiktok_clicks: r.tiktok_clicks,
    tiktok_video_views:
      r.tiktok_video_views_100p ?? r.tiktok_video_views ?? 0,
    tiktok_video_views_2s: r.tiktok_video_views_2s ?? null,
    tiktok_video_views_6s: r.tiktok_video_views_6s ?? null,
    tiktok_video_views_100p:
      r.tiktok_video_views_100p ?? r.tiktok_video_views ?? null,
    tiktok_avg_play_time_ms: r.tiktok_avg_play_time_ms ?? null,
    tiktok_post_engagement: r.tiktok_post_engagement ?? null,
    tiktok_results: r.tiktok_results,
    source_tiktok_at: now,
  }));
  const { error } = await asAny(supabase)
    .from("event_daily_rollups")
    .upsert(payload, { onConflict: "event_id,date" });
  if (error) {
    console.warn("[event-daily-rollups upsertTikTok]", error.message);
    throw new Error(error.message);
  }
}

export interface GoogleAdsUpsertRow {
  date: string;
  google_ads_spend: number;
  google_ads_impressions: number;
  google_ads_clicks: number;
  google_ads_conversions: number;
  google_ads_video_views: number;
}

/**
 * Bulk upsert Google Ads-owned columns on `event_daily_rollups`.
 *
 * Isolation invariant: this writes ONLY `google_ads_*` +
 * `source_google_ads_at`. Meta/TikTok/ticketing columns are deliberately
 * omitted so a Google Ads sync cannot overwrite other platform data.
 */
export async function upsertGoogleAdsRollups(
  supabase: AnySupabaseClient,
  args: { userId: string; eventId: string; rows: GoogleAdsUpsertRow[] },
): Promise<void> {
  if (args.rows.length === 0) return;
  const now = new Date().toISOString();
  const payload = args.rows.map((r) => ({
    user_id: args.userId,
    event_id: args.eventId,
    date: r.date,
    google_ads_spend: r.google_ads_spend,
    google_ads_impressions: r.google_ads_impressions,
    google_ads_clicks: r.google_ads_clicks,
    google_ads_conversions: r.google_ads_conversions,
    google_ads_video_views: r.google_ads_video_views,
    source_google_ads_at: now,
  }));
  const { error } = await asAny(supabase)
    .from("event_daily_rollups")
    .upsert(payload, { onConflict: "event_id,date" });
  if (error) {
    console.warn("[event-daily-rollups upsertGoogleAds]", error.message);
    throw new Error(error.message);
  }
}

/**
 * Row written by the per-event spend allocator (PR D2). One row per
 * (event_id, date) carries the allocator's per-event breakdown so
 * reporting can show the specific / generic split in a tooltip
 * without re-doing the classification work.
 *
 * All three columns are the sum for that single day — the UI
 * re-aggregates across the event's lifetime (or a timeframe
 * window) when rendering the venue card.
 */
export interface AllocatedSpendUpsertRow {
  date: string;
  /** Total allocated: specific + generic_share. Non-presale spend only. */
  ad_spend_allocated: number;
  /** Opponent-matched spend for this event. */
  ad_spend_specific: number;
  /** This event's slice of the venue-wide generic pool. */
  ad_spend_generic_share: number;
  /**
   * This event's slice of the venue's presale-campaign spend (evenly
   * split across every event at the venue). Migration 048. Zero when
   * the venue ran no presale campaigns on this day — still written so
   * the column's NULL distinguishes "allocator hasn't touched this row"
   * from "allocator ran, no presale activity".
   */
  ad_spend_presale: number;
  /**
   * Optional allocated Meta inline link clicks for multi-event venue rows.
   * The initial Meta pass writes venue-level clicks to every sibling; the
   * allocator can overwrite that with per-event allocated clicks so venue
   * charts do not multiply shared-campaign clicks by event count.
   */
  link_clicks?: number;
}

/**
 * Bulk upsert allocated-spend columns on `event_daily_rollups` for
 * one event. Touches ONLY the three allocation columns introduced
 * in migration 046, plus optional allocated `link_clicks` for
 * multi-event venues. The existing `ad_spend` / `source_meta_at`
 * etc. are written by the Meta rollup pass and must never be
 * blanked out by the allocator. That isolation is why the allocator
 * is a separate upsert rather than folded into `upsertMetaRollups`.
 *
 * The `user_id` + `event_id` + `date` triple is always present so
 * the INSERT path satisfies the table's RLS + unique constraint.
 * Existing rows keep their operator-entered `notes` because
 * Supabase's upsert only overwrites columns present in the
 * payload (Postgres's `ON CONFLICT ... DO UPDATE SET …` semantics).
 */
export async function upsertAllocatedSpendRollups(
  supabase: AnySupabaseClient,
  args: {
    userId: string;
    eventId: string;
    rows: AllocatedSpendUpsertRow[];
  },
): Promise<void> {
  if (args.rows.length === 0) return;
  const payload = args.rows.map((r) => ({
    user_id: args.userId,
    event_id: args.eventId,
    date: r.date,
    ad_spend_allocated: r.ad_spend_allocated,
    ad_spend_specific: r.ad_spend_specific,
    ad_spend_generic_share: r.ad_spend_generic_share,
    ad_spend_presale: r.ad_spend_presale,
    ...(r.link_clicks == null ? {} : { link_clicks: r.link_clicks }),
  }));
  const { error } = await asAny(supabase)
    .from("event_daily_rollups")
    .upsert(payload, { onConflict: "event_id,date" });
  if (error) {
    console.warn("[event-daily-rollups upsertAllocated]", error.message);
    throw new Error(error.message);
  }
}
