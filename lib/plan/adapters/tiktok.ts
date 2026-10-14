import { TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE } from "../../tiktok-wizard/campaign-setup.ts";
import {
  createDefaultTikTokDraft,
  type TikTokAdGroupDraft,
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

export interface TikTokAdGroupPlanInput {
  mode: "DAILY" | "LIFETIME";
  /** TikTok's daily share, in major units. */
  dailyAmount: number;
  groups: Array<{ role: "regional" | "nationwide"; name: string; amount: number }>;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
}

function isNationwideGroup(name: string): boolean {
  return name === "Nationwide UK" || name.startsWith("Nationwide UK");
}

/**
 * Patch budget, schedule, and ad groups onto a TikTok draft that already
 * has creatives. An empty group list is a no-op so a share under TikTok's
 * minimum is never written. Locations stay the draft's existing codes:
 * the write path has one location list, and the nationwide group is the
 * extra ad group named here.
 */
export function applyTikTokAdGroupPlan(
  draft: TikTokCampaignDraft,
  input: TikTokAdGroupPlanInput,
): TikTokCampaignDraft {
  if (input.groups.length === 0) return draft;

  const existing = draft.budgetSchedule.adGroups;
  const nationwideExisting = existing.find((group) => isNationwideGroup(group.name));
  const regionalExisting = existing.find((group) => group !== nationwideExisting) ?? existing[0];

  const adGroups: TikTokAdGroupDraft[] = input.groups.map((group) => {
    const kept = group.role === "nationwide" ? nationwideExisting : regionalExisting;
    return {
      id: kept?.id ?? crypto.randomUUID(),
      name: group.name,
      budget: group.amount,
      startAt: kept?.startAt ?? null,
      endAt: kept?.endAt ?? null,
      ...(kept?.interestGroupId != null ? { interestGroupId: kept.interestGroupId } : {}),
    };
  });

  const assignments = { ...draft.creativeAssignments.byAdGroupId };
  const regionalId = adGroups.find((group) => group.name.startsWith("Regional ·"))?.id;
  const nationwideId = adGroups.find((group) => isNationwideGroup(group.name))?.id;
  if (nationwideId && regionalId && !assignments[nationwideId] && assignments[regionalId]) {
    assignments[nationwideId] = [...assignments[regionalId]];
  }
  const keptIds = new Set(adGroups.map((group) => group.id));
  for (const id of Object.keys(assignments)) {
    if (!keptIds.has(id)) delete assignments[id];
  }

  const amount = Math.round(input.groups.reduce((sum, group) => sum + group.amount, 0) * 100) / 100;

  return {
    ...draft,
    budgetSchedule: {
      ...draft.budgetSchedule,
      budgetMode: input.mode,
      budgetAmount: amount,
      dailyBudget: input.dailyAmount,
      lifetimeBudget: input.mode === "LIFETIME" ? amount : null,
      scheduleStartAt: composeTikTokScheduleAt(
        input.startDate,
        input.startTime,
        TIKTOK_DEFAULT_START_HOUR,
      ),
      scheduleEndAt: composeTikTokScheduleAt(input.endDate, input.endTime, TIKTOK_DEFAULT_END_HOUR),
      adGroups,
    },
    creativeAssignments: { byAdGroupId: assignments },
  };
}
