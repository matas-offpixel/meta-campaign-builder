import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { collapseWeekly, type WeeklySnapshot } from "./event-history-collapse";

/**
 * lib/db/event-history-resolver.ts
 *
 * Single entry point for "give me this event's history" that both the
 * dashboard venue card and the public share page can reuse. Wraps two
 * reads (weekly xlsx/API snapshots and daily Meta+Eventbrite rollups)
 * so surfaces don't reinvent the join every time.
 *
 * Why one helper instead of calling Supabase directly from the
 * component tree:
 *
 *   - The weekly series now has three possible sources
 *     (`ticket_sales_snapshots.source` — eventbrite / xlsx_import /
 *     manual). The resolver collapses them into a single ordered
 *     series per-event with consistent tie-breaking (manual wins
 *     over xlsx, xlsx wins over eventbrite when the same snapshot
 *     date exists in more than one lane). Callers just receive the
 *     resolved series.
 *   - The chart component's granularity toggle (Weekly vs Daily)
 *     wants a yes/no signal "has ≥7 days of daily data" without
 *     having to re-scan the daily array client-side.
 *
 * Thread-boundary: server-only. Callers are either RSCs or API
 * routes. The pure `collapseWeekly` helper lives in
 * `event-history-collapse.ts` so unit tests can reach it without
 * tripping the `server-only` guard.
 */

export { collapseWeekly } from "./event-history-collapse";
export type { WeeklySnapshot } from "./event-history-collapse";

export interface DailyHistoryRollup {
  date: string;
  ad_spend: number | null;
  ad_spend_allocated: number | null;
  tickets_sold: number | null;
  revenue: number | null;
}

export interface EventHistory {
  eventId: string;
  weekly: WeeklySnapshot[];
  daily: DailyHistoryRollup[];
  /** `true` when `daily.length >= 7`. Controls whether the UI's
   *  Daily granularity toggle is selectable — fewer than a week of
   *  rollups makes a daily chart meaningless. */
  hasDailyCoverage: boolean;
}

/**
 * Compose one event's history. Accepts an already-constructed
 * Supabase client so the caller can pick service-role (share-page
 * server component) or user-session (internal dashboard) scope.
 *
 * Returns empty arrays on any read failure rather than throwing —
 * history is decorative; if it fails the chart/table hide themselves
 * and the venue card still renders the authoritative topline
 * numbers from the rollup aggregator.
 */
export async function composeEventHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient | any,
  eventId: string,
): Promise<EventHistory> {
  const [weeklyRes, dailyRes] = await Promise.all([
    supabase
      .from("ticket_sales_snapshots")
      .select("snapshot_at, tickets_sold, source")
      .eq("event_id", eventId)
      .order("snapshot_at", { ascending: true }),
    supabase
      .from("event_daily_rollups")
      .select("date, ad_spend, ad_spend_allocated, tickets_sold, revenue")
      .eq("event_id", eventId)
      .order("date", { ascending: true }),
  ]);

  // Log-then-swallow — the venue card's aggregator still has the
  // authoritative topline; missing history just hides the trend chart.
  if (weeklyRes.error) {
    console.warn(
      "[event-history-resolver] weekly read failed",
      weeklyRes.error.message,
    );
  }
  if (dailyRes.error) {
    console.warn(
      "[event-history-resolver] daily read failed",
      dailyRes.error.message,
    );
  }

  const weekly = collapseWeekly(
    (weeklyRes.data ?? []) as Array<{
      snapshot_at: string;
      tickets_sold: number;
      source: string;
    }>,
  );

  const daily = ((dailyRes.data ?? []) as Array<DailyHistoryRollup>).map(
    (r) => ({
      date: r.date,
      ad_spend: r.ad_spend != null ? Number(r.ad_spend) : null,
      ad_spend_allocated:
        r.ad_spend_allocated != null ? Number(r.ad_spend_allocated) : null,
      tickets_sold: r.tickets_sold,
      revenue: r.revenue != null ? Number(r.revenue) : null,
    }),
  );

  return {
    eventId,
    weekly,
    daily,
    hasDailyCoverage: daily.length >= 7,
  };
}
