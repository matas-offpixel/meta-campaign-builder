/**
 * Plan budget splitter — presentation + plan-state only.
 * Adapters still consume the three daily figures; this module never
 * invents a lifetime field for Meta / TikTok / Google writers.
 */

import type { CampaignPlanBudgetSplit, PlanAdapterName } from "./types.ts";

export const PLAN_BUDGET_PRESETS = [
  { id: "90-5-5", meta: 90, tiktok: 5, google: 5 },
  { id: "80-15-5", meta: 80, tiktok: 15, google: 5 },
  { id: "70-20-10", meta: 70, tiktok: 20, google: 10 },
  { id: "50-40-10", meta: 50, tiktok: 40, google: 10 },
] as const;

export type PlanBudgetPresetId = (typeof PLAN_BUDGET_PRESETS)[number]["id"];
export type PlanBudgetPlatform = PlanAdapterName;
export type PlanBudgetSelection = Record<PlanBudgetPlatform, boolean>;

export const PLAN_BUDGET_PLATFORMS: PlanBudgetPlatform[] = ["meta", "tiktok", "google"];

function pence(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100);
}

function fromPence(value: number): number {
  return value / 100;
}

export function emptySelection(allOn: boolean): PlanBudgetSelection {
  return { meta: allOn, tiktok: allOn, google: allOn };
}

/**
 * A platform with a daily > 0 is selected. An all-zero split (empty plan)
 * treats every platform as available so the operator can type.
 */
export function selectionFromBudget(budget: CampaignPlanBudgetSplit): PlanBudgetSelection {
  const any = budget.metaDaily > 0 || budget.tiktokDaily > 0 || budget.googleDaily > 0;
  if (!any) return emptySelection(true);
  return {
    meta: budget.metaDaily > 0,
    tiktok: budget.tiktokDaily > 0,
    google: budget.googleDaily > 0,
  };
}

export function selectedPlatforms(selected: PlanBudgetSelection): PlanBudgetPlatform[] {
  return PLAN_BUDGET_PLATFORMS.filter((platform) => selected[platform]);
}

/**
 * Renormalisation:
 * - Meta selected → Meta keeps its preset weight; the remainder
 *   (100 − Meta) is split among other selected platforms in their
 *   original relative ratio. One other → it takes the whole remainder.
 *   None other → Meta = 100. That is why Google-off on 90/5/5 becomes
 *   90/10 (TikTok inherits Google's 5; Meta is unchanged).
 * - Meta off → remaining platforms renormalise in their original ratio
 *   (5:5 → 50/50). One remaining → 100.
 */
export function renormalisePreset(
  preset: { meta: number; tiktok: number; google: number },
  selected: PlanBudgetSelection,
): Record<PlanBudgetPlatform, number> {
  const weights: Record<PlanBudgetPlatform, number> = { meta: 0, tiktok: 0, google: 0 };
  const others = (["tiktok", "google"] as const).filter((platform) => selected[platform]);

  if (selected.meta) {
    if (others.length === 0) {
      weights.meta = 100;
      return weights;
    }
    weights.meta = preset.meta;
    const remainder = 100 - preset.meta;
    const otherSum = others.reduce((sum, platform) => sum + preset[platform], 0);
    if (otherSum <= 0) {
      const each = remainder / others.length;
      for (const platform of others) weights[platform] = each;
      return weights;
    }
    for (const platform of others) {
      weights[platform] = (preset[platform] / otherSum) * remainder;
    }
    return weights;
  }

  const remaining = PLAN_BUDGET_PLATFORMS.filter((platform) => selected[platform]);
  if (remaining.length === 0) return weights;
  const sum = remaining.reduce((total, platform) => total + preset[platform], 0);
  if (sum <= 0) {
    const each = 100 / remaining.length;
    for (const platform of remaining) weights[platform] = each;
    return weights;
  }
  for (const platform of remaining) {
    weights[platform] = (preset[platform] / sum) * 100;
  }
  return weights;
}

/**
 * Allocate `total` across selected platforms by weights. Rounding residue
 * lands on the largest share so the pennies sum exactly to the total.
 */
export function allocateByWeights(
  total: number,
  weights: Record<PlanBudgetPlatform, number>,
  selected: PlanBudgetSelection,
): CampaignPlanBudgetSplit {
  const totalPence = Math.max(0, pence(total));
  const active = selectedPlatforms(selected);
  const split: CampaignPlanBudgetSplit = {
    totalDaily: fromPence(totalPence),
    metaDaily: 0,
    tiktokDaily: 0,
    googleDaily: 0,
  };
  if (active.length === 0 || totalPence === 0) return split;

  const weightSum = active.reduce((sum, platform) => sum + Math.max(0, weights[platform]), 0);
  const safeWeights: Record<PlanBudgetPlatform, number> = { meta: 0, tiktok: 0, google: 0 };
  for (const platform of active) {
    safeWeights[platform] = weightSum > 0 ? Math.max(0, weights[platform]) : 1;
  }
  const denom = active.reduce((sum, platform) => sum + safeWeights[platform], 0);

  let largest = active[0]!;
  for (const platform of active) {
    if (safeWeights[platform] > safeWeights[largest]) largest = platform;
  }

  const raw: Record<PlanBudgetPlatform, number> = { meta: 0, tiktok: 0, google: 0 };
  let allocated = 0;
  for (const platform of active) {
    if (platform === largest) continue;
    const share = Math.round((totalPence * safeWeights[platform]) / denom);
    raw[platform] = share;
    allocated += share;
  }
  raw[largest] = totalPence - allocated;

  split.metaDaily = fromPence(raw.meta);
  split.tiktokDaily = fromPence(raw.tiktok);
  split.googleDaily = fromPence(raw.google);
  return split;
}

