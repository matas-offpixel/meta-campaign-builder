import type {
  TikTokAdGroupDraft,
  TikTokCampaignDraft,
} from "../types/tiktok-draft.ts";
import { validOptimisationGoalForObjective } from "./campaign-setup.ts";

export type PreflightSeverity = "red" | "amber" | "green";

export interface TikTokPreflightCheck {
  id: string;
  label: string;
  severity: PreflightSeverity;
  detail: string;
}

export function suggestTikTokAdGroups(draft: TikTokCampaignDraft): TikTokAdGroupDraft[] {
  if (draft.budgetSchedule.adGroups.length > 0) return draft.budgetSchedule.adGroups;
  const count = draft.optimisation.smartPlusEnabled ? 2 : 3;
  const perGroupBudget =
    draft.budgetSchedule.budgetAmount == null
      ? null
      : Math.round((draft.budgetSchedule.budgetAmount / count) * 100) / 100;
  return Array.from({ length: count }, (_, index) => ({
    id: `adgroup-${index + 1}`,
    name: draft.optimisation.smartPlusEnabled
      ? `Smart+ ad group ${index + 1}`
      : `Ad group ${index + 1}`,
    budget: perGroupBudget,
    startAt: draft.budgetSchedule.scheduleStartAt,
    endAt: draft.budgetSchedule.scheduleEndAt,
  }));
}

export function everyCreativeAssigned(draft: TikTokCampaignDraft): boolean {
  if (draft.creatives.items.length === 0) return false;
  return draft.creatives.items.every((creative) =>
    Object.values(draft.creativeAssignments.byAdGroupId).some((creativeIds) =>
      creativeIds.includes(creative.id),
    ),
  );
}

export function everyAdGroupHasCreative(draft: TikTokCampaignDraft): boolean {
  const adGroups = suggestTikTokAdGroups(draft);
  if (adGroups.length === 0) return false;
  return adGroups.every(
    (adGroup) => (draft.creativeAssignments.byAdGroupId[adGroup.id] ?? []).length > 0,
  );
}

export function hasAnyTargeting(draft: TikTokCampaignDraft): boolean {
  return (
    draft.audiences.locationCodes.length > 0 ||
    draft.audiences.genders.length > 0 ||
    draft.audiences.interestCategoryIds.length > 0 ||
    draft.audiences.behaviourCategoryIds.length > 0 ||
    draft.audiences.customAudienceIds.length > 0 ||
    draft.audiences.lookalikeAudienceIds.length > 0
  );
}

export function buildTikTokPreflightChecks(
  draft: TikTokCampaignDraft,
): TikTokPreflightCheck[] {
  const accountComplete = Boolean(
    draft.accountSetup.advertiserId &&
      (draft.accountSetup.identityId || draft.accountSetup.identityManualName),
  );
  const hasEventCodePrefix = Boolean(
    draft.campaignSetup.eventCode &&
      draft.campaignSetup.campaignName
        .toLocaleLowerCase()
        .startsWith(`[${draft.campaignSetup.eventCode}] `.toLocaleLowerCase()),
  );
  const budgetPositive =
    draft.budgetSchedule.budgetAmount != null && draft.budgetSchedule.budgetAmount > 0;
  const scheduleValid = Boolean(
    draft.budgetSchedule.scheduleStartAt &&
      draft.budgetSchedule.scheduleEndAt &&
      draft.budgetSchedule.scheduleEndAt > draft.budgetSchedule.scheduleStartAt,
  );

  return [
    check("account", "Account complete", accountComplete, "Advertiser and identity set"),
    check(
      "campaign-name",
      "Campaign name has [event_code]",
      hasEventCodePrefix,
      draft.campaignSetup.eventCode ?? "No event code",
    ),
    check(
      "objective-goal",
      "Objective matches optimisation goal",
      validOptimisationGoalForObjective(
        draft.campaignSetup.objective,
        draft.campaignSetup.optimisationGoal,
      ),
      "Objective and optimisation goal are compatible",
    ),
    check(
      "creatives",
      "At least one creative",
      draft.creatives.items.length > 0,
      `${draft.creatives.items.length} creative(s)`,
    ),
    check(
      "creative-assignments",
      "Every creative assigned",
      everyCreativeAssigned(draft),
      "Creative to ad-group matrix complete",
    ),
    check(
      "ad-group-assignments",
      "Every ad group has creatives",
      everyAdGroupHasCreative(draft),
      "Ad-group columns have at least one creative",
    ),
    check("budget", "Budget > 0", budgetPositive, "Budget amount set"),
    check("schedule", "Schedule end > start", scheduleValid, "Schedule dates valid"),
    check(
      "targeting",
      "At least one targeting dimension",
      hasAnyTargeting(draft),
      "Location, demographic, or audience selected",
    ),
  ];
}

function check(
  id: string,
  label: string,
  ok: boolean,
  detail: string,
): TikTokPreflightCheck {
  return {
    id,
    label,
    severity: ok ? "green" : "red",
    detail: ok ? detail : "Needs attention",
  };
}
