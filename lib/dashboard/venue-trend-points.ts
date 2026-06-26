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
import {
  collapseSnapshotsToOnePerDay,
  type MailchimpSnapshotRow,
} from "@/lib/mailchimp/compute-registrations";

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
 *
 * `isReconciliation` is true when EVERY `ticket_sales_snapshots` row that
 * set the cumulative on this date has a source in
 * `RECONCILIATION_SNAPSHOT_SOURCES` (manual/xlsx_import). The cumulative
 * value is still correct (the row raises the envelope ceiling), but the
 * delta for this date must NOT be emitted as a daily sale — it is an
 * operator reconciliation write.
 */
export interface CumulativeTicketStep {
  date: string;
  cumulative: number;
  cumulativeRevenue: number | null;
  isSmoothed?: boolean;
  isReconciliation?: boolean;
}

/**
 * `ticket_sales_snapshots.source` values that represent operator
 * reconciliation writes rather than real-time ticketing API events.
 *
 * Rows with these sources raise the envelope ceiling (lifetime totals stay
 * accurate) but must NOT emit a per-day delta in the daily tracker, because
 * the cumulative jump is a deliberate back-fill, not an organic sale on that
 * calendar day.
 *
 * DO NOT include real-time sources (eventbrite, fourthefans, foursomething)
 * here — those must continue to produce deltas.  Per
 * `feedback_collapse_strategy_per_consumer`: keep this separate from
 * `MANUAL_SOURCE_KINDS` (which lives on `tier_channel_sales_daily_history`
 * and has OPPOSITE semantics — it BYPASSES the corroboration gate instead
 * of suppressing emission).
 */
