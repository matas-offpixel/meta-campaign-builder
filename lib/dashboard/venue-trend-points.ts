/**
 * lib/dashboard/venue-trend-points.ts
 *
 * Pure helpers that build TrendChartPoint / cumulative-timeline arrays
 * from venue ticket snapshot rows + the per-event `tier_channel_sales`
 * SUM that captures all-channel cumulative tickets.
 *
 * Why this module gets bigger
 * ---------------------------
 * `ticket_sales_snapshots` is per-source (4TF, Eventbrite, manual,
 * xlsx_import). Source coverage differs:
 *   - xlsx_import = all channels (4TF + Venue + ...) at the date the
 *     operator imported.
 *   - fourthefans = 4TF-channel only, per cron sync.
 *   - eventbrite  = Eventbrite-channel only, per cron sync.
 *   - manual      = whatever the operator typed.
 *
 * Mixing cumulatives across sources naively produces phantom drops:
 *   Apr 28 xlsx_import = 878 (all channels)
 *   Apr 29 fourthefans = 284 (4TF only — Venue not tracked here)
 *
 * The fix used here is a per-event MONOTONIC ENVELOPE: at each date,
 * the cumulative tickets for the event is the running max of every
 * snapshot row on or before that date AND the current
 * `tier_channel_sales` SUM (when the event has one). This
 *   - handles the Apr 28 → 29 cliff (878 carries forward),
 *   - matches the Event Breakdown row at "today" because the
 *     tier_channel_sales SUM is the authoritative all-channel total,
 *   - never decreases — refunds/data-corrections collapse to 0 deltas
 *     instead of negative ones (operator-friendly).
 *
 * Why we don't write a `tier_channel_sales_history` table:
 * `tier_channel_sales` is upsert-only — each (event, tier, channel)
 * row carries the *current* running total, not a per-day history. We
 * already have the per-source history in `ticket_sales_snapshots`
 * and the operator-channel current total in `tier_channel_sales`;
 * combining the two via the envelope is enough to fix all three
 * Manchester WC26 bugs without a new table or cron job.
 */

import type { WeeklyTicketSnapshotRow } from "@/lib/db/client-portal-server";
import type { TrendChartPoint } from "@/lib/dashboard/trend-chart-data";

/**
 * Per-event SUM of `tier_channel_sales.tickets_sold` (and revenue).
 * `null` keys are events without any tier_channel_sales rows — they
 * fall through to snapshot-only behaviour.
 */
export interface TierChannelSalesAnchorRow {
  event_id: string;
  tickets: number | null;
  revenue: number | null;
}

/**
 * One step of the per-event cumulative timeline. `cumulative` is
 * monotonic non-decreasing — see envelope rule above.
 */
export interface CumulativeTicketStep {
  date: string;
  cumulative: number;
  cumulativeRevenue: number | null;
}

/**
 * Build the monotonic cumulative envelope for a single event.
 *
 * Inputs
 *   - rows: every `ticket_sales_snapshots` row for the event,
 *           regardless of source. Multiple rows per date are allowed
 *           (we take the max).
 *   - anchor: the current `tier_channel_sales` SUM for the event
 *             (or null when the event has no multi-channel breakdown).
 *   - todayIso: ISO date used as the anchor date for `anchor`.
 *
 * Output
 *   A sorted-asc array with one step per date that contributed signal.
 *   The last step is always either `todayIso` (when an anchor is
 *   present) or the latest snapshot date.
 */
