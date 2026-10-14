/**
 * Step 6 outlet split and TikTok ad-group plan.
 *
 * Plan rows stay daily (`CampaignPlanBudgetSplit`). The step's Daily /
 * Lifetime toggle only changes the figures on screen: a lifetime total is
 * daily × inclusive days.
 *
 * TikTok's GBP floor is £50 a day per ad group. That is the live minimum
 * in `TIKTOK_MIN_DAILY_BUDGET_BY_CURRENCY` (TikTok 40002, "Your budget
 * setting must not be less than £50", advertiser 7639802149165301776,
 * request 202608210618444D942991BC30CBAA9000). Matas recalled £20. £20 is
 * under the floor the write path refuses, so this constant is 50. A test
 * locks it to the write-path map. Lifetime minimum is £50 × scheduled days,
 * the same rule as `tikTokAdGroupBudgetFloor`.
 */

import {
  allocateByWeights,
  applyPreset,
  lifetimeToDaily,
  scheduledDayCount,
  splitLockedEdit,
  type PlanBudgetPresetId,
  type PlanBudgetSelection,
} from "./budget-split.ts";
import type { CampaignPlanBudgetSplit, PlanAdapterName } from "./types.ts";

/**
 * GBP ad-group daily floor. Equals the write path's GBP entry.
 * Do not lower this to the recalled £20 — TikTok rejects it.
 */
export const TIKTOK_MIN_ADGROUP_DAILY_GBP = 50;

export type MmlBudgetMode = "daily" | "lifetime";

export type TikTokGroupRole = "regional" | "nationwide";

export interface TikTokPlannedGroup {
  role: TikTokGroupRole;
  name: string;
  /** Pounds in the same unit as the share passed in (daily, or the whole run). */
  amount: number;
}

