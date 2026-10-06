import type {
  BudgetScheduleSettings,
  CampaignDraft,
  LocationSelection,
  LocationTargetingGroup,
} from "../types.ts";

/**
 * Merge a schedule patch onto the schedule that is current when the update
 * runs. Callers pass only the fields they mean to change.
 */
export function patchBudgetSchedule(
  prev: BudgetScheduleSettings,
  patch: Partial<BudgetScheduleSettings>,
): BudgetScheduleSettings {
  return { ...prev, ...patch };
}

/** Replace the location list by reading the one on `prev`, not a closed-over copy. */
export function mapLocationGroups(
  prev: BudgetScheduleSettings,
  update: (groups: LocationTargetingGroup[]) => LocationTargetingGroup[],
): BudgetScheduleSettings {
  return { ...prev, locationGroups: update(prev.locationGroups ?? []) };
}

/** Apply a schedule update to the draft that is current when the wizard flushes it. */
export function applyBudgetScheduleUpdate(
  draft: CampaignDraft,
  update: (prev: BudgetScheduleSettings) => BudgetScheduleSettings,
): CampaignDraft {
  return { ...draft, budgetSchedule: update(draft.budgetSchedule) };
}

/** Same for the exclusion pool: append and remove against the current list. */
export function mapExcludedLocations(
  prev: BudgetScheduleSettings,
  update: (excluded: LocationSelection[]) => LocationSelection[],
): BudgetScheduleSettings {
  return { ...prev, excludedLocations: update(prev.excludedLocations ?? []) };
}
