/**
 * lib/dashboard/trend-cpr.ts
 *
 * Daily Trend CPR — the card's calculation, defined on every day of
 * the spend window and absent after it. A day after general sale can
 * still spend, but it cannot produce a signup, so it has no cost per
 * signup. Not zero, not carried forward: null.
 *
 * CPR(d) = spend(spendStart … through) ÷ signups(signupFrom … through)
 *   for buckets that overlap [spendStart, spendEnd]
 * null otherwise.
 *
 * `through` is the last in-window day the bucket covers — the day
 * itself on daily grain, `min(weekEnd, spendEnd)` on weekly — so a
 * week that straddles general sale (D.O.D's 7–13 Sept) carries 7–9
 * Sept spend against 7–9 Sept signups, not a week of ticket spend
 * over a Monday of signups.
 *
 * `signupFrom` is {@link cprSignupFromDay} — the same from-day the
 * card already uses — so the last plotted point equals `model.cpr.cpr`
 * to the penny. The span is imported, not recomputed. Spend rows are
 * always daily; weekly dates are week-starts.
 */

import { hasCirqlinRegs } from "../cirqlin/tracker-signups.ts";
import type { CirqlinSnapshotRow } from "../cirqlin/types.ts";

import {
  cprSignupFromDay,
  signupPhaseSpend,
  signupPhaseSpendThrough,
  type SignupPhaseSpendRow,
} from "./signup-phase-cpr.ts";
import { cirqlinSignupsInWindow, resolveSignupWindow } from "./signup-window.ts";
import { isoWeekStart, type TrendGranularity } from "./trend-chart-data.ts";
import { fmtShortDay } from "./tracker-phase.ts";

export interface TrendCprSeries {
  daily: Array<number | null>;
  /** `CPR · to 9 Sept` or `CPR · all-time`. */
  pillLabel: string;
  fromDay: string | null;
  toDay: string | null;
  allTime: boolean;
}

export function trendCprPillLabel(input: {
  allTime: boolean;
  toDay: string | null;
}): string {
  if (input.allTime || input.toDay == null) return "CPR · all-time";
  return `CPR · to ${fmtShortDay(input.toDay)}`;
}

function addUtcDays(yyyymmdd: string, days: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Last in-window day a plotted bucket covers. Null when the bucket
 * sits wholly before spend starts or wholly after the window ends.
 * Weekly uses the same Monday key as {@link isoWeekStart}.
 */
export function cprBucketThroughDay(
  bucketDate: string,
  granularity: TrendGranularity,
  window: { fromDay: string | null; toDay: string | null },
): string | null {
  if (granularity === "daily") {
    if (window.fromDay && bucketDate < window.fromDay) return null;
    if (window.toDay && bucketDate > window.toDay) return null;
    return bucketDate;
  }
  const weekStart = isoWeekStart(bucketDate);
  const weekEnd = addUtcDays(weekStart, 6);
  if (window.toDay && weekStart > window.toDay) return null;
  if (window.fromDay && weekEnd < window.fromDay) return null;
  if (window.toDay && window.toDay < weekEnd) return window.toDay;
  return weekEnd;
}

export function buildTrendCprSeries(input: {
  dates: readonly string[];
  /** Daily spend rows — never week-summed. */
  spendRows: readonly SignupPhaseSpendRow[];
  generalSaleAt: string | null;
  cirqlinSnapshots?: readonly CirqlinSnapshotRow[] | null;
  /** Mailchimp cumulative, used only when Cirqlin is absent. */
  fallbackSignups?: Array<number | null>;
  granularity?: TrendGranularity;
}): TrendCprSeries {
  const granularity = input.granularity ?? "daily";
  const spend = signupPhaseSpend(input.spendRows, input.generalSaleAt);
  const window = resolveSignupWindow(input.cirqlinSnapshots);
  const signupFrom = cprSignupFromDay(spend, window.startDay);
  const cirqlin = hasCirqlinRegs(input.cirqlinSnapshots);
  const daily = input.dates.map((date, i) => {
    const through = cprBucketThroughDay(date, granularity, spend);
    if (!through) return null;
    const slice = signupPhaseSpendThrough(
      input.spendRows,
      input.generalSaleAt,
      through,
    );
    if (!slice.inWindow) return null;
    const signups = cirqlin
      ? cirqlinSignupsInWindow(input.cirqlinSnapshots, signupFrom, through)
      : (input.fallbackSignups?.[i] ?? 0);
    if (signups <= 0 || slice.spend <= 0) return null;
    return slice.spend / signups;
  });
  return {
    daily,
    pillLabel: trendCprPillLabel(spend),
    fromDay: spend.fromDay,
    toDay: spend.toDay,
    allTime: spend.allTime,
  };
}