export interface TikTokAdGroupPlan {
  blocked: boolean;
  message: string | null;
  minimumDaily: number;
  /** Floor in the share's unit. Null when a lifetime run has no day count. */
  minimum: number | null;
  groups: TikTokPlannedGroup[];
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function pence(value: number): number {
  return Math.round(round2(value) * 100);
}

export function formatGbp(amount: number): string {
  const rounded = round2(amount);
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  return `£${text}`;
}

export function mmlBudgetDays(startDate: string | null, endDate: string | null): number | null {
  return scheduledDayCount(startDate, endDate);
}

/** Daily stays daily. Lifetime is daily × inclusive days, or 0 when the run has no dates. */
export function channelDisplayAmount(
  daily: number,
  mode: MmlBudgetMode,
  days: number | null,
): number {
  if (!(daily > 0)) return 0;
  if (mode === "daily") return round2(daily);
  if (!(days && days > 0)) return 0;
  return round2(daily * days);
}

export function displayTotal(
  budget: CampaignPlanBudgetSplit,
  mode: MmlBudgetMode,
  days: number | null,
): number {
  return channelDisplayAmount(budget.totalDaily, mode, days);
}

function weightsOf(budget: CampaignPlanBudgetSplit): Record<PlanAdapterName, number> {
  return {
    meta: budget.metaDaily,
    tiktok: budget.tiktokDaily,
    google: budget.googleDaily,
  };
}

/**
 * The operator edited the figure on screen (a daily total, or the run total).
 * Stored shares stay in proportion. An all-zero split splits the new total
 * evenly across the selected channels.
 */
export function setDisplayedTotal(
  budget: CampaignPlanBudgetSplit,
  selected: PlanBudgetSelection,
  mode: MmlBudgetMode,
  days: number | null,
  displayedTotal: number,
): CampaignPlanBudgetSplit {
  const daily =
    mode === "lifetime" ? lifetimeToDaily(displayedTotal, days ?? 0) : round2(Math.max(0, displayedTotal));
  const weights = weightsOf(budget);
  const any = weights.meta + weights.tiktok + weights.google > 0;
  return allocateByWeights(daily, any ? weights : { meta: 1, tiktok: 1, google: 1 }, selected);
}

/** One channel's on-screen amount. The total stays; the other selected channels rebalance. */
export function editDisplayedShare(
  budget: CampaignPlanBudgetSplit,
  selected: PlanBudgetSelection,
  channel: PlanAdapterName,
  displayed: number,
  mode: MmlBudgetMode,
  days: number | null,
): CampaignPlanBudgetSplit {
  const daily = mode === "lifetime" ? lifetimeToDaily(displayed, days ?? 0) : round2(Math.max(0, displayed));
  return splitLockedEdit(budget, selected, channel, daily, budget.totalDaily);
}

export function editSharePercent(
  budget: CampaignPlanBudgetSplit,
  selected: PlanBudgetSelection,
  channel: PlanAdapterName,
  percent: number,
): CampaignPlanBudgetSplit {
  const next = (budget.totalDaily * percent) / 100;
  return splitLockedEdit(budget, selected, channel, next, budget.totalDaily);
}

export function applyDisplayedPreset(
  budget: CampaignPlanBudgetSplit,
  presetId: PlanBudgetPresetId,
  selected: PlanBudgetSelection,
): CampaignPlanBudgetSplit {
  return applyPreset(budget.totalDaily, presetId, selected);
}

/**
 * TikTok's share cannot fund another ad group at the floor, so the total
 * grows and the other channels keep their pounds.
 */
export function raiseTikTokToMinimum(
  budget: CampaignPlanBudgetSplit,
  selected: PlanBudgetSelection,
  minimumDaily: number = TIKTOK_MIN_ADGROUP_DAILY_GBP,
): CampaignPlanBudgetSplit {
  const floor = round2(minimumDaily);
  const withTikTok = { ...selected, tiktok: true };
  if (budget.tiktokDaily >= floor) return { ...budget };
  if (budget.totalDaily >= floor) {
    return splitLockedEdit(budget, withTikTok, "tiktok", floor, budget.totalDaily);
  }
  const others = round2(budget.totalDaily - budget.tiktokDaily);
  return {
    totalDaily: round2(others + floor),
    metaDaily: budget.metaDaily,
    tiktokDaily: floor,
    googleDaily: budget.googleDaily,
  };
}

export function turnChannelOff(
  budget: CampaignPlanBudgetSplit,
  selected: PlanBudgetSelection,
  channel: PlanAdapterName,
): { budget: CampaignPlanBudgetSplit; selected: PlanBudgetSelection } {
  const nextSelected = { ...selected, [channel]: false };
  const weights = weightsOf(budget);
  weights[channel] = 0;
  return {
    selected: nextSelected,
    budget: allocateByWeights(budget.totalDaily, weights, nextSelected),
  };
}

export function tikTokMinimumMessage(minimumDaily: number): string {
  return `TikTok needs at least ${formatGbp(minimumDaily)}/day (TikTok's minimum per ad group)`;
}

/**
 * Regional until the share can fund a second ad group at the floor.
 * At twice the floor, the regional group keeps the floor and the rest
 * is a nationwide UK group.
 */
export function planTikTokAdGroups(input: {
  share: number;
  mode: MmlBudgetMode;
  days: number | null;
  venueLabel: string;
  minimumDaily?: number;
}): TikTokAdGroupPlan {
  const minimumDaily = input.minimumDaily ?? TIKTOK_MIN_ADGROUP_DAILY_GBP;
  const dailyMessage = tikTokMinimumMessage(minimumDaily);
  const venue = input.venueLabel.trim() || "venue";
  const regionalName = `Regional · ${venue}`;

  if (input.mode === "lifetime" && !(input.days && input.days > 0)) {
    return {
      blocked: true,
      message: `${dailyMessage}. Set an end date so the lifetime minimum can be calculated`,
      minimumDaily,
      minimum: null,
      groups: [],
    };
  }

  const days = input.mode === "lifetime" ? input.days! : 1;
  const minimum = round2(minimumDaily * days);
  const sharePence = Math.max(0, pence(input.share));
  const minimumPence = pence(minimum);

  if (sharePence < minimumPence) {
    return {
      blocked: true,
      message: dailyMessage,
      minimumDaily,
      minimum,
      groups: [],
    };
  }

  if (sharePence < minimumPence * 2) {
    return {
      blocked: false,
      message: null,
      minimumDaily,
      minimum,
      groups: [{ role: "regional", name: regionalName, amount: round2(sharePence / 100) }],
    };
  }

  const nationwidePence = sharePence - minimumPence;
  return {
    blocked: false,
    message: null,
    minimumDaily,
    minimum,
    groups: [
      { role: "regional", name: regionalName, amount: round2(minimumPence / 100) },
      { role: "nationwide", name: "Nationwide UK", amount: round2(nationwidePence / 100) },
    ],
  };
}

export function tikTokGroupLines(
  plan: TikTokAdGroupPlan,
  mode: MmlBudgetMode,
  days: number | null,
): string[] {
  if (plan.blocked) return plan.message ? [plan.message] : [];
  return plan.groups.map((group) => {
    const daily =
      mode === "lifetime" && days && days > 0 ? round2(group.amount / days) : group.amount;
    return `${group.name} ${formatGbp(daily)}/day`;
  });
}

export function mmlBudgetBlockers(input: {
  budget: CampaignPlanBudgetSplit;
  selected: PlanBudgetSelection;
  mode: MmlBudgetMode;
  startDate: string | null;
  endDate: string | null;
  venueLabel: string;
  minimumDaily?: number;
}): string[] {
  const errors: string[] = [];
  const start = input.startDate?.slice(0, 10) || null;
  const end = input.endDate?.slice(0, 10) || null;
  if (start && end && scheduledDayCount(start, end) == null) {
    errors.push("The end date is before the start");
  }
  if (!(input.budget.totalDaily > 0)) errors.push("Enter a budget total");

  const days = scheduledDayCount(start, end);
  if (input.selected.meta && !(input.budget.metaDaily > 0)) {
    errors.push("Meta is selected but has no budget");
  }
  if (input.selected.google && !(input.budget.googleDaily > 0)) {
    errors.push("Google has no budget");
  }
  if (input.selected.tiktok && !(input.budget.tiktokDaily > 0)) {
    errors.push("TikTok is selected but has no budget");
  } else if (input.selected.tiktok) {
    const share = channelDisplayAmount(input.budget.tiktokDaily, input.mode, days);
    const plan = planTikTokAdGroups({
      share,
      mode: input.mode,
      days,
      venueLabel: input.venueLabel,
      minimumDaily: input.minimumDaily,
    });
    if (plan.blocked && plan.message) errors.push(plan.message);
  }
  return errors;
}

/**
 * Equal split, matching the creator's Distribute Budget: campaign level
 * is left alone, each enabled ad set gets the same rounded share.
 */
export function distributeMetaAdSetBudgets<
  T extends { enabled: boolean; budgetPerDay: number; budgetLifetime?: number },
>(suggestions: T[], amount: number, mode: MmlBudgetMode, level: "ad_set" | "campaign"): T[] {
  if (level === "campaign") return suggestions;
  const enabled = suggestions.filter((row) => row.enabled);
  if (enabled.length === 0) return suggestions;
  const perSet = Math.round((amount / enabled.length) * 100) / 100;
  return suggestions.map((row) => {
    if (!row.enabled) return row;
    return mode === "lifetime" ? { ...row, budgetLifetime: perSet } : { ...row, budgetPerDay: perSet };
  });
}
