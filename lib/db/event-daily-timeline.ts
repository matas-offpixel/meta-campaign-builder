import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EventDailyRollup } from "@/lib/db/event-daily-rollups";
import { listRollupsForEvent } from "@/lib/db/event-daily-rollups";

/**
 * lib/db/event-daily-timeline.ts
 *
 * Single source of truth for the per-day numbers that feed the event
 * report block (summary header, trend chart, and tracker table).
 *
 * Two upstream tables can carry "what happened on day X for event Y":
 *
 *   - `daily_tracking_entries` — operator-typed numbers (the legacy
 *     Excel sheet WC clients still maintain by hand).
 *   - `event_daily_rollups`    — auto-synced from Meta + Eventbrite.
 *
 * The block renders one timeline regardless of which side carries the
 * data; this helper is the merge point. Per-date precedence: manual
 * wins over live so an operator override is never silently buried by
 * the next sync. Each row carries the `source` tag the UI uses to
 * render the "Manual" / "Live" badge.
 *
 * Why per-date precedence rather than all-or-nothing:
 *   The user's prompt phrasing ("prefer manual, fall back to live")
 *   is ambiguous, but the per-row badge requirement implies the two
 *   can coexist. Per-date precedence keeps the timeline complete
 *   when the operator has only annotated a few days — those days
 *   are "Manual", the rest stay "Live".
 *
 * The notes column behaves the same way: a manual row's notes win,
 * else live notes. There is no concatenation — operators don't
 * expect their typed note to be appended to a synced one.
 */

export type TimelineSource = "manual" | "live";

export interface TimelineRow {
  /** YYYY-MM-DD in the event's reporting timezone. */
  date: string;
  /** Which upstream table fed this row. */
  source: TimelineSource;
  ad_spend: number | null;
  link_clicks: number | null;
  tickets_sold: number | null;
  revenue: number | null;
  notes: string | null;
  /** Newest source_*_at across both legs (rollup) or the manual
   *  updated_at. Drives the "stale" guard for auto-sync. */
  freshness_at: string | null;
}

export interface ManualDailyEntry {
  date: string;
  day_spend: number | null;
  tickets: number | null;
  revenue: number | null;
  link_clicks: number | null;
  notes: string | null;
  updated_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;
function asAny(supabase: AnySupabaseClient): AnySupabaseClient {
  return supabase;
}

/**
 * Fetch every manual `daily_tracking_entries` row for a single event.
 * Returns an empty array on error so the live-only fallback always
 * works. Sorted ASC by date for deterministic merging.
 */
export async function listManualEntriesForEvent(
  supabase: AnySupabaseClient,
  eventId: string,
): Promise<ManualDailyEntry[]> {
  const { data, error } = await asAny(supabase)
    .from("daily_tracking_entries")
    .select("date, day_spend, tickets, revenue, link_clicks, notes, updated_at")
    .eq("event_id", eventId)
    .order("date", { ascending: true });
  if (error) {
    console.warn("[event-daily-timeline manual]", error.message);
    return [];
  }
  return (data ?? []) as unknown as ManualDailyEntry[];
}

/**
 * Merge live rollup rows + manual entries into a single timeline,
 * applying per-date precedence (manual wins) and tagging each row
 * with the source it came from. Output is sorted DESC by date so
 * the table renders newest-first without an extra reverse.
 */
export function mergeTimeline(
  rollups: EventDailyRollup[],
  manual: ManualDailyEntry[],
): TimelineRow[] {
  const byDate = new Map<string, TimelineRow>();

  // Start with the live rollups so manual rows can overwrite by date.
  for (const r of rollups) {
    const meta = r.source_meta_at ? Date.parse(r.source_meta_at) : 0;
    const eb = r.source_eventbrite_at
      ? Date.parse(r.source_eventbrite_at)
      : 0;
    const fresh = Math.max(meta, eb);
    byDate.set(r.date, {
      date: r.date,
      source: "live",
      ad_spend: r.ad_spend != null ? Number(r.ad_spend) : null,
      link_clicks: r.link_clicks ?? null,
      tickets_sold: r.tickets_sold ?? null,
      revenue: r.revenue != null ? Number(r.revenue) : null,
      notes: r.notes ?? null,
      freshness_at: fresh > 0 ? new Date(fresh).toISOString() : null,
    });
  }

  for (const m of manual) {
    byDate.set(m.date, {
      date: m.date,
      source: "manual",
      ad_spend: m.day_spend != null ? Number(m.day_spend) : null,
      link_clicks: m.link_clicks ?? null,
      tickets_sold: m.tickets ?? null,
      revenue: m.revenue != null ? Number(m.revenue) : null,
      notes: m.notes ?? null,
      freshness_at: m.updated_at,
    });
  }

  return [...byDate.values()].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );
}

