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
import type { TierChannelDailyHistoryRow } from "@/lib/db/tier-channel-daily-history";
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
 *
 * `isSmoothed` is true when the step came from a
 * `tier_channel_sales_daily_history` row with
 * source_kind = 'smoothed_historical'. The value is a proportional
 * estimate rather than a live snapshot, so the trend chart tooltip
 * shows "(est.)" for those days.
 */
export interface CumulativeTicketStep {
  date: string;
  cumulative: number;
  cumulativeRevenue: number | null;
  isSmoothed?: boolean;
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
 *   - dailyHistoryRows (optional): per-day rows from
 *     `tier_channel_sales_daily_history` for this event. When present
 *     these take priority over the snapshot envelope for their dates.
 *     source_kind = 'smoothed_historical' rows are tagged `isSmoothed`
 *     so the chart tooltip can show "(est.)".
 *
 * Priority order:
 *   1. `tier_channel_sales_daily_history` when present for a date
 *   2. `ticket_sales_snapshots` monotonic envelope as fallback
 *   3. Today's `tier_channel_sales` SUM anchor (unchanged)
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
  dailyHistoryRows?: TierChannelDailyHistoryRow[],
): CumulativeTicketStep[] {
  // 1. Build daily_history lookup by date.
  //    When a row exists for a date, it overrides the envelope.
  const historyByDate = new Map<
    string,
    { cumulative: number; revenue: number; isSmoothed: boolean }
  >();
  for (const hr of dailyHistoryRows ?? []) {
    historyByDate.set(hr.snapshot_date, {
      cumulative: Number(hr.tickets_sold_total),
      revenue: Number(hr.revenue_total),
      isSmoothed: hr.source_kind === "smoothed_historical",
    });
  }

  // 2. Build envelope: group snapshot rows by date — keep the max
  //    across sources for each date so a higher-coverage source
  //    (xlsx_import all-channel) wins over a narrower one
  //    (fourthefans 4TF-only) on the same day.
  const maxByDate = new Map<string, number>();
  for (const row of rows) {
    const date = row.snapshot_at;
    const cur = maxByDate.get(date);
    const value = row.tickets_sold;
    if (cur === undefined || value > cur) {
      maxByDate.set(date, value);
    }
  }

  // 3. Merge: all distinct dates from either source.
  const allDates = new Set([...maxByDate.keys(), ...historyByDate.keys()]);
  const sortedDates = [...allDates].sort();

  // 4. Walk ascending. For each date:
  //    - If daily_history covers it → use that value (already cumulative)
  //    - Otherwise → apply running max over the envelope value
  //    Running max is always applied to guarantee monotonicity when
  //    the two sources are mixed.
  const steps: CumulativeTicketStep[] = [];
  let runningMax = 0;
  for (const date of sortedDates) {
    const hist = historyByDate.get(date);
    if (hist !== undefined) {
      // daily_history takes priority — apply running max so an old
      // smoothed row can't regress below a later real cron snapshot.
      if (hist.cumulative > runningMax) runningMax = hist.cumulative;
      steps.push({
        date,
        cumulative: runningMax,
        cumulativeRevenue: hist.revenue,
        isSmoothed: hist.isSmoothed,
      });
    } else {
      const value = maxByDate.get(date) ?? 0;
      if (value > runningMax) runningMax = value;
      steps.push({ date, cumulative: runningMax, cumulativeRevenue: null });
    }
  }

  // 5. Anchor today to the tier_channel_sales SUM. This is the
  //    cross-channel authoritative total — guaranteed >= any single-
  //    source snapshot once the operator has seeded operator-owned
  //    channels (Venue, etc.). Apply running max so a stale anchor
  //    can't pull the line below the latest snapshot.
  if (anchor && anchor.tickets != null && Number.isFinite(anchor.tickets)) {
    const anchored = Math.max(runningMax, anchor.tickets);
    const last = steps[steps.length - 1];
    if (last && last.date === todayIso) {
      last.cumulative = anchored;
      last.cumulativeRevenue = anchor.revenue ?? last.cumulativeRevenue ?? null;
    } else if (anchored > runningMax || anchor.revenue != null) {
      steps.push({
        date: todayIso,
        cumulative: anchored,
        cumulativeRevenue: anchor.revenue ?? null,
      });
    } else if (steps.length > 0) {
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
    /**
     * Per-day snapshots from `tier_channel_sales_daily_history`.
     * When present for a date, these take priority over the
     * `ticket_sales_snapshots` envelope for that date.
     */
    dailyHistory?: TierChannelDailyHistoryRow[];
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

  // Group daily_history rows by event.
  const dailyHistByEvent = new Map<string, TierChannelDailyHistoryRow[]>();
  for (const hr of options?.dailyHistory ?? []) {
    if (!venueEventIds.has(hr.event_id)) continue;
    const list = dailyHistByEvent.get(hr.event_id) ?? [];
    list.push(hr);
    dailyHistByEvent.set(hr.event_id, list);
  }

  // Make sure events that have an anchor but no snapshots still
  // surface a final today-row (operator-only channels, no API sync).
  for (const eventId of anchorsByEvent.keys()) {
    if (!byEvent.has(eventId)) byEvent.set(eventId, []);
  }
  // Events that only have daily_history but no snapshots.
  for (const eventId of dailyHistByEvent.keys()) {
    if (!byEvent.has(eventId)) byEvent.set(eventId, []);
  }

  if (byEvent.size === 0) return [];

  // Per-event monotonic envelopes (with daily_history priority).
  const timelinesByEvent = new Map<string, CumulativeTicketStep[]>();
  const dates = new Set<string>();
  for (const [eventId, rows] of byEvent) {
    const timeline = buildEventCumulativeTicketTimeline(
      rows,
      anchorsByEvent.get(eventId) ?? null,
      todayIso,
      dailyHistByEvent.get(eventId),
    );
    timelinesByEvent.set(eventId, timeline);
    for (const step of timeline) dates.add(step.date);
  }

  if (dates.size === 0) return [];

  // For each distinct date across events, sum each event's running
  // cumulative on or before that date (carry-forward per event).
  // If ANY contributing step is smoothed, the combined point is also
  // marked smoothed so the tooltip shows "(est.)".
  const sortedDates = [...dates].sort();
  return sortedDates.map((date) => {
    let total = 0;
    let revenueTotal = 0;
    let hasTickets = false;
    let hasRevenue = false;
    let anySmoothed = false;
    for (const timeline of timelinesByEvent.values()) {
      for (let i = timeline.length - 1; i >= 0; i--) {
        const step = timeline[i]!;
        if (step.date <= date) {
          total += step.cumulative;
          hasTickets = true;
          if (step.cumulativeRevenue != null) {
            revenueTotal += step.cumulativeRevenue;
            hasRevenue = true;
          }
          if (step.isSmoothed) anySmoothed = true;
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
      ticketsSmoothed: anySmoothed || undefined,
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
    dailyHistory?: TierChannelDailyHistoryRow[];
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

// Re-export TierChannelDailyHistoryRow so callers can import from this
// module without reaching into the db layer directly.
export type { TierChannelDailyHistoryRow };

/**
 * Build venue-wide cumulative ticket and revenue timelines directly
 * from `tier_channel_sales_daily_history` rows, bypassing the
 * snapshot-envelope path entirely.
 *
 * Each event's daily_history rows are carry-forwarded so that on dates
 * where one event has no row the previous known value is used (handles
 * events that started capturing at different times). The per-event
 * carry-forward totals are then summed per calendar date to produce a
 * venue-wide monotonic cumulative.
 *
 * Returns empty arrays when `dailyHistory` is empty (caller falls back
 * to the snapshot envelope via `ticketDeltasFromCumulativeTimeline`).
 */
export function buildVenueDailyHistoryTimelines(
  dailyHistory: TierChannelDailyHistoryRow[],
  venueEventIds: Set<string>,
): {
  tickets: Array<{ date: string; cumulative: number }>;
  revenue: Array<{ date: string; cumulative: number }>;
} {
  // Group daily_history rows by event, filtering to this venue only.
  const byEvent = new Map<string, Map<string, { tickets: number; revenue: number }>>();
  for (const row of dailyHistory) {
    if (!venueEventIds.has(row.event_id)) continue;
    const map = byEvent.get(row.event_id) ?? new Map();
    map.set(row.snapshot_date, {
      tickets: Number(row.tickets_sold_total),
      revenue: Number(row.revenue_total),
    });
    byEvent.set(row.event_id, map);
  }

  if (byEvent.size === 0) {
    return { tickets: [], revenue: [] };
  }

  // Collect all distinct dates across all events.
  const allDates = new Set<string>();
  for (const map of byEvent.values()) {
    for (const date of map.keys()) allDates.add(date);
  }

  const sortedDates = [...allDates].sort();

  // Per-event carry-forward state — holds the last known cumulative for
  // each event so gaps in coverage are filled with the prior value.
  const lastTickets = new Map<string, number>();
  const lastRevenue = new Map<string, number>();

  const ticketsCumulative: Array<{ date: string; cumulative: number }> = [];
  const revenueCumulative: Array<{ date: string; cumulative: number }> = [];

  for (const date of sortedDates) {
    let venueTickets = 0;
    let venueRevenue = 0;
    for (const [eventId, map] of byEvent) {
      const row = map.get(date);
      if (row !== undefined) {
        lastTickets.set(eventId, row.tickets);
        lastRevenue.set(eventId, row.revenue);
        venueTickets += row.tickets;
        venueRevenue += row.revenue;
      } else {
        // Carry forward last known value (0 before first row).
        venueTickets += lastTickets.get(eventId) ?? 0;
        venueRevenue += lastRevenue.get(eventId) ?? 0;
      }
    }
    ticketsCumulative.push({ date, cumulative: venueTickets });
    revenueCumulative.push({ date, cumulative: venueRevenue });
  }

  return { tickets: ticketsCumulative, revenue: revenueCumulative };
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
