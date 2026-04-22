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
