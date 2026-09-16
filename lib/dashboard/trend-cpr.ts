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
 * itself on daily grain, `min(weekEnd, spendEnd)` on weekly. Both
 * operands are cumulative from the spend-window start through that
 * end. D.O.D's 7 Sept week is 26 Aug – 9 Sept spend (£1,439.37) over
 * 26 Aug – 9 Sept signups (1,589). A genuine 7–9 Sept ÷ 7–9 Sept
 * per-bucket ratio would not equal the card, which is why the
 * identity is written this way.
 *
 * `signupFrom` is {@link cprSignupFromDay} — the same from-day the
 * card already uses — so the last plotted point equals `model.cpr.cpr`
 * to the penny. The span is imported, not recomputed. Spend rows are
 * always daily; weekly dates are week-starts.
 *
 * Weekly Mailchimp has no per-day curve that matches the card
 * (`totalSubscribers` today, not a running window). That path is
 * null, with a caption, rather than a mixed-window number.
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
import { isoWeekEnd, isoWeekStart, type TrendGranularity } from "./trend-chart-data.ts";
import { fmtShortDay } from "./tracker-phase.ts";

export const WEEKLY_MAILCHIMP_CPR_CAPTION =
  "Weekly CPR needs a per-day signup curve — Mailchimp only has today's subscribed total.";

export interface TrendCprSeries {
  daily: Array<number | null>;
  /** `CPR · to 9 Sept` or `CPR · all-time`. */
  pillLabel: string;
  fromDay: string | null;
  toDay: string | null;
  allTime: boolean;
  caption: string | null;
}

export function trendCprPillLabel(input: {
  allTime: boolean;
  toDay: string | null;
}): string {
  if (input.allTime || input.toDay == null) return "CPR · all-time";
  return `CPR · to ${fmtShortDay(input.toDay)}`;
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
  const weekEnd = isoWeekEnd(bucketDate);
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
  /** Daily dates aligned to `fallbackSignups` so a lookup can use `through`. */
  fallbackSignupDates?: readonly string[];
  granularity?: TrendGranularity;
}): TrendCprSeries {
  const granularity = input.granularity ?? "daily";
  const spend = signupPhaseSpend(input.spendRows, input.generalSaleAt);
  const window = resolveSignupWindow(input.cirqlinSnapshots);
  const signupFrom = cprSignupFromDay(spend, window.startDay);
  const cirqlin = hasCirqlinRegs(input.cirqlinSnapshots);
  const weeklyMailchimp = !cirqlin && granularity === "weekly";
  const daily = input.dates.map((date, i) => {
    if (weeklyMailchimp) return null;
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
      : fallbackSignupAt(input.fallbackSignupDates, input.fallbackSignups, through, i);
    if (signups <= 0 || slice.spend <= 0) return null;
    return slice.spend / signups;
  });
  return {
    daily,
    pillLabel: trendCprPillLabel(spend),
    fromDay: spend.fromDay,
    toDay: spend.toDay,
    allTime: spend.allTime,
    caption: weeklyMailchimp ? WEEKLY_MAILCHIMP_CPR_CAPTION : null,
  };
}

function fallbackSignupAt(
  dates: readonly string[] | undefined,
  values: Array<number | null> | undefined,
  through: string,
  index: number,
): number {
  if (dates && values && dates.length === values.length) {
    let latest = 0;
    for (let i = 0; i < dates.length; i++) {
      if (dates[i]! > through) break;
      if (values[i] != null) latest = values[i]!;
    }
    return latest;
  }
  return values?.[index] ?? 0;
}
