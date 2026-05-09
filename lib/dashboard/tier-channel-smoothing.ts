/**
 * lib/dashboard/tier-channel-smoothing.ts
 *
 * Pure (no I/O) algorithm for distributing the gap between the
 * `ticket_sales_snapshots` envelope and the authoritative
 * `tier_channel_sales` SUM proportionally across a date window.
 *
 * Background
 * ----------
 * `tier_channel_sales` is an upsert-only running-total table — it
 * has no per-day audit trail. Before migration 089 introduced
 * `tier_channel_sales_daily_history`, new tickets accumulated silently
 * and only surfaced on "today" when the per-event today-anchor was
 * applied, producing a visible spike (e.g. Manchester WC26: +480
 * tickets on 2026-05-09 when they actually accrued over weeks).
 *
 * This module distributes the spike proportionally backwards,
 * weighting each day by its share of the `ticket_sales_snapshots`
 * monotonic-envelope delta. If the envelope is flat (no snapshots),
 * an even distribution is used.
 *
 * The output is a sorted array of (date, cumulativeTickets,
 * cumulativeRevenue) rows ready to be written to
 * `tier_channel_sales_daily_history` with source_kind =
 * 'smoothed_historical'. The series is guaranteed monotonically
 * non-decreasing.
 */

export interface SmoothingEnvelopeStep {
  date: string; // YYYY-MM-DD
  cumulative: number;
}

export interface SmoothedHistoryRow {
  date: string; // YYYY-MM-DD
  tickets: number; // cumulative — monotonically non-decreasing
  revenue: number; // cumulative proportional to tickets
}

/**
 * Distribute `currentTotalTickets` across [fromDate..toDate] using the
 * envelope shape as a weighting prior.
 *
 * @param fromDate         First date of the window (inclusive, YYYY-MM-DD)
 * @param toDate           Last date of the window (inclusive, YYYY-MM-DD)
 * @param currentTotalTickets  SUM(tier_channel_sales.tickets_sold) today
 * @param currentTotalRevenue  SUM(tier_channel_sales.revenue_amount) today
 * @param envelopeSteps    Sparse sorted ascending per-event envelope steps
 *                         from buildEventCumulativeTicketTimeline (or the
 *                         raw WeeklyTicketSnapshotRow-based envelope used
 *                         by the caller). Must cover the window or wider.
 *
 * Returns one row per calendar day in [fromDate..toDate]. Revenue on each
 * day is `cumTickets * avgRevPerTicket` where `avgRevPerTicket =
 * currentTotalRevenue / currentTotalTickets` (or 0 when tickets = 0).
 *
 * If there is no gap (currentTotalTickets <= envelopeCum(toDate)), the
 * function still returns the envelope-only series for the window so the
 * caller gets a complete record (source_kind can still be
 * smoothed_historical — it just happens to be identical to the envelope).
 */
export function computeSmoothedHistory(
  fromDate: string,
  toDate: string,
  currentTotalTickets: number,
  currentTotalRevenue: number,
  envelopeSteps: SmoothingEnvelopeStep[],
): SmoothedHistoryRow[] {
  // 1. Expand envelope to a dense map of date → cumulative.
  //    Carry-forward: each day's value is the last known step on or
  //    before that day (which is what the envelope does by definition).
  const allDays = eachDayInRange(fromDate, toDate);
  if (allDays.length === 0) return [];

  const envelopeDense = expandEnvelopeToDense(envelopeSteps, allDays);

  // Cumulative at the step just before fromDate — baseline value to
  // carry into the window.
  const baselineCum = envelopeCumOnOrBefore(envelopeSteps, dateMinus1(fromDate));

  // 2. Per-day envelope delta within the window (non-negative because
  //    the envelope is monotonic).
  const envDeltas: number[] = allDays.map((d, i) => {
    const prev = i === 0 ? baselineCum : (envelopeDense[i - 1] ?? baselineCum);
    return Math.max(0, (envelopeDense[i] ?? 0) - prev);
  });

  // 3. Gap = how many tickets the envelope doesn't yet explain at toDate.
  const envelopeTail = envelopeDense[envelopeDense.length - 1] ?? baselineCum;
  const gap = Math.max(0, currentTotalTickets - Math.max(baselineCum, envelopeTail));

  // 4. Distribute the gap proportionally to the envelope's shape.
  const sumEnvDelta = envDeltas.reduce((s, v) => s + v, 0);
  const N = allDays.length;

  const gapDeltas: number[] = envDeltas.map((envDelta) => {
    if (sumEnvDelta > 0) {
      return (envDelta / sumEnvDelta) * gap;
    }
    // Flat envelope fallback: even distribution.
    return gap / N;
  });

  // 5. Build smoothed cumulative series starting from baselineCum.
  //    Running max is applied at the end for safety.
  const avgRevPerTicket =
    currentTotalTickets > 0 ? currentTotalRevenue / currentTotalTickets : 0;

  const rows: SmoothedHistoryRow[] = [];
  let runningCum = baselineCum;
  let runningMax = baselineCum;

  for (let i = 0; i < allDays.length; i++) {
    runningCum +=
      (envDeltas[i] ?? 0) + (gapDeltas[i] ?? 0);
    runningMax = Math.max(runningMax, runningCum);
    rows.push({
      date: allDays[i]!,
      tickets: Math.round(runningMax),
      revenue: Math.round(runningMax * avgRevPerTicket * 100) / 100,
    });
  }

  // Clamp final entry to exactly currentTotalTickets so the last
  // smoothed row matches the live SUM (floating-point drift).
  if (rows.length > 0) {
    const last = rows[rows.length - 1]!;
    if (last.tickets !== currentTotalTickets && gap > 0) {
      last.tickets = currentTotalTickets;
      last.revenue =
        Math.round(currentTotalTickets * avgRevPerTicket * 100) / 100;
    }
  }

  return rows;
}

// ─── helpers ─────────────────────────────────────────────────────────

/**
 * All calendar dates in [fromDate..toDate] inclusive, as YYYY-MM-DD.
 * Returns [] if fromDate > toDate.
 */
export function eachDayInRange(fromDate: string, toDate: string): string[] {
  const days: string[] = [];
  const cur = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime())) return [];
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

/**
 * Expand a sparse sorted-ascending envelope to a dense per-day array
 * aligned with `allDays`. Each entry is the envelope's carry-forward
 * cumulative on that day (last known step on or before that day).
 */
function expandEnvelopeToDense(
  steps: SmoothingEnvelopeStep[],
  allDays: string[],
): number[] {
  const dense: number[] = [];
  let stepIdx = 0;
  let lastCum = 0;
  for (const day of allDays) {
    while (stepIdx < steps.length && steps[stepIdx]!.date <= day) {
      lastCum = steps[stepIdx]!.cumulative;
      stepIdx++;
    }
    dense.push(lastCum);
  }
  return dense;
}

/**
 * Return the envelope cumulative on or before `date`.
 * Returns 0 when no step precedes `date`.
 */
function envelopeCumOnOrBefore(
  steps: SmoothingEnvelopeStep[],
  date: string,
): number {
  let last = 0;
  for (const step of steps) {
    if (step.date <= date) last = step.cumulative;
    else break;
  }
  return last;
}

/** ISO date minus one day. */
function dateMinus1(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
