/**
 * lib/dashboard/trend-cpr.ts
 *
 * Daily Trend CPR — the card's calculation, defined on every day of
 * the spend window and absent after it. A day after general sale can
 * still spend, but it cannot produce a signup, so it has no cost per
 * signup. Not zero, not carried forward: null.
 *
 * CPR(d) = spend(spendStart … d) ÷ signups(signupFrom … d)
 *   for d in [spendStart, spendEnd]
 * null otherwise.
 *
 * `signupFrom` is {@link cprSignupFromDay} — the same from-day the
 * card already uses — so the last plotted point equals `model.cpr.cpr`
 * to the penny. The span is imported, not recomputed.
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

export function buildTrendCprSeries(input: {
  dates: readonly string[];
  spendRows: readonly SignupPhaseSpendRow[];
  generalSaleAt: string | null;
  cirqlinSnapshots?: readonly CirqlinSnapshotRow[] | null;
  /** Mailchimp cumulative, used only when Cirqlin is absent. */
  fallbackSignups?: Array<number | null>;
}): TrendCprSeries {
  const spend = signupPhaseSpend(input.spendRows, input.generalSaleAt);
  const window = resolveSignupWindow(input.cirqlinSnapshots);
  const signupFrom = cprSignupFromDay(spend, window.startDay);
  const cirqlin = hasCirqlinRegs(input.cirqlinSnapshots);
  const daily = input.dates.map((date, i) => {
    const slice = signupPhaseSpendThrough(
      input.spendRows,
      input.generalSaleAt,
      date,
    );
    if (!slice.inWindow) return null;
    const signups = cirqlin
      ? cirqlinSignupsInWindow(input.cirqlinSnapshots, signupFrom, date)
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
