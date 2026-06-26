/**
 * Pure computation helper for Mailchimp registration metrics.
 *
 * This module is intentionally free of `server-only` so it can be
 * imported by both the server-side data loader and unit tests.
 */

/** Minimal snapshot row shape shared across loaders and chart data. */
export interface MailchimpSnapshotRow {
  email_subscribers: number | null;
  snapshot_at: string;
  /** Present when the snapshots API includes raw_json (tag snapshot rows only). */
  raw_json?: Record<string, unknown> | null;
}

export interface MailchimpRegistrationsData {
  /** `latest.email_subscribers - baseline.email_subscribers`. Null when no snapshots. */
  newSinceBaseline: number | null;
  /** `latest.email_subscribers`. Null when no snapshots. */
  totalSubscribers: number | null;
  /** `baseline.email_subscribers` (earliest snapshot row). Null when no snapshots. */
  baselineSubscribers: number | null;
  /** ISO timestamp of the latest snapshot row. Null when no snapshots. */
  lastSyncedAt: string | null;
  /**
   * Whether a Mailchimp audience is linked to this event (either via
   * `events.mailchimp_audience_id` or the client default). False → render
   * the "Mailchimp not linked" empty state.
   */
  hasAudience: boolean;
  /**
   * Whether a Mailchimp account credential row exists for this client
   * (`clients.mailchimp_account_id` is non-null). When false the manual
   * Refresh button on the internal dashboard is disabled with a tooltip
   * directing the user to /settings/mailchimp.
   */
  mailchimpAccountConnected: boolean;
}

/**
 * Collapses a snapshot array to one row per calendar day (UTC date).
 *
 * When multiple snapshots land on the same day (EOD cron at 23:55 + tag-sync
 * at ~06:00 UTC both writing), callers that build chart points should call
 * this first so each day produces exactly one data point. The row with the
 * highest `email_subscribers` value is kept — the later/higher reading is
 * the most accurate view of that day's state. Input order does not matter;
 * the returned array is sorted ascending by snapshot_at.
 */
export function collapseSnapshotsToOnePerDay(
  snapshots: MailchimpSnapshotRow[],
): MailchimpSnapshotRow[] {
  const byDay = new Map<string, MailchimpSnapshotRow>();
  for (const snap of snapshots) {
    const day = snap.snapshot_at.slice(0, 10);
    const existing = byDay.get(day);
    if (
      !existing ||
      (snap.email_subscribers ?? 0) > (existing.email_subscribers ?? 0)
    ) {
      byDay.set(day, snap);
    }
  }
  return [...byDay.values()].sort((a, b) =>
    a.snapshot_at.localeCompare(b.snapshot_at),
  );
}

/**
 * Computes `MailchimpRegistrationsData` from pre-fetched snapshot rows.
 *
 * Pure function — easily unit-tested without DB involvement.
 *
 * @param snapshots Array of rows ordered oldest → newest. May be empty.
 * @param hasAudience Whether the event has a resolved audience id.
 * @param mailchimpAccountConnected Whether the client has a connected Mailchimp account.
 */
export function computeRegistrationsData(
  snapshots: MailchimpSnapshotRow[],
  hasAudience: boolean,
  mailchimpAccountConnected = false,
): MailchimpRegistrationsData {
  if (snapshots.length === 0) {
    return {
      newSinceBaseline: null,
      totalSubscribers: null,
      baselineSubscribers: null,
      lastSyncedAt: null,
      hasAudience,
      mailchimpAccountConnected,
    };
  }

  const latest = snapshots.at(-1)!;
  const baseline = snapshots[0]!;

  const totalSubscribers = latest.email_subscribers ?? null;
  const baselineSubscribers = baseline.email_subscribers ?? null;
  const newSinceBaseline =
    totalSubscribers != null && baselineSubscribers != null
      ? totalSubscribers - baselineSubscribers
      : null;

  return {
    newSinceBaseline,
    totalSubscribers,
    baselineSubscribers,
    lastSyncedAt: latest.snapshot_at,
    hasAudience,
    mailchimpAccountConnected,
  };
}
