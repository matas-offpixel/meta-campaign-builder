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
  source_meta_at: string | null;
  source_eventbrite_at: string | null;
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
  revenue: number;
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
  /** Total allocated: specific + generic_share. */
  ad_spend_allocated: number;
  /** Opponent-matched spend for this event. */
  ad_spend_specific: number;
  /** This event's slice of the venue-wide generic pool. */
  ad_spend_generic_share: number;
}

/**
 * Bulk upsert allocated-spend columns on `event_daily_rollups` for
 * one event. Touches ONLY the three allocation columns introduced
 * in migration 046 — the existing `ad_spend` / `link_clicks` /
 * `source_meta_at` etc. are written by the Meta rollup pass and
 * must never be blanked out by the allocator. That isolation is
 * why the allocator is a separate upsert rather than folded into
 * `upsertMetaRollups`.
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
  }));
  const { error } = await asAny(supabase)
    .from("event_daily_rollups")
    .upsert(payload, { onConflict: "event_id,date" });
  if (error) {
    console.warn("[event-daily-rollups upsertAllocated]", error.message);
    throw new Error(error.message);
  }
}
