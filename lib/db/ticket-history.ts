/**
 * lib/db/ticket-history.ts
 *
 * Read helpers for `event_daily_ticket_history` — the table written by the
 * per-attendee-pull cron (migration 120).  This table holds TRUE per-day
 * attendee counts sourced from Eventbrite orders and 4TheFans /sales deltas,
 * as opposed to the cumulative-diff values in event_daily_rollups.tickets_sold.
 *
 * Write path is in the cron / admin backfill routes; no writes live here so
 * that this file stays importable in server components without `server-only`.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

// ─── Public types ──────────────────────────────────────────────────────────────

export type TicketHistorySource = "eventbrite_orders" | "fourthefans_history";

export interface DailyTicketHistoryRow {
  id: string;
  user_id: string;
  event_id: string;
  /** YYYY-MM-DD */
  date: string;
  source: TicketHistorySource;
  tickets_sold: number;
  /** Revenue in minor units (pence / cents). Divide by 100 for display. */
  revenue_minor: number;
  currency: string | null;
  fetched_at: string;
}

export interface BestDailyTickets {
  /** YYYY-MM-DD */
  date: string;
  /**
   * Best tickets_sold for this day across all sources (max per day).
   * When both sources have a row for the same day we take the maximum,
   * which gives the most optimistic reading when providers diverge slightly
   * (e.g. 4TheFans API vs Eventbrite delayed processing).
   */
  tickets_sold: number;
  /** Which source yielded the max. When tied, "eventbrite_orders" wins. */
  source: TicketHistorySource;
}

// ─── Read helpers ─────────────────────────────────────────────────────────────

/**
 * Return all rows in `event_daily_ticket_history` for the given event and
 * date range, ordered by `(date ASC, source ASC)`.
 *
 * Both `from` and `to` are inclusive YYYY-MM-DD strings.
 */
export async function getDailyTicketHistoryForEvent(
  supabase: AnySupabaseClient,
  eventId: string,
  from: string,
  to: string,
): Promise<DailyTicketHistoryRow[]> {
  const { data, error } = await supabase
    .from("event_daily_ticket_history")
    .select("*")
    .eq("event_id", eventId)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true })
    .order("source", { ascending: true });

  if (error) {
    console.warn("[ticket-history getDailyTicketHistoryForEvent]", error.message);
    return [];
  }
  return (data ?? []) as unknown as DailyTicketHistoryRow[];
}

/**
 * Return one row per calendar day for the given event, taking the **maximum**
 * `tickets_sold` value across all sources for that day.
 *
 * Rationale: when both Eventbrite and 4TheFans have data, a small count
 * discrepancy can exist due to processing lag. Taking the max gives the
 * most-complete reading and is directionally conservative (never
 * under-reports). If only one source exists the max is trivially that value.
 *
 * Returns rows sorted by `date ASC`.
 */
export async function bestDailyTicketsForEvent(
  supabase: AnySupabaseClient,
  eventId: string,
  from: string,
  to: string,
): Promise<BestDailyTickets[]> {
  const rows = await getDailyTicketHistoryForEvent(supabase, eventId, from, to);
  if (rows.length === 0) return [];

  // Group by date, keep the row with the highest tickets_sold.
  const byDate = new Map<string, DailyTicketHistoryRow>();
  for (const row of rows) {
    const existing = byDate.get(row.date);
    if (!existing || row.tickets_sold > existing.tickets_sold) {
      byDate.set(row.date, row);
    }
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => ({
      date,
      tickets_sold: row.tickets_sold,
      source: row.source,
    }));
}

// ─── Upsert helper (used by cron + admin backfill) ─────────────────────────

export interface UpsertDailyTicketHistoryInput {
  userId: string;
  eventId: string;
  date: string;
  source: TicketHistorySource;
  ticketsSold: number;
  /** Major currency units (pounds/euros). Stored as minor (×100). */
  revenueMajor: number;
  currency: string | null;
}

/**
 * Upsert one row into `event_daily_ticket_history`.
 *
 * The unique key is `(event_id, date, source)`. On conflict the row is
 * updated with the latest fetch values and `fetched_at = now()`.
 *
 * Requires a service-role client (the table has no authenticated INSERT
 * policy — only the cron / admin routes may write to it).
 */
export async function upsertDailyTicketHistory(
  supabase: AnySupabaseClient,
  input: UpsertDailyTicketHistoryInput,
): Promise<void> {
  const row = {
    user_id: input.userId,
    event_id: input.eventId,
    date: input.date,
    source: input.source,
    tickets_sold: input.ticketsSold,
    revenue_minor: Math.round(input.revenueMajor * 100),
    currency: input.currency ?? null,
    fetched_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("event_daily_ticket_history")
    .upsert(row, { onConflict: "event_id,date,source" });

  if (error) {
    throw new Error(`[ticket-history upsert] ${error.message}`);
  }
}

/**
 * Batch upsert — same semantics as `upsertDailyTicketHistory` but writes
 * all rows in one network round-trip.  Rows with the same `(event_id, date,
 * source)` key are updated.
 */
export async function upsertDailyTicketHistoryBatch(
  supabase: AnySupabaseClient,
  rows: UpsertDailyTicketHistoryInput[],
): Promise<void> {
  if (rows.length === 0) return;

  const now = new Date().toISOString();
  const mapped = rows.map((input) => ({
    user_id: input.userId,
    event_id: input.eventId,
    date: input.date,
    source: input.source,
    tickets_sold: input.ticketsSold,
    revenue_minor: Math.round(input.revenueMajor * 100),
    currency: input.currency ?? null,
    fetched_at: now,
  }));

  const { error } = await supabase
    .from("event_daily_ticket_history")
    .upsert(mapped, { onConflict: "event_id,date,source" });

  if (error) {
    throw new Error(`[ticket-history batch upsert] ${error.message}`);
  }
}
