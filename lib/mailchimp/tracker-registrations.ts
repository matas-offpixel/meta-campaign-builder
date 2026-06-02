import type { MailchimpSnapshotRow } from "./compute-registrations.ts";

function addDaysUtc(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive Sunday end-of-week for a Monday W/C date (UTC). */
export function weekEndSunday(mondayYmd: string): string {
  return addDaysUtc(mondayYmd, 6);
}

/**
 * Latest cumulative `email_subscribers` on or before `isoDate`.
 * Snapshots may be sparse; carry forward the most recent known value.
 */
export function latestMailchimpSubscribersOnOrBefore(
  snapshots: readonly MailchimpSnapshotRow[],
  isoDate: string,
): number | null {
  let latest: number | null = null;
  for (const s of snapshots) {
    const d = s.snapshot_at.slice(0, 10);
    if (d > isoDate) continue;
    if (s.email_subscribers != null) latest = s.email_subscribers;
  }
  return latest;
}

/** Net-new registrations for a calendar day (delta vs prior day). */
export function netNewMailchimpRegistrationsForDay(
  snapshots: readonly MailchimpSnapshotRow[],
  isoDate: string,
): number | null {
  const endSubs = latestMailchimpSubscribersOnOrBefore(snapshots, isoDate);
  if (endSubs == null) return null;
  const priorSubs = latestMailchimpSubscribersOnOrBefore(
    snapshots,
    addDaysUtc(isoDate, -1),
  );
  return endSubs - (priorSubs ?? 0);
}

/**
 * Net-new registrations for an ISO week bucket (Mon W/C through Sunday).
 * Compares cumulative subs at week-end vs the day before week-start.
 */
export function netNewMailchimpRegistrationsForWeek(
  snapshots: readonly MailchimpSnapshotRow[],
  weekStartMonday: string,
): number | null {
  const weekEnd = weekEndSunday(weekStartMonday);
  const priorEnd = addDaysUtc(weekStartMonday, -1);
  const endSubs = latestMailchimpSubscribersOnOrBefore(snapshots, weekEnd);
  if (endSubs == null) return null;
  const priorSubs = latestMailchimpSubscribersOnOrBefore(snapshots, priorEnd);
  return endSubs - (priorSubs ?? 0);
}
