import { TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE } from "../../tiktok-wizard/campaign-setup.ts";
import {
  createDefaultTikTokDraft,
  type TikTokCampaignDraft,
  type TikTokObjective,
} from "../../types/tiktok-draft.ts";
import {
  composeTikTokScheduleAt,
  TIKTOK_DEFAULT_END_HOUR,
  TIKTOK_DEFAULT_START_HOUR,
} from "../schedule.ts";
import type { CampaignPlan, CampaignPlanObjectiveIntent } from "../types.ts";

/**
 * Internal objective → live TikTok objective.
 * CONVERSIONS is retired (PR #517); purchase uses LEAD_GENERATION.
 */
export function mapIntentToTikTokObjective(
  intent: CampaignPlanObjectiveIntent,
): TikTokObjective {
  switch (intent) {
    case "traffic":
      return "TRAFFIC";
    case "awareness":
      return "AWARENESS";
    case "engagement":
      return "ENGAGEMENT";
    case "purchase":
    case "registration":
      return "LEAD_GENERATION";
  }
}

/**
 * Map a campaign plan onto the existing TikTokCampaignDraft shape.
 * No launch. Account / identity / video stay empty so
 * collectTikTokLaunchPreflight lists the real blockers (including the
 * £50/day GBP ad-group floor).
 */
export function planToTikTokDraft(plan: CampaignPlan): TikTokCampaignDraft {
  const draft = createDefaultTikTokDraft(crypto.randomUUID());
  const { intent } = plan;
  const objective = mapIntentToTikTokObjective(intent.objectiveIntent);
  const goals = TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE[objective];
  const cluster = intent.audienceClusterRef?.trim() || "";

  draft.eventId = intent.eventId;
  draft.campaignSetup.campaignName = plan.name?.trim() || "Plan campaign";
  draft.campaignSetup.objective = objective;
  draft.campaignSetup.optimisationGoal = goals[0] ?? null;
  draft.campaignSetup.bidStrategy = "LOWEST_COST";
  draft.optimisation.bidStrategy = "LOWEST_COST";
  draft.optimisation.smartPlusEnabled = false;

  draft.budgetSchedule.budgetMode = "DAILY";
  draft.budgetSchedule.budgetAmount = intent.budget.tiktokDaily;
  draft.budgetSchedule.dailyBudget = intent.budget.tiktokDaily;
  draft.budgetSchedule.scheduleStartAt = composeTikTokScheduleAt(
    intent.startDate,
    intent.startTime,
    TIKTOK_DEFAULT_START_HOUR,
  );
  draft.budgetSchedule.scheduleEndAt = composeTikTokScheduleAt(
    intent.endDate,
    intent.endTime,
    TIKTOK_DEFAULT_END_HOUR,
  );

  const adGroupId = crypto.randomUUID();
  draft.budgetSchedule.adGroups = [
    {
      id: adGroupId,
      name: cluster || "Prospecting",
      budget: intent.budget.tiktokDaily,
      startAt: null,
      endAt: null,
    },
  ];

  const creativeId = crypto.randomUUID();
  draft.creatives.items = [
    {
      id: creativeId,
      name: plan.name?.trim() || "Plan creative",
      mode: "VIDEO_REFERENCE",
      baseName: plan.name?.trim() || "Plan creative",
      videoId: null,
      videoUrl: null,
      thumbnailUrl: null,
      durationSeconds: null,
      title: null,
      sparkPostId: null,
      caption: "",
      adText: plan.name?.trim() || "Plan ad",
      displayName: "",
      landingPageUrl: intent.destinationUrl,
      cta: "LEARN_MORE",
      musicId: null,
    },
  ];
  draft.creativeAssignments.byAdGroupId = { [adGroupId]: [creativeId] };

  return draft;
}
