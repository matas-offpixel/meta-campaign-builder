import { createDefaultCreative, createDefaultDraft } from "../../campaign-defaults.ts";
import type { CampaignDraft, CampaignObjective, OptimisationGoal } from "../../types.ts";
import { composeMetaScheduleIso } from "../schedule.ts";
import type { CampaignPlan, CampaignPlanObjectiveIntent } from "../types.ts";

/** Plan intent → Meta objective and the optimisation goal the adapter writes. */
export function metaObjectiveForIntent(intent: CampaignPlanObjectiveIntent): {
  objective: CampaignObjective;
  optimisationGoal: OptimisationGoal;
} {
  return {
    objective: intent,
    optimisationGoal:
      intent === "awareness" || intent === "engagement" ? "reach" : "conversions",
  };
}

/**
 * Map a campaign plan onto the existing Meta CampaignDraft shape.
 * No launch. Missing ad-account / assets stay empty so existing
 * Meta validators can list the real blockers.
 */
export function planToMetaDraft(plan: CampaignPlan): CampaignDraft {
  const draft = createDefaultDraft();
  const { intent } = plan;
  const cluster = intent.audienceClusterRef?.trim() || "";

  draft.settings.eventId = intent.eventId;
  draft.settings.campaignName = plan.name?.trim() || "Plan campaign";
  const mapped = metaObjectiveForIntent(intent.objectiveIntent);
  draft.settings.objective = mapped.objective;
  draft.settings.optimisationGoal = mapped.optimisationGoal;

  draft.budgetSchedule.budgetAmount = intent.budget.metaDaily;
  draft.budgetSchedule.startDate = composeMetaScheduleIso(
    intent.startDate,
    intent.startTime,
  );
  draft.budgetSchedule.endDate = composeMetaScheduleIso(
    intent.endDate,
    intent.endTime,
  );
  draft.optimisationStrategy.guardrails.baseCampaignBudget = intent.budget.metaDaily;

  if (cluster) {
    const groupId = crypto.randomUUID();
    draft.audiences.interestGroups = [
      {
        id: groupId,
        name: cluster,
        interests: [],
        clusterType: cluster,
      },
    ];
    draft.adSetSuggestions = [
      {
        id: crypto.randomUUID(),
        name: cluster,
        sourceType: "interest_group",
        sourceId: groupId,
        sourceName: cluster,
        ageMin: 18,
        ageMax: 65,
        budgetPerDay: intent.budget.metaDaily,
        advantagePlus: false,
        enabled: true,
      },
    ];
  } else {
    draft.adSetSuggestions = [
      {
        id: crypto.randomUUID(),
        name: "Prospecting",
        sourceType: "blank",
        sourceId: "",
        sourceName: "",
        ageMin: 18,
        ageMax: 65,
        budgetPerDay: intent.budget.metaDaily,
        advantagePlus: true,
        enabled: true,
      },
    ];
  }

  const creative = createDefaultCreative(intent.objectiveIntent);
  creative.name = plan.name?.trim() || "Plan creative";
  creative.destinationUrl = intent.destinationUrl;
  draft.creatives = [creative];
  if (draft.adSetSuggestions[0]) {
    draft.creativeAssignments = {
      [draft.adSetSuggestions[0].id]: [creative.id],
    };
  }

  return draft;
}
