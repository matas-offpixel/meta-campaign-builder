import {
  defaultTikTokAudiences,
  type TikTokAdGroupDraft,
  type TikTokCampaignDraft,
} from "../types/tiktok-draft.ts";
import { reconcileTikTokAdGroups } from "./ad-group-reconcile.ts";
import { validOptimisationGoalForObjective } from "./campaign-setup.ts";
import { isTikTokInterestGroupLaunchable } from "./interest-groups.ts";

export type PreflightSeverity = "red" | "amber" | "green";

export interface TikTokPreflightCheck {
  id: string;
  label: string;
  severity: PreflightSeverity;
  detail: string;
}

/**
 * The launch-facing ad-group list. Always reconciled against the current
 * interest groups (see `ad-group-reconcile.ts`) rather than trusting whatever
 * was persisted first — the persisted list can be stale by an interest group
 * added or deleted after Step 6 was last opened.
 */
export function suggestTikTokAdGroups(draft: TikTokCampaignDraft): TikTokAdGroupDraft[] {
  return reconcileTikTokAdGroups(draft).adGroups;
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

/**
 * Languages and age are real targeting dimensions that reach the ad-group
 * payload (`languages`, `age_groups`), so a language-plus-age setup must not
 * read as "no targeting". Age is always a number on the draft — 18–65 is the
 * implicit default from `defaultTikTokAudiences()` — so only a range the
 * operator actually moved counts.
 */
export function hasAnyTargeting(draft: TikTokCampaignDraft): boolean {
  return (
    draft.audiences.locationCodes.length > 0 ||
    draft.audiences.languages.length > 0 ||
    draft.audiences.genders.length > 0 ||
    hasNonDefaultTikTokAgeRange(draft) ||
    draft.audiences.interestCategoryIds.length > 0 ||
    (draft.audiences.interestGroups ?? []).some(isTikTokInterestGroupLaunchable) ||
    draft.audiences.behaviourCategoryIds.length > 0 ||
    draft.audiences.customAudienceIds.length > 0 ||
    draft.audiences.lookalikeAudienceIds.length > 0
  );
}

export function hasNonDefaultTikTokAgeRange(draft: TikTokCampaignDraft): boolean {
  const defaults = defaultTikTokAudiences();
  return (
    draft.audiences.ageMin !== defaults.ageMin ||
    draft.audiences.ageMax !== defaults.ageMax
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
      "bid-strategy",
      "Bid strategy selected",
      (draft.optimisation.bidStrategy ?? draft.campaignSetup.bidStrategy) !=
        null,
      draft.optimisation.bidStrategy ??
        draft.campaignSetup.bidStrategy ??
        "Choose a bid strategy — a missing strategy publishes with no bid",
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

/** Same source as the Launch button's client-resolvable preflight gate. */
export function tikTokLaunchReviewSummary(
  blockingIssues: readonly unknown[],
): { ok: boolean; blockerCount: number } {
  return {
    ok: blockingIssues.length === 0,
    blockerCount: blockingIssues.length,
  };
}

/**
 * Chip pass/fail matches `launchDisabled`. Killswitch, launch-in-flight,
 * and blockers each get a distinct non-green label.
 */
export function tikTokReviewValidationChip(input: {
  launchDisabled: boolean;
  writesEnabled: boolean;
  writesDisabledReason: string;
  launching: boolean;
  blockerCount: number;
}): { pass: boolean; message: string } {
  const pass = !input.launchDisabled;
  if (input.launching) {
    return { pass, message: "Launching…" };
  }
  const blockers =
    input.blockerCount > 0
      ? `${input.blockerCount} launch blocker${
          input.blockerCount === 1 ? "" : "s"
        }`
      : null;
  if (blockers && !input.writesEnabled) {
    return {
      pass,
      message: `${blockers} · ${input.writesDisabledReason}`,
    };
  }
  if (blockers) {
    return { pass, message: blockers };
  }
  if (!input.writesEnabled) {
    return { pass, message: input.writesDisabledReason };
  }
  return { pass, message: "all checks pass" };
}
