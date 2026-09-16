/**
 * lib/dashboard/signup-window.ts
 *
 * The campaign's signup window starts on the first day whose
 * `signups_day` is more than {@link SIGNUP_WINDOW_MIN_DAY}. A handful
 * of signups on the days a page is being built are the operator's own
 * test submissions, not fans — D.O.D had 4 of those (18–19 Aug) before
 * the first real day (24 Aug, 130).
 *
 * Derived at read time from `signup_source_snapshots`. Changing the
 * threshold never needs a backfill. Sentinel rows are skipped, as they
 * are everywhere else.
 */

import {
  cirqlinSignupsForRange,
  isCirqlinSentinelRow,
} from "../cirqlin/tracker-signups.ts";
import type { CirqlinSnapshotRow } from "../cirqlin/types.ts";

import type { PresaleBucketTotals } from "./presale-bucket.ts";

/**
 * A day at or under this count is still "the page is being built".
 * The first day strictly above it is the campaign start.
 */
export const SIGNUP_WINDOW_MIN_DAY = 5;

export const SIGNUP_WINDOW_THRESHOLD_LINE =
  "no day passed the 5-signup threshold; counting from the first signup";

export interface SignupWindow {
  /** First campaign day, or null when there is no live signup row. */
  startDay: string | null;
  /** True when a day exceeded {@link SIGNUP_WINDOW_MIN_DAY}. */
  usedThreshold: boolean;
  /** First day with any signups (`signups_day` > 0). */
  firstSignupDay: string | null;
  /** Signups on days strictly before `startDay`. */
  excludedSignups: number;
  /** Signups on `startDay` and every later live day. */
  windowSignups: number;
}

function liveDays(
  rows: readonly CirqlinSnapshotRow[] | null | undefined,
): CirqlinSnapshotRow[] {
  if (!rows) return [];
  return rows
    .filter((row) => !isCirqlinSentinelRow(row))
    .slice()
    .sort((a, b) => a.day.localeCompare(b.day));
}

export function resolveSignupWindow(
  rows: readonly CirqlinSnapshotRow[] | null | undefined,
): SignupWindow {
  const live = liveDays(rows);
  let firstSignupDay: string | null = null;
  let startDay: string | null = null;
  for (const row of live) {
    if (row.signups_day > 0 && firstSignupDay == null) {
      firstSignupDay = row.day;
    }
    if (row.signups_day > SIGNUP_WINDOW_MIN_DAY) {
      startDay = row.day;
      break;
    }
  }
  const usedThreshold = startDay != null;
  if (startDay == null) startDay = firstSignupDay;

  let excludedSignups = 0;
  let windowSignups = 0;
  for (const row of live) {
    if (startDay && row.day < startDay) excludedSignups += row.signups_day;
    else if (startDay && row.day >= startDay) windowSignups += row.signups_day;
  }

  return {
    startDay,
    usedThreshold,
    firstSignupDay,
    excludedSignups,
    windowSignups,
  };
}

export function signupWindowLine(window: SignupWindow): string | null {
  if (window.startDay == null) return null;
  if (!window.usedThreshold) return SIGNUP_WINDOW_THRESHOLD_LINE;
  if (window.excludedSignups <= 0) return null;
  const n = window.excludedSignups.toLocaleString("en-GB");
  const noun = window.excludedSignups === 1 ? "signup" : "signups";
  return `${n} ${noun} before the campaign window — excluded.`;
}

/**
 * Point the collapsed tracker bucket at the campaign start, even when
 * that day has no rollup row. Spend still sums only the rollup days;
 * REGS then covers Cirqlin days the rollup never saw.
 */
export function applySignupWindowToBucket(
  presale: PresaleBucketTotals | null,
  rows: readonly CirqlinSnapshotRow[] | null | undefined,
): PresaleBucketTotals | null {
  if (!presale) return null;
  const window = resolveSignupWindow(rows);
  if (!window.startDay || window.startDay >= presale.cutoffDate) {
    return presale;
  }
  return { ...presale, earliestDate: window.startDay };
}

/** Signups on an inclusive day range. 0 when the range is empty. */
export function cirqlinSignupsInWindow(
  rows: readonly CirqlinSnapshotRow[] | null | undefined,
  fromDay: string | null,
  toDay: string | null,
): number {
  if (!rows || !fromDay) return 0;
  const end = toDay ?? "9999-12-31";
  return cirqlinSignupsForRange(rows, fromDay, end) ?? 0;
}
