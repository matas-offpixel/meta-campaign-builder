/**
 * TF1: the test ad set's daily budget (docs/design-record/2026-11-16-creative-testing-3.html,
 * replacing TT2), with Matas's ruling of 16 Nov on campaign-budget events.
 *
 * - Current daily spend: the event's Meta spend over the last 7 days across
 *   its main campaigns, ÷ 7. The Tests campaign isn't counted (the caller
 *   leaves it out).
 * - The daily budget is 10 % of that, rounded down to the whole unit, and:
 *     never more than 10 a day;
 *     never more than the daily budget of the event's median live main ad
 *     set. Under a campaign budget (CBO), each live ad set counts as the
 *     campaign's daily budget ÷ its live ad sets (Matas, 16 Nov);
 *     never less than Meta's minimum, read from the ad account
 *     (min_daily_budget); £1.00 when it can't be read. At the minimum the
 *     panel line adds " · Meta's minimum".
 * - No spend in the 7 days: the test can't start.
 * - The plan (R5): a test holds 4 days of its daily budget from Start. Both
 *   test ad sets together stay within 20 % of the remaining plan.
 *
 * Money from Meta (budgets, minimum) is in minor units; spend is in units of
 * the account's currency. Pure: no database, no Meta.
 */

import { MIN_DAILY_BUDGET_MINOR, MOVE_CAP_SHARE, remainingPlan } from "../onsale-refresh/plan-guard.ts";
import { budgetLine, money, NO_RECENT_SPEND } from "./words.ts";

export const TF1 = {
  /** Current daily spend is read over this many days. */
  windowDays: 7,
  /** The test's share of current daily spend. */
  share: 0.1,
  /** The cap, in whole units a day. */
  capUnits: 10,
  /** Days of the daily budget a running test holds against the plan. */
  holdDays: 4,
  /** R5: both test ad sets together, as a share of the remaining plan. */
  planCapShare: MOVE_CAP_SHARE,
  /** Meta's minimum when the account doesn't say (WB8's floor). */
  defaultMinMinor: MIN_DAILY_BUDGET_MINOR,
} as const;

export type MainAdSet = {
  /** The ad set's own daily budget, minor units; null under a campaign budget. */
  dailyMinor: number | null;
  live: boolean;
};

export type CboCampaign = {
  /** The campaign's daily budget, minor units. */
  dailyMinor: number;
  /** Its live ad sets. */
  liveAdSets: number;
};

export type SizeInput = {
  /** Meta spend over the last 7 days, main campaigns only, account units. */
  last7Spend: number;
  /** The main campaigns' ad sets with budgets of their own (ABO). */
  mainAdSets: MainAdSet[];
  /** The main campaigns with a campaign daily budget (CBO). */
  cboCampaigns?: CboCampaign[];
  /** The account's min_daily_budget, minor units; null when it wasn't read. */
  minDailyMinor: number | null;
  currency?: string | null;
};

export type Sized =
  | {
      ok: true;
      dailyMinor: number;
      /** dailyMinor in units, for the line. */
      daily: number;
      currentDaily: number;
      /** The real share of current daily spend, unrounded (6.25). */
      sharePct: number;
      atMinimum: boolean;
      minDailyMinor: number;
      /** The median live main ad set's daily budget, minor units; null when none is known. */
      medianCapMinor: number | null;
      holdMinor: number;
      line: string;
    }
  | { ok: false; reason: "no_recent_spend"; text: string };

/**
 * Each live main ad set's daily budget, minor units: its own (ABO), or its
 * campaign's daily ÷ the campaign's live ad sets (CBO), one entry per live
 * ad set so the median is over ad sets.
 */
export function liveAdSetBudgets(mainAdSets: MainAdSet[], cboCampaigns: CboCampaign[] = []): number[] {
  const out = mainAdSets.filter((set) => set.live && set.dailyMinor != null && set.dailyMinor > 0).map((set) => set.dailyMinor!);
  for (const campaign of cboCampaigns) {
    if (campaign.liveAdSets <= 0 || campaign.dailyMinor <= 0) continue;
    const each = Math.floor(campaign.dailyMinor / campaign.liveAdSets);
    for (let i = 0; i < campaign.liveAdSets; i += 1) out.push(each);
  }
  return out;
}

/** The median ad set's budget. With an even count, the lower of the middle two, so a test is never bigger than the typical ad set. */
export function medianBudget(budgets: number[]): number | null {
  if (!budgets.length) return null;
  const sorted = [...budgets].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

export function sizeTest(input: SizeInput): Sized {
  const currentDaily = Math.round((input.last7Spend / TF1.windowDays) * 100) / 100;
  if (!(currentDaily > 0)) return { ok: false, reason: "no_recent_spend", text: NO_RECENT_SPEND };

  const medianCapMinor = medianBudget(liveAdSetBudgets(input.mainAdSets, input.cboCampaigns));
  const minDailyMinor = input.minDailyMinor != null && input.minDailyMinor > 0 ? input.minDailyMinor : TF1.defaultMinMinor;

  const limits = [currentDaily * TF1.share, TF1.capUnits];
  if (medianCapMinor != null) limits.push(medianCapMinor / 100);
  let dailyMinor = Math.floor(Math.min(...limits)) * 100;
  const atMinimum = dailyMinor < minDailyMinor;
  if (atMinimum) dailyMinor = minDailyMinor;

  const daily = dailyMinor / 100;
  const sharePct = (daily / currentDaily) * 100;
  return {
    ok: true,
    dailyMinor,
    daily,
    currentDaily,
    sharePct,
    atMinimum,
    minDailyMinor,
    medianCapMinor,
    holdMinor: dailyMinor * TF1.holdDays,
    line: budgetLine({ daily, sharePct, cap: TF1.capUnits, atMinimum, currency: input.currency }),
  };
}

export type PlanCheckInput = {
  /** The event's marketing budget, units; null when it has none. */
  budget: number | null;
  /** Its spend to date, units. */
  spendToDate: number;
  /** What this test would hold: 4 days of its daily budget, minor units. */
  holdMinor: number;
  /** What the event's other test ad set holds now (approved or running), minor units. */
  otherHoldMinor: number;
  currency?: string | null;
};

/**
 * R5 at Approve: a sentence when the hold doesn't fit, else null (no sentence when
 * it fits). The first two are R5's own sentences; the cap sentence is design's
 * ruling on #1297.
 */
export function planCheck(input: PlanCheckInput): string | null {
  if (input.budget == null) return "Set this event's budget to apply this.";
  const remaining = remainingPlan(input.budget, input.spendToDate)!;
  if (remaining <= 0) return `This event has spent its budget (${money(input.spendToDate, input.currency)} of ${money(input.budget, input.currency)}), so nothing new goes live.`;
  const capMinor = Math.floor(remaining * TF1.planCapShare * 100);
  const leftMinor = Math.max(0, capMinor - input.otherHoldMinor);
  if (input.holdMinor > leftMinor) return capText(input.holdMinor / 100, leftMinor / 100, input.currency);
  return null;
}

/**
 * Design's ruling on #1297: this test's four days would pass R5's 20 % cap, with the
 * event's other test ad sets. Shown only when it doesn't fit, with Approve off; pence
 * on both amounts.
 */
export function capText(hold: number, left: number, currency?: string | null): string {
  return `This test needs ${money(hold, currency)} for its 4 days, and the plan's 20 % cap has ${money(left, currency)} left.`;
}
