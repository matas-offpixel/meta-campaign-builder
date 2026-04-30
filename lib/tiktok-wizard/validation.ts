import { validOptimisationGoalForObjective } from "./campaign-setup.ts";
import { validateBudgetGuardrails } from "./budget-schedule.ts";
import {
  everyAdGroupHasCreative,
  everyCreativeAssigned,
} from "./review.ts";
import type { TikTokCampaignDraft } from "../types/tiktok-draft.ts";

export type TikTokWizardIssueSeverity = "error" | "warning";

export interface TikTokWizardValidationIssue {
  id: string;
  step: number;
  label: string;
  message: string;
  severity: TikTokWizardIssueSeverity;
  blocksContinue: boolean;
}

export interface TikTokValidationContext {
  eventEditPath?: string | null;
}

export const TIKTOK_PIXEL_ID_PATTERN = /^\d+$/;

export function validateTikTokWizardStep(
  draft: TikTokCampaignDraft,
  step: number,
  context: TikTokValidationContext = {},
): TikTokWizardValidationIssue[] {
  return buildTikTokWizardValidationIssues(draft, context).filter(
    (issue) => issue.step === step,
  );
}

export function buildTikTokWizardValidationIssues(
  draft: TikTokCampaignDraft,
  context: TikTokValidationContext = {},
): TikTokWizardValidationIssue[] {
  const issues: TikTokWizardValidationIssue[] = [];
  if (!draft.accountSetup.advertiserId) {
    issues.push(error("advertiser", 0, "Connect a TikTok account first", "Connect a TikTok account first before configuring campaign details."));
  }
  if (
    draft.accountSetup.pixelId &&
    !TIKTOK_PIXEL_ID_PATTERN.test(draft.accountSetup.pixelId)
  ) {
    issues.push(error("pixel-id", 0, "Invalid TikTok pixel ID", "TikTok pixel IDs should be numeric strings."));
  }
  if (!draft.campaignSetup.eventCode?.trim()) {
    issues.push(
      error(
        "event-code",
        1,
        "Missing event_code",
        context.eventEditPath
          ? `Set an event_code on the event row before creating a campaign: ${context.eventEditPath}`
          : "Set an event_code on the event row before creating a campaign.",
      ),
    );
  }
  if (
    draft.campaignSetup.objective &&
    draft.campaignSetup.optimisationGoal &&
    !validOptimisationGoalForObjective(
      draft.campaignSetup.objective,
      draft.campaignSetup.optimisationGoal,
    )
  ) {
    issues.push(error("objective-goal", 1, "Invalid objective and optimisation goal", "Select an optimisation goal that is valid for the chosen objective."));
  }
  validateBudgetGuardrails({
    budget: draft.budgetSchedule,
    optimisation: draft.optimisation,
  }).forEach((message, index) => {
    issues.push(warning(`guardrail-${index}`, 2, "Budget guardrail warning", message));
  });
  if (!hasAnyTargeting(draft)) {
    issues.push(warning("targeting", 3, "No targeting selected", "Select at least one location, demographic, interest, behaviour, custom audience, or lookalike before review."));
  }
  if (draft.creatives.items.length === 0) {
    issues.push(error("creatives", 4, "No creatives configured", "Add at least one creative before review."));
  }
  if (draft.creatives.items.some((creative) => creative.adText.length > 100)) {
    issues.push(error("ad-text-length", 4, "Ad text too long", "TikTok ad text must be 100 characters or fewer."));
  }
  if (
    draft.budgetSchedule.budgetAmount == null ||
    draft.budgetSchedule.budgetAmount <= 0
  ) {
    issues.push(error("budget-positive", 5, "Set a budget greater than £0", "Set a budget greater than £0."));
  }
  if (!draft.optimisation.smartPlusEnabled && !scheduleEndAfterStart(draft)) {
    issues.push(error("schedule-order", 5, "Schedule end must be after start", "Schedule end must be after start."));
  }
  if (!everyCreativeAssigned(draft) || !everyAdGroupHasCreative(draft)) {
    issues.push(error("creative-assignments", 6, "Assign at least one creative to each ad group", "Assign at least one creative to each ad group."));
  }
  return issues;
}

export function hasBlockingTikTokWizardIssues(
  draft: TikTokCampaignDraft,
  step: number,
  context: TikTokValidationContext = {},
): boolean {
  return validateTikTokWizardStep(draft, step, context).some(
    (issue) => issue.blocksContinue,
  );
}

function hasAnyTargeting(draft: TikTokCampaignDraft): boolean {
  return (
    draft.audiences.locationCodes.length > 0 ||
    draft.audiences.genders.length > 0 ||
    draft.audiences.languages.length > 0 ||
    draft.audiences.interestCategoryIds.length > 0 ||
    draft.audiences.behaviourCategoryIds.length > 0 ||
    draft.audiences.customAudienceIds.length > 0 ||
    draft.audiences.lookalikeAudienceIds.length > 0
  );
}

function scheduleEndAfterStart(draft: TikTokCampaignDraft): boolean {
  const { scheduleStartAt, scheduleEndAt } = draft.budgetSchedule;
  return Boolean(
    scheduleStartAt && scheduleEndAt && scheduleEndAt > scheduleStartAt,
  );
}

function error(
  id: string,
  step: number,
  label: string,
  message: string,
): TikTokWizardValidationIssue {
  return { id, step, label, message, severity: "error", blocksContinue: true };
}

function warning(
  id: string,
  step: number,
  label: string,
  message: string,
): TikTokWizardValidationIssue {
  return { id, step, label, message, severity: "warning", blocksContinue: false };
}
