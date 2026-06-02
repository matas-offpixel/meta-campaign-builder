/**
 * Pure computation helpers for Mailchimp registration trend data.
 *
 * No `server-only` — safe to import in both server loaders and unit tests.
 */

import type { MailchimpSnapshotRow } from "./compute-registrations";

export interface MailchimpTrendPoint {
  /** YYYY-MM-DD — matches TimelineRow.date. */
  date: string;
  /**
   * Total email subscribers as of this snapshot day (absolute count,
   * not delta from baseline). Carries the last-known value forward
   * between snapshot days. Null before the first snapshot.
   */
  newRegs: number | null;
  /**
   * Cumulative paid spend (all platforms) up to this day divided by
   * total subscribers on this day.  Null when totalSubscribers <= 0
   * or spend is zero.
   */
  cpr: number | null;
}

interface SpendRow {
  date: string;
  /** Raw Meta spend (may be null). */
  ad_spend?: number | string | null;
  ad_spend_allocated?: number | string | null;
  ad_spend_presale?: number | string | null;
  tiktok_spend?: number | string | null;
  google_ads_spend?: number | string | null;
}

function safeNum(v: number | string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function dailySpend(row: SpendRow): number {
  const presale = safeNum(row.ad_spend_presale);
  let meta: number;
  if (row.ad_spend_allocated != null || row.ad_spend_presale != null) {
    meta =
      row.ad_spend_allocated != null
        ? safeNum(row.ad_spend_allocated) + presale
        : safeNum(row.ad_spend) + presale;
  } else {
    meta = safeNum(row.ad_spend);
  }
  return meta + safeNum(row.tiktok_spend) + safeNum(row.google_ads_spend);
}

/**
 * Builds a per-day array of Registrations and CPR values by joining
 * Mailchimp snapshots with the event's spend rollup timeline.
 *
 * Registrations = absolute `email_subscribers` count at each day,
 * carrying the last-known snapshot value forward between snapshots.
 * This is the total subscriber base (not a delta from baseline) so
 * the chart series trends upward as audience grows.
 *
 * CPR = LIFETIME total spend ÷ LATEST total subscribers.
 * This is a constant reference line across every data point so the
 * CPR on the chart always matches the MAILCHIMP AUDIENCE card header
 * figure, regardless of which day you're hovering. The declining
 * story is told by the Spend and Registrations curves; CPR is the
 * fixed benchmark the agency quotes to the client.
 */
export function computeMailchimpTrendPoints(
  snapshots: MailchimpSnapshotRow[],
  timeline: SpendRow[],
): MailchimpTrendPoint[] {
  if (snapshots.length === 0 || timeline.length === 0) return [];

  const sortedSnaps = [...snapshots].sort((a, b) =>
    a.snapshot_at.localeCompare(b.snapshot_at),
  );

  // Lifetime total spend — sum across every rollup day, all platforms.
  const lifetimeTotalSpend = timeline.reduce(
    (sum, row) => sum + dailySpend(row),
    0,
  );

  // Latest known subscriber count drives the CPR denominator.
  const latestSubs =
    sortedSnaps[sortedSnaps.length - 1]?.email_subscribers ?? 0;

  // Flat CPR reference line: same value for every data point.
  // Matches the MAILCHIMP AUDIENCE card on the same report page.
  const lifetimeCPR =
    latestSubs > 0 && lifetimeTotalSpend > 0
      ? lifetimeTotalSpend / latestSubs
      : null;

  // Index snapshots by YYYY-MM-DD so we can do O(1) lookups per day.
  const snapByDay = new Map<string, number | null>();
  for (const s of sortedSnaps) {
    snapByDay.set(s.snapshot_at.slice(0, 10), s.email_subscribers);
  }

  const sortedDays = [...timeline].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  let lastKnownSubs: number | null = null;
  const result: MailchimpTrendPoint[] = [];

  for (const row of sortedDays) {
    if (snapByDay.has(row.date)) {
      const v = snapByDay.get(row.date);
      lastKnownSubs = v !== undefined ? v : lastKnownSubs;
    }

    if (lastKnownSubs === null) {
      result.push({ date: row.date, newRegs: null, cpr: null });
      continue;
    }

    result.push({ date: row.date, newRegs: lastKnownSubs, cpr: lifetimeCPR });
  }

  return result;
}