export function buildEventCumulativeTicketTimeline(
  rows: WeeklyTicketSnapshotRow[],
  anchor: { tickets: number | null; revenue: number | null } | null,
  todayIso: string,
): CumulativeTicketStep[] {
  // 1. Group by date — keep the max across sources for each date so a
  //    higher-coverage source (xlsx_import all-channel) wins over a
  //    narrower one (fourthefans 4TF-only) on the same day.
  const maxByDate = new Map<string, number>();
  for (const row of rows) {
    const date = row.snapshot_at;
    const cur = maxByDate.get(date);
    const value = row.tickets_sold;
    if (cur === undefined || value > cur) {
      maxByDate.set(date, value);
    }
  }

  // 2. Walk dates ascending, applying running max — cumulative never
  //    decreases. A lower fourthefans Apr 29 (284) carries forward the
  //    higher xlsx_import Apr 28 (878).
  const sortedDates = [...maxByDate.keys()].sort();
  const steps: CumulativeTicketStep[] = [];
  let runningMax = 0;
  for (const date of sortedDates) {
    const value = maxByDate.get(date) ?? 0;
    if (value > runningMax) runningMax = value;
    steps.push({ date, cumulative: runningMax, cumulativeRevenue: null });
  }

  // 3. Anchor today to the tier_channel_sales SUM. This is the
  //    cross-channel authoritative total — guaranteed >= any single-
  //    source snapshot once the operator has seeded operator-owned
  //    channels (Venue, etc.). Apply running max so a stale anchor
  //    can't pull the line below the latest snapshot.
  if (anchor && anchor.tickets != null && Number.isFinite(anchor.tickets)) {
    const anchored = Math.max(runningMax, anchor.tickets);
    const last = steps[steps.length - 1];
    if (last && last.date === todayIso) {
      last.cumulative = anchored;
      last.cumulativeRevenue = anchor.revenue ?? null;
    } else if (anchored > runningMax || anchor.revenue != null) {
      steps.push({
        date: todayIso,
        cumulative: anchored,
        cumulativeRevenue: anchor.revenue ?? null,
      });
    } else if (steps.length > 0) {
      // Anchor matches the running max — keep timeline as-is but
      // still mark the latest revenue if we know it.
      const tail = steps[steps.length - 1]!;
      if (tail.cumulativeRevenue == null && anchor.revenue != null) {
        tail.cumulativeRevenue = anchor.revenue;
      }
    } else if (anchor.tickets > 0 || (anchor.revenue ?? 0) > 0) {
      steps.push({
        date: todayIso,
        cumulative: anchor.tickets,
        cumulativeRevenue: anchor.revenue ?? null,
      });
    }
  }

  return steps;
}

/**
 * Convert a venue's per-event cumulative timelines into TrendChartPoint
 * records tagged as `ticketsKind: "cumulative_snapshot"`.
 *
 * The aggregator's carry-forward pass (see
 * `lib/dashboard/trend-chart-data.ts`) then fills every calendar day
 * between adjacent snapshot dates with the last known cumulative total,
 * producing the smooth growing tickets line on the trend chart.
 *
 * `weeklyTicketSnapshots` may be the source-stitched
 * `trendTicketSnapshots` (per-day priority resolution) — we don't rely
 * on that pre-collapse for correctness, the envelope handles it.
 *
 * `tierChannelAnchors` is the per-event tier_channel_sales SUM. Pass
 * `[]` for callers that don't yet have it; the envelope falls back to
 * snapshot-only behaviour.
 */