/**
 * Convenience for callers that want both reads in one round-trip
 * (every call site does). Returns the merged timeline plus the raw
 * sides so callers needing presale rollup math (which is rollup-only)
 * still have what they need.
 */
export interface EventDailyTimeline {
  timeline: TimelineRow[];
  rollups: EventDailyRollup[];
  manualCount: number;
}

export async function loadEventDailyTimeline(
  supabase: AnySupabaseClient,
  eventId: string,
): Promise<EventDailyTimeline> {
  const [rollups, manual] = await Promise.all([
    listRollupsForEvent(supabase, eventId),
    listManualEntriesForEvent(supabase, eventId),
  ]);
  return {
    timeline: mergeTimeline(rollups, manual),
    rollups,
    manualCount: manual.length,
  };
}

/**
 * Pre-launch / "Presale" rollup bucket — every rollup row strictly
 * before `general_sale_at::date` summed into one. Returns null when
 * the cutoff isn't set (caller should render the table flat) or
 * when no rows fall in the bucket.
 *
 * Lives next to the timeline merge because the bucket is conceptually
 * the same operation (collapsing multiple per-day rows into a single
 * higher-level grouping); both the GET /rollup route and the share
 * page server-load this without duplicating the math.
 *
 * Rollup-only by design: operators don't type "presale" entries —
 * the manual `daily_tracking_entries` rows are individual days that
 * the regular timeline merge handles. So this takes
 * `EventDailyRollup[]` rather than `TimelineRow[]`.
 */
export interface PresaleBucket {
  /** ISO date (general_sale_at) — the cutoff used to compute the bucket. */
  cutoffDate: string;
  ad_spend: number | null;
  link_clicks: number | null;
  tickets_sold: number | null;
  revenue: number | null;
  /** Number of rollup rows folded into the bucket. */
  daysCount: number;
  /** Earliest date covered by the bucket (for the "from" label). */
  earliestDate: string | null;
}

export function computePresaleBucket(
  rows: EventDailyRollup[],
  generalSaleAt: string | null,
): PresaleBucket | null {
  if (!generalSaleAt) return null;
  // general_sale_at is a timestamptz; strip to date in the UTC form
  // Postgres gives us. Comparing date strings lexicographically is
  // safe for canonical YYYY-MM-DD.
  const cutoffDate = generalSaleAt.slice(0, 10);
  const presaleRows = rows.filter((r) => r.date < cutoffDate);
  if (presaleRows.length === 0) return null;

  let ad_spend: number | null = null;
  let link_clicks: number | null = null;
  let tickets_sold: number | null = null;
  let revenue: number | null = null;
  let earliestDate: string | null = null;

  for (const r of presaleRows) {
    if (r.ad_spend != null) ad_spend = (ad_spend ?? 0) + Number(r.ad_spend);
    if (r.link_clicks != null) link_clicks = (link_clicks ?? 0) + r.link_clicks;
    if (r.tickets_sold != null)
      tickets_sold = (tickets_sold ?? 0) + r.tickets_sold;
    if (r.revenue != null) revenue = (revenue ?? 0) + Number(r.revenue);
    if (!earliestDate || r.date < earliestDate) earliestDate = r.date;
  }

  return {
    cutoffDate,
    ad_spend: ad_spend != null ? round2(ad_spend) : null,
    link_clicks,
    tickets_sold,
    revenue: revenue != null ? round2(revenue) : null,
    daysCount: presaleRows.length,
    earliestDate,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
