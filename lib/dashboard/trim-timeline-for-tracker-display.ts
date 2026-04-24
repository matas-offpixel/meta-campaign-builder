import type { TimelineRow } from "@/lib/db/event-daily-timeline";

/**
 * True when a numeric rollup field counts as "activity" for the
 * first-visible-day heuristic. Zero-padded sync rows use 0, not null;
 * those must not anchor the visible window.
 */
function isPositiveMetric(n: number | null): boolean {
  return n != null && n > 0;
}

function rowHasTrackerActivity(
  r: TimelineRow,
  otherSpendForDate: number | undefined,
): boolean {
  if (r.source === "manual") return true;
  const note = r.notes?.trim();
  if (note) return true;
  if (otherSpendForDate != null && otherSpendForDate > 0) return true;
  if (isPositiveMetric(r.ad_spend)) return true;
  if (isPositiveMetric(r.link_clicks)) return true;
  if (isPositiveMetric(r.meta_regs)) return true;
  if (isPositiveMetric(r.tickets_sold)) return true;
  if (isPositiveMetric(r.revenue)) return true;
  return false;
}

export interface TrimTimelineForTrackerOptions {
  /** When set, only dates on/after this day are candidates (post–general-sale rows). */
  generalSaleCutoff: string | null;
  otherSpendByDate: ReadonlyMap<string, number>;
}

/**
 * Drops leading zero-pad days so the Daily Tracker does not list the
 * full 60-day sync window before anything happened. DB rows stay
 * untouched; this is display-only.
 *
 * - First activity = earliest candidate date where the row has manual
 *   source, notes, additional/other spend &gt; 0, or any core metric &gt; 0.
 * - When nothing qualifies, returns [] so {@link buildDisplayRows} can
 *   synthesize today-only.
 * - Presale bucket rows are not passed through here; callers keep using
 *   full rollups for {@link computePresaleBucket}.
 */
export function trimTimelineForTrackerDisplay(
  timeline: TimelineRow[],
  opts: TrimTimelineForTrackerOptions,
): TimelineRow[] {
  const { generalSaleCutoff, otherSpendByDate } = opts;

  const candidates =
    generalSaleCutoff !== null
      ? timeline.filter((r) => r.date >= generalSaleCutoff)
      : timeline.slice();

  let firstActivity: string | null = null;
  for (const r of candidates) {
    if (!rowHasTrackerActivity(r, otherSpendByDate.get(r.date))) continue;
    if (firstActivity === null || r.date < firstActivity) {
      firstActivity = r.date;
    }
  }

  if (firstActivity === null) {
    return [];
  }

  return timeline.filter((r) => r.date >= firstActivity);
}