export function applyPreset(
  total: number,
  presetId: PlanBudgetPresetId,
  selected: PlanBudgetSelection,
): CampaignPlanBudgetSplit {
  const preset = PLAN_BUDGET_PRESETS.find((row) => row.id === presetId) ?? PLAN_BUDGET_PRESETS[0];
  return allocateByWeights(total, renormalisePreset(preset, selected), selected);
}

export function dailyKey(platform: PlanBudgetPlatform): keyof CampaignPlanBudgetSplit {
  return platform === "meta" ? "metaDaily" : platform === "tiktok" ? "tiktokDaily" : "googleDaily";
}

/**
 * Locked edit: the edited platform takes `nextValue`; the rest of the
 * total is split across the other selected platforms in their current
 * relative proportions. Deselected stay 0. Sum equals `total` to the penny.
 */
export function splitLockedEdit(
  budget: CampaignPlanBudgetSplit,
  selected: PlanBudgetSelection,
  edited: PlanBudgetPlatform,
  nextValue: number,
  total: number,
): CampaignPlanBudgetSplit {
  const others = selectedPlatforms(selected).filter((platform) => platform !== edited);
  if (others.length === 0) {
    const only = Math.max(0, pence(nextValue));
    const split: CampaignPlanBudgetSplit = {
      totalDaily: fromPence(only),
      metaDaily: 0,
      tiktokDaily: 0,
      googleDaily: 0,
    };
    split[dailyKey(edited)] = fromPence(only);
    return split;
  }
  const totalPence = Math.max(0, pence(total));
  const editedPence = Math.min(totalPence, Math.max(0, pence(nextValue)));
  const remaining = totalPence - editedPence;
  const restSelected: PlanBudgetSelection = {
    meta: others.includes("meta"),
    tiktok: others.includes("tiktok"),
    google: others.includes("google"),
  };
  const restWeights: Record<PlanBudgetPlatform, number> = { meta: 0, tiktok: 0, google: 0 };
  for (const platform of others) {
    restWeights[platform] = pence(budget[dailyKey(platform)]);
  }
  const rest = allocateByWeights(fromPence(remaining), restWeights, restSelected);
  const split: CampaignPlanBudgetSplit = {
    totalDaily: fromPence(totalPence),
    metaDaily: rest.metaDaily,
    tiktokDaily: rest.tiktokDaily,
    googleDaily: rest.googleDaily,
  };
  split[dailyKey(edited)] = fromPence(editedPence);
  return split;
}

export function budgetVariancePence(
  budget: CampaignPlanBudgetSplit,
  total: number,
): number {
  return pence(budget.metaDaily + budget.tiktokDaily + budget.googleDaily) - pence(total);
}

export function zeroPlatform(
  budget: CampaignPlanBudgetSplit,
  platform: PlanBudgetPlatform,
): CampaignPlanBudgetSplit {
  const next = { ...budget, [dailyKey(platform)]: 0 };
  return next;
}

/** Inclusive calendar-day count. Null when either date is missing or inverted. */
export function scheduledDayCount(
  startDate: string | null,
  endDate: string | null,
): number | null {
  if (!startDate || !endDate) return null;
  const start = Date.parse(`${startDate.slice(0, 10)}T00:00:00`);
  const end = Date.parse(`${endDate.slice(0, 10)}T00:00:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000) + 1;
}

export function lifetimeToDaily(lifetime: number, days: number): number {
  if (!(days > 0) || !Number.isFinite(lifetime)) return 0;
  return fromPence(pence(lifetime / days));
}

export function formatSplitPercents(weights: Record<PlanBudgetPlatform, number>): string {
  return PLAN_BUDGET_PLATFORMS.filter((platform) => weights[platform] > 0)
    .map((platform) => String(Math.round(weights[platform])))
    .join("/");
}

export function nominalPresetLabel(presetId: PlanBudgetPresetId): string {
  return presetId.replaceAll("-", "/");
}

/**
 * Active chip shows the effective split for the current selection.
 * Inactive chips keep the nominal 70/20/10-style label.
 * Tooltip is always the nominal.
 */
export function presetChipCopy(
  preset: (typeof PLAN_BUDGET_PRESETS)[number],
  selected: PlanBudgetSelection,
  active: boolean,
): { label: string; title: string } {
  const nominal = nominalPresetLabel(preset.id);
  const effective = formatSplitPercents(renormalisePreset(preset, selected));
  return {
    label: active ? effective || nominal : nominal,
    title: nominal,
  };
}
