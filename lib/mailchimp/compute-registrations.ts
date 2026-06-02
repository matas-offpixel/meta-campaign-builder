/**
 * Pure computation helper for Mailchimp registration metrics.
 *
 * This module is intentionally free of `server-only` so it can be
 * imported by both the server-side data loader and unit tests.
 */

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
}

interface SnapshotRow {
  email_subscribers: number | null;
  snapshot_at: string;
}

/**
 * Computes `MailchimpRegistrationsData` from pre-fetched snapshot rows.
 *
 * Pure function — easily unit-tested without DB involvement.
 *
 * @param snapshots Array of rows ordered oldest → newest. May be empty.
 * @param hasAudience Whether the event has a resolved audience id.
 */
export function computeRegistrationsData(
  snapshots: SnapshotRow[],
  hasAudience: boolean,
): MailchimpRegistrationsData {
  if (snapshots.length === 0) {
    return {
      newSinceBaseline: null,
      totalSubscribers: null,
      baselineSubscribers: null,
      lastSyncedAt: null,
      hasAudience,
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
  };
}