export const RECONCILIATION_SNAPSHOT_SOURCES: ReadonlySet<string> = new Set([
  "manual",
  "xlsx_import",
]);

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
  //
  //    Also track whether EVERY snapshot row for a given date is a
  //    reconciliation source (manual/xlsx_import). Those dates advance the
  //    envelope ceiling but must NOT emit a per-day delta in the tracker —
  //    the jump is an operator reconciliation write, not a real organic sale.
  //    See `RECONCILIATION_SNAPSHOT_SOURCES`.
  //
  //    After `collapseTrendPerEventStitched` there is at most one row per
  //    date (highest-priority source wins per day). A date is
  //    reconciliation-only when that winning source is in
  //    `RECONCILIATION_SNAPSHOT_SOURCES`.
  const maxByDate = new Map<string, number>();
  const reconciliationOnlyDates = new Set<string>();
  for (const row of rows) {
    const date = row.snapshot_at;
    const cur = maxByDate.get(date);
    const value = row.tickets_sold;
    if (cur === undefined || value > cur) {
      maxByDate.set(date, value);
    }
    if (RECONCILIATION_SNAPSHOT_SOURCES.has(row.source)) {
      if (!maxByDate.has(date) || cur === undefined) {
        reconciliationOnlyDates.add(date);
      }
    } else {
      // Any non-reconciliation row on this date means the date has real
      // organic signal — it must NOT be suppressed.
      reconciliationOnlyDates.delete(date);
    }
  }

  // 3. Merge: all distinct dates from either source.
  const allDates = new Set([...maxByDate.keys(), ...historyByDate.keys()]);
  const sortedDates = [...allDates].sort();

  // 4. Walk ascending. For each date:
  //    - If daily_history covers it → use that value (already cumulative).
  //      daily_history steps are NEVER reconciliation (they come from the
  //      cron or smoothed estimates, never from snapshot manual writes).
  //    - Otherwise → apply running max over the envelope value.
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
        // daily_history is authoritative cron data — never reconciliation.
        isReconciliation: false,
      });
    } else {
      const value = maxByDate.get(date) ?? 0;
      if (value > runningMax) runningMax = value;
      steps.push({
        date,
        cumulative: runningMax,
        cumulativeRevenue: null,
        isReconciliation: reconciliationOnlyDates.has(date),
      });
    }
  }

  // 5. Anchor today to the live tier_channel_sales SUM — but ONLY when this
  //    event has daily_history, i.e. the line built above is ALREADY the
  //    all-channel cumulative. Then the anchor is a small same-day
  //    reconciliation (today's live sales beyond the end-of-yesterday
  //    snapshot).
  //
  //    When daily_history is ABSENT the line is the 4TF-only snapshot
  //    envelope; anchoring a single-channel line up to the all-channel SUM
  //    via Math.max dumps the entire external-channel volume onto TODAY (the
  //    venue-trend spike — e.g. Brighton +179 CP). So we do NOT anchor in
  //    that case: the 4TF line renders smoothly and the true all-channel
  //    total is surfaced by the topline tile (#454).
  const hasDailyHistory = (dailyHistoryRows?.length ?? 0) > 0;
  if (
    hasDailyHistory &&
    anchor &&
    anchor.tickets != null &&
    Number.isFinite(anchor.tickets)
  ) {
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
 * Convert Mailchimp audience snapshots into TrendChartPoint records tagged as
 * `ticketsKind: "cumulative_snapshot"`.
 *
 * Brand-campaign sibling of `buildVenueTicketSnapshotPoints`. Feeding the
 * output into `aggregateTrendChartPoints` (see `lib/dashboard/trend-chart-data.ts`)
 * activates the canonical carry-forward + lifetime-spend / lifetime-subscribers
 * CPR computation — the exact same arithmetic the venue trend chart uses for
 * ticket CPT. No custom CPR math is needed in the caller.
 *
 * `tickets` carries the absolute subscriber count on each snapshot day. The
 * aggregator's carry-forward pass fills calendar gaps between snapshot dates
 * with the last known cumulative total (subscriber counts don't drop to zero on
 * days without a Mailchimp snapshot).
 */
export function buildMailchimpRegistrationSnapshotPoints(
  snapshots: MailchimpSnapshotRow[],
): TrendChartPoint[] {
  return collapseSnapshotsToOnePerDay(snapshots)
    .filter((s) => s.email_subscribers != null)
    .map((s) => ({
      date: s.snapshot_at.slice(0, 10),
      spend: null,
      tickets: s.email_subscribers as number,
      revenue: null,
      linkClicks: null,
      ticketsKind: "cumulative_snapshot" as const,
    }));
}

/**
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
  // A date is isReconciliation only when ALL events' contributing steps
  // are isReconciliation — mixed real+reconciliation dates still emit
  // deltas (the organic portion is real).
  const sortedDates = [...dates].sort();
  return sortedDates.map((date) => {
    let total = 0;
    let revenueTotal = 0;
    let hasTickets = false;
    let hasRevenue = false;
    let anySmoothed = false;
    let allReconciliation = true; // falsified by any non-reconciliation contributing step
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
          if (!step.isReconciliation) allReconciliation = false;
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
      isReconciliation: hasTickets && allReconciliation ? true : undefined,
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
 *
 * Preserves `isReconciliation` from `buildVenueTicketSnapshotPoints` so
 * `ticketDeltasFromCumulativeTimeline` can suppress phantom daily sales
 * from operator reconciliation writes.
 */
export function buildVenueCumulativeTicketTimeline(
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[],
  venueEventIds: Set<string>,
  options?: {
    tierChannelAnchors?: TierChannelSalesAnchorRow[];
    todayIso?: string;
    dailyHistory?: TierChannelDailyHistoryRow[];
  },
): Array<{ date: string; cumulative: number; isReconciliation?: boolean }> {
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
    .map((p) => ({
      date: p.date,
      cumulative: p.tickets,
      isReconciliation: p.isReconciliation,
    }));
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
 *
 * When a step is flagged `isReconciliation`, the baseline (`prev`) is
 * still advanced to keep subsequent organic deltas correct, but the
 * delta itself is NOT emitted — it is an operator reconciliation write,
 * not an organic sale. See `RECONCILIATION_SNAPSHOT_SOURCES`.
 */
export function ticketDeltasFromCumulativeTimeline(
  timeline: Array<{ date: string; cumulative: number; isReconciliation?: boolean }>,
): Map<string, number> {
  const deltas = new Map<string, number>();
  let prev = 0;
  for (const step of timeline) {
    const delta = Math.max(0, step.cumulative - prev);
    // Always advance the baseline so subsequent organic steps are delta'd
    // against the correct cumulative floor, even on suppressed dates.
    prev = step.cumulative;
    if (delta > 0 && !step.isReconciliation) {
      deltas.set(step.date, delta);
    }
  }
  return deltas;
}

/** Add `days` to a YYYY-MM-DD calendar date in UTC. */
export function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * `source_kind` values in `tier_channel_sales_daily_history` that are
 * treated as authoritative cumulative sources and bypass the rollup
 * corroboration gate. These are operator-entered cumulative counts
 * (entered manually or batch-imported) for clients with no API
 * ticketing connection. Because no live API sync produces rollup
 * activity for these clients, requiring corroboration would suppress
 * every real delta (the J2 Melodic chart-empty bug). `cron` and
 * `smoothed_historical` keep corroboration so phantom correction jumps
 * are still filtered for API-connected clients.
 */
export const MANUAL_SOURCE_KINDS: ReadonlySet<string> = new Set([
  "manual_backfill",
]);

export interface CorroboratedDeltaOptions {
  /**
   * How many days the `tier_channel_sales_daily_history.snapshot_date`
   * leads the true sale day. Measured empirically at +1: a snapshot
   * labelled date D is captured at D−1 23:55 (end of day D−1) and its
   * cumulative delta reflects sales completed on D−1, which the rollup
   * records under date D−1. Verified by value-match on Brighton
   * (hist Δ@D == rollup@D−1, exact on 42/20/8). Default 1.
   */
  offsetDays?: number;
  /**
   * Corroboration window: look for rollup activity within ± this many
   * days of the true sale day (covers intra-day cut-time straddle).
   * Default 1.
   */
  windowDays?: number;
  /**
   * snapshot_dates (step.date values) for which corroboration is
   * bypassed — the delta is emitted directly without checking rollup
   * activity. Populated by `buildCorroboratedDailyDeltas` from history
   * rows whose `source_kind` is in `MANUAL_SOURCE_KINDS`.
   */
  manualBypassDates?: ReadonlySet<string>;
}

/**
 * Per-day deltas from a venue cumulative timeline, corroborated against
 * real sales activity so non-sale cumulative jumps (manual Supabase
 * reconciliations, backfills, tier renames adding rows) do NOT surface
 * as phantom daily sales.
 *
 * For each cumulative step at `snapshot_date` D:
 *   1. raw delta = cumulative(D) − running baseline. The baseline is
 *      ALWAYS advanced to cumulative(D) — both up-corrections and
 *      down-corrections re-base rather than "clamp to 0 and forget", so
 *      the running total ends at the true cumulative and a suppressed
 *      jump never re-appears on a later day.
 *   2. the TRUE sale day is D − offsetDays (the snapshot leads the sale
 *      day — see CorroboratedDeltaOptions). Deltas are emitted keyed by
 *      the true sale day so the tracker shows the sale on the day it
 *      actually happened (fixes the latent PR #378 "sales show up
 *      tomorrow" off-by-one).
 *   3. a positive delta emits as a real daily sale ONLY IF
 *      `rollupActivityDates` has activity within ±windowDays of the true
 *      sale day. This is a PRESENCE gate, not magnitude: the displayed
 *      number is the history delta (the cumulative truth), the rollup is
 *      only the yes/no "was there a real sale here". History delta and
 *      rollup count legitimately differ on real sales (intra-day cuts),
 *      so they are never required to be equal.
 *   4. an uncorroborated positive delta is a correction → suppressed
 *      (but still re-based via step 1). Down-steps emit nothing and
 *      re-base.
 *
 * The FIRST row is treated as the starting baseline, not a one-day sale:
 * `tier_channel_sales_daily_history` carries the cumulative-to-date when
 * capture began (migration 089 backfill / first cron tick), so the first
 * value is a historical total. Emitting it as a single day's sale would
 * spike day 0 — and the ±windowDays corroboration would wrongly confirm
 * it from the next day's real activity. Deltas are emitted from the second
 * row onward.
 *
 * Returns Map<trueSaleDate, delta>.
 */
export function corroboratedDailyDeltas(
  timeline: ReadonlyArray<{ date: string; cumulative: number }>,
  rollupActivityDates: ReadonlySet<string>,
  options?: CorroboratedDeltaOptions,
): Map<string, number> {
  const offset = options?.offsetDays ?? 1;
  const window = options?.windowDays ?? 1;
  const bypassDates = options?.manualBypassDates;
  const out = new Map<string, number>();
  if (timeline.length === 0) return out;
  let prev = timeline[0]!.cumulative; // first row = baseline, not a daily sale
  for (let i = 1; i < timeline.length; i += 1) {
    const step = timeline[i]!;
    const delta = step.cumulative - prev;
    prev = step.cumulative; // always re-base (up- AND down-corrections)
    if (delta <= 0) continue;
    const saleDate = shiftYmd(step.date, -offset);
    // Manual-source rows (manual_backfill) are authoritative cumulative
    // counts entered by operators with no API sync. No rollup activity
    // will ever exist for these dates, so the presence gate is bypassed
    // and the delta surfaces directly. Non-manual rows (cron,
    // smoothed_historical) still require corroboration so phantom
    // correction jumps remain suppressed for API-connected clients.
    if (
      bypassDates?.has(step.date) ||
      hasActivityWithin(saleDate, rollupActivityDates, window)
    ) {
      out.set(saleDate, (out.get(saleDate) ?? 0) + delta);
    }
  }
  return out;
}

function hasActivityWithin(
  date: string,
  activity: ReadonlySet<string>,
  window: number,
): boolean {
  for (let off = -window; off <= window; off += 1) {
    if (activity.has(shiftYmd(date, off))) return true;
  }
  return false;
}

/**
 * Canonical per-day tickets+revenue delta builder shared by BOTH daily
 * tracker surfaces so they cannot diverge:
 *   - the per-EVENT internal tracker (lib/db/event-daily-timeline.ts
 *     `mergeTimeline`), and
 *   - the per-EVENT_CODE venue tracker (components/share/
 *     venue-daily-report-block.tsx `mergeVenueTimeline`).
 *
 * Given the cumulative tickets + revenue timelines from
 * `tier_channel_sales_daily_history` (built by
 * `buildVenueDailyHistoryTimelines` — works for one event_id or a whole
 * venue's set) and the rollup rows used as the corroboration *activity*
 * signal, returns per-day tickets and revenue deltas keyed by the TRUE
 * sale day. Tickets and revenue share ONE date grid + ONE corroboration
 * pass, so they cannot misalign. Suppress / re-base / offset semantics
 * live in `corroboratedDailyDeltas`.
 *
 * The rollup is a yes/no "was there a real sale here" gate (presence,
 * never magnitude) — so an undercounting or catch-up-lumping rollup (e.g.
 * the Eventbrite multi-day lump) still gates correctly while the displayed
 * number comes from the smooth daily-history cumulative.
 */
export function buildCorroboratedDailyDeltas(args: {
  cumulativeTickets: ReadonlyArray<{ date: string; cumulative: number }>;
  cumulativeRevenue: ReadonlyArray<{ date: string; cumulative: number }>;
  rollups: ReadonlyArray<{
    date: string;
    tickets_sold: number | null;
    revenue: number | null;
  }>;
  /**
   * Raw history rows whose `source_kind` is checked against
   * `MANUAL_SOURCE_KINDS`. Any `snapshot_date` belonging to a manual
   * source kind bypasses the rollup corroboration gate so those deltas
   * surface without requiring rollup activity on that date.
   *
   * Pass the same `TierChannelDailyHistoryRow[]` array that was used to
   * build `cumulativeTickets` / `cumulativeRevenue`. When omitted (or
   * empty) all rows go through the standard corroboration path.
   */
  historyRows?: ReadonlyArray<{ snapshot_date: string; source_kind: string }>;
  options?: CorroboratedDeltaOptions;
}): { tickets: Map<string, number>; revenue: Map<string, number> } {
  const activity = new Set<string>();
  for (const r of args.rollups) {
    if ((r.tickets_sold ?? 0) > 0 || (r.revenue ?? 0) > 0) {
      activity.add(r.date);
    }
  }

  // Build the bypass set: snapshot_dates whose source_kind is manual.
  const manualBypassDates = new Set<string>();
  for (const hr of args.historyRows ?? []) {
    if (MANUAL_SOURCE_KINDS.has(hr.source_kind)) {
      manualBypassDates.add(hr.snapshot_date);
    }
  }

  const effectiveOptions: CorroboratedDeltaOptions = {
    ...args.options,
    ...(manualBypassDates.size > 0 ? { manualBypassDates } : {}),
  };

  return {
    tickets: corroboratedDailyDeltas(
      args.cumulativeTickets,
      activity,
      effectiveOptions,
    ),
    revenue: corroboratedDailyDeltas(
      args.cumulativeRevenue,
      activity,
      effectiveOptions,
    ),
  };
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
