/**
 * lib/mailchimp/daily-growth.ts
 *
 * Pure helper — derives per-day subscriber growth from an ordered
 * snapshot series. No side effects, no I/O, no server-only imports.
 * Safe to import in both server and client bundles.
 */

export interface DailyGrowthResult {
  /**
   * Net new subscribers between the two most-recent snapshots.
   * null when fewer than two snapshots exist or either value is null.
   */
  dailyNew: number | null;
  /**
   * ISO date string (YYYY-MM-DD) of the snapshot we are comparing
   * against (i.e. "yesterday"). null when dailyNew is null.
   */
  compareToDate: string | null;
}

/**
 * Given an array of snapshots ordered oldest → newest, returns the
 * delta between the two most-recent entries.
 *
 * - 0 snapshots → { dailyNew: null, compareToDate: null }
 * - 1 snapshot  → { dailyNew: null, compareToDate: null }
 * - 2+ snapshots → { dailyNew: latest - secondLatest, compareToDate }
 */
export function computeDailyGrowth(
  snapshots: ReadonlyArray<{
    email_subscribers: number | null;
    snapshot_at: string;
  }>,
): DailyGrowthResult {
  if (snapshots.length < 2) {
    return { dailyNew: null, compareToDate: null };
  }

  const latest = snapshots[snapshots.length - 1]!;
  const prev = snapshots[snapshots.length - 2]!;

  const dailyNew =
    latest.email_subscribers != null && prev.email_subscribers != null
      ? latest.email_subscribers - prev.email_subscribers
      : null;

  return {
    dailyNew,
    compareToDate: prev.snapshot_at.slice(0, 10),
  };
}
