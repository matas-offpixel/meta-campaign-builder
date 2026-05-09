/**
 * lib/db/event-history-collapse.ts
 *
 * Pure collapse helper lifted out of `event-history-resolver.ts` so
 * unit tests can import it without tripping the `server-only` guard
 * that belongs on anything holding a Supabase client.
 *
 * `collapseWeekly` is the single tie-break rule the dashboard (client
 * component) and the server loader both rely on — keeping it in a
 * thread-neutral module means the same code paths evaluate the same
 * way on both sides.
 */

export interface WeeklySnapshot {
  snapshot_at: string;
  tickets_sold: number;
  source:
    | "eventbrite"
    | "fourthefans"
    | "manual"
    | "xlsx_import"
    | "foursomething";
}

/**
 * Source priority: higher number wins on ties. Matches the
 * "operator override" intuition — manual edits from the dashboard
 * always trump API-pulled or xlsx-bulk-loaded rows, and a one-off
 * xlsx backfill trumps the Eventbrite auto-sync when both cover
 * the same week.
 */
const SOURCE_PRIORITY: Record<string, number> = {
  eventbrite: 1,
  foursomething: 2,
  fourthefans: 2,
  xlsx_import: 3,
  manual: 4,
};

/**
 * Resolve one snapshot per (eventId, snapshot_at week bucket),
 * preferring manual > xlsx_import > fourthefans > eventbrite when multiple rows
 * exist for the same week. Week bucket = the snapshot_at date
 * converted to YYYY-MM-DD (UTC), so two same-week rows with
 * different HH:MM still collapse correctly.
 *
 * This is the per-day tie-break, applied independently to each
 * bucket. When two different weeks are backed by two different
 * sources (e.g. week A from xlsx_import, week B from eventbrite)
 * this helper keeps both — see `collapseWeeklyNormalizedPerEvent`
 * for the stricter single-source variant used by the WoW
 * aggregator.
 */
export function collapseWeekly(
  rows: Array<{
    snapshot_at: string;
    tickets_sold: number;
    source: string;
  }>,
): WeeklySnapshot[] {
  const byDay = new Map<string, WeeklySnapshot>();
  for (const r of rows) {
    const day = ymd(r.snapshot_at);
    if (!day) continue;
    const normalizedSource = normalizeSource(r.source);
    const current = byDay.get(day);
    if (
      !current ||
      (SOURCE_PRIORITY[normalizedSource] ?? 0) >
        (SOURCE_PRIORITY[current.source] ?? 0)
    ) {
      byDay.set(day, {
        snapshot_at: day,
        tickets_sold: Number(r.tickets_sold),
        source: normalizedSource,
      });
    }
  }
  return Array.from(byDay.values()).sort((a, b) =>
    a.snapshot_at.localeCompare(b.snapshot_at),
  );
}

/**
 * Per-event source normalisation.
 *
 * Picks a single *dominant* source for the event (the highest-
 * priority source present in the input rows) and returns only
 * snapshots from that source. Drops rows from lower-priority
 * sources entirely — the WoW aggregator can then compare two
 * cumulative values that both came from the same reporting flow
 * without risking phantom regressions where week A came from an
 * xlsx_import cumulative (say 1,783) and week B came from an
 * Eventbrite live total (1,091) that doesn't include the same
 * buckets.
 *
 * Why not "pick dominant by coverage count":
 *   Coverage-based dominance would surface `eventbrite` for a
 *   long-running event even when the operator went out of their
 *   way to import a cleaner xlsx_import set — the whole point of
 *   imports is operator authority, so priority-based dominance
 *   matches the PR #122 contract.
 *
 * Callers that want the cross-source union (e.g. the weekly
 * trends chart that renders every data point regardless of
 * source) keep using `collapseWeekly`. The WoW aggregator and
 * anything else that relies on cumulative consistency uses this
 * helper.
 */
export function collapseWeeklyNormalizedPerEvent(
  rows: Array<{
    snapshot_at: string;
    tickets_sold: number;
    source: string;
  }>,
): WeeklySnapshot[] {
  const collapsed = collapseWeekly(rows);
  if (collapsed.length === 0) return [];
  // Find the highest-priority source that appears in the data.
  let dominantSource: WeeklySnapshot["source"] = "eventbrite";
  let dominantPriority = -1;
  for (const r of collapsed) {
    const p = SOURCE_PRIORITY[r.source] ?? 0;
    if (p > dominantPriority) {
      dominantPriority = p;
      dominantSource = r.source;
    }
  }
  return collapsed.filter((r) => r.source === dominantSource);
}

/**
 * Source-stitched collapse for trend / tracker rendering.
 *
 * Unlike `collapseWeeklyNormalizedPerEvent` (which picks ONE dominant
 * source for the entire event and discards all rows from lower-priority
 * sources), this function applies the priority tie-break *per calendar
 * day* and returns every day that has at least one row in any source.
 *
 * Manchester WC26 problem it solves:
 *   - Croatia / Ghana / Panama have xlsx_import rows (Feb 12 – Apr 28)
 *     AND fourthefans rows (Feb 12 – today).
 *   - Dominant source = xlsx_import (priority 3 > 2).
 *   - `collapseWeeklyNormalizedPerEvent` keeps only xlsx_import days,
 *     so post-Apr 28 the tracker goes dark for those three events.
 *   - This function keeps ALL days: Apr 28 uses xlsx_import (higher
 *     priority); May 1 uses fourthefans (only available source).
 *     The trend chart stays continuous.
 *
 * WoW comparability is NOT guaranteed by this function — do not use it
 * for WoW delta computation. Use `collapseWeeklyNormalizedPerEvent`
 * for week-over-week comparability; use this for trend / tracker continuity.
 *
 * Implementation note: this is identical to `collapseWeekly` (per-day
 * priority). The named alias exists to make intent explicit at call-sites.
 */
export function collapseTrendPerEventStitched(
  rows: Array<{
    snapshot_at: string;
    tickets_sold: number;
    source: string;
  }>,
): WeeklySnapshot[] {
  return collapseWeekly(rows);
}

function normalizeSource(s: string): WeeklySnapshot["source"] {
  if (
    s === "eventbrite" ||
    s === "fourthefans" ||
    s === "manual" ||
    s === "xlsx_import" ||
    s === "foursomething"
  ) {
    return s;
  }
  // Unknown-but-valid (e.g. a future provider written by an older app
  // version) falls back to `eventbrite` rather than throwing — the
  // chart renders instead of disappearing, and the misclassification
  // is recoverable once the new app version ships.
  return "eventbrite";
}

function ymd(raw: string): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}