export function buildVenueTicketSnapshotPoints(
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[],
  venueEventIds: Set<string>,
  options?: {
    tierChannelAnchors?: TierChannelSalesAnchorRow[];
    todayIso?: string;
  },
): TrendChartPoint[] {
  const todayIso = options?.todayIso ?? todayInLondon();

  // Group snapshot rows by event, keeping only rows for this venue.
  const byEvent = new Map<string, WeeklyTicketSnapshotRow[]>();
  for (const row of weeklyTicketSnapshots) {
    if (!venueEventIds.has(row.event_id)) continue;
    const rows = byEvent.get(row.event_id) ?? [];
    rows.push(row);
    byEvent.set(row.event_id, rows);
  }

  // Index tier_channel_sales anchors by event.
  const anchorsByEvent = new Map<
    string,
    { tickets: number | null; revenue: number | null }
  >();
  for (const anchor of options?.tierChannelAnchors ?? []) {
    if (!venueEventIds.has(anchor.event_id)) continue;
    anchorsByEvent.set(anchor.event_id, {
      tickets: anchor.tickets,
      revenue: anchor.revenue,
    });
  }

  // Make sure events that have an anchor but no snapshots still
  // surface a final today-row (operator-only channels, no API sync).
  for (const eventId of anchorsByEvent.keys()) {
    if (!byEvent.has(eventId)) byEvent.set(eventId, []);
  }

  if (byEvent.size === 0) return [];

  // Per-event monotonic envelopes.
  const timelinesByEvent = new Map<string, CumulativeTicketStep[]>();
  const dates = new Set<string>();
  for (const [eventId, rows] of byEvent) {
    const timeline = buildEventCumulativeTicketTimeline(
      rows,
      anchorsByEvent.get(eventId) ?? null,
      todayIso,
    );
    timelinesByEvent.set(eventId, timeline);
    for (const step of timeline) dates.add(step.date);
  }

  if (dates.size === 0) return [];

  // For each distinct date across events, sum each event's running
  // cumulative on or before that date (carry-forward per event).
  const sortedDates = [...dates].sort();
  return sortedDates.map((date) => {
    let total = 0;
    let revenueTotal = 0;
    let hasTickets = false;
    let hasRevenue = false;
    for (const timeline of timelinesByEvent.values()) {
      // Walk backward to find the most recent step on or before `date`.
      for (let i = timeline.length - 1; i >= 0; i--) {
        const step = timeline[i]!;
        if (step.date <= date) {
          total += step.cumulative;
          hasTickets = true;
          if (step.cumulativeRevenue != null) {
            revenueTotal += step.cumulativeRevenue;
            hasRevenue = true;
          }
          break;
        }
      }
    }
    return {
      date,
      spend: null,
      tickets: hasTickets ? total : null,
      revenue: hasRevenue ? revenueTotal : null,
      linkClicks: null,
      ticketsKind: "cumulative_snapshot" as const,
    };
  });
}

/**
 * Sum the per-event cumulative envelopes into a venue-wide
 * `(date → cumulativeTickets)` timeline, used by the daily-tracker
 * delta path so days with no movement collapse cleanly.
 *
 * Always returns a sorted-asc array. Empty when the venue has no
 * snapshots and no tier_channel_sales rows.
 */
export function buildVenueCumulativeTicketTimeline(
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[],
  venueEventIds: Set<string>,
  options?: {
    tierChannelAnchors?: TierChannelSalesAnchorRow[];
    todayIso?: string;
  },
): Array<{ date: string; cumulative: number }> {
  const points = buildVenueTicketSnapshotPoints(
    weeklyTicketSnapshots,
    venueEventIds,
    options,
  );
  return points
    .filter(
      (p): p is TrendChartPoint & { tickets: number } =>
        p.tickets != null && Number.isFinite(p.tickets),
    )
    .map((p) => ({ date: p.date, cumulative: p.tickets }));
}

/**
 * Compute per-day ticket deltas from a sorted cumulative timeline.
 * Returns a Map keyed by date — only entries with a strictly positive
 * delta are emitted. Day 0 (the earliest cumulative) emits its full
 * cumulative value as the initial delta so the tracker shows
 * "first day of sales = N tickets".
 */
export function ticketDeltasFromCumulativeTimeline(
  timeline: Array<{ date: string; cumulative: number }>,
): Map<string, number> {
  const deltas = new Map<string, number>();
  let prev = 0;
  for (const step of timeline) {
    const delta = Math.max(0, step.cumulative - prev);
    prev = step.cumulative;
    if (delta > 0) deltas.set(step.date, delta);
  }
  return deltas;
}

/**
 * "Today" in Europe/London for UK clients. The whole 4theFans roster
 * lives there and the dashboard's other date-bucket helpers use the
 * same approximation. Returns YYYY-MM-DD.
 */
function todayInLondon(): string {
  // Intl gives us the calendar date in the requested timezone without
  // needing a tz library — Europe/London handles BST/GMT for free.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}
