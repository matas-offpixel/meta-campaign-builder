import { applyTemplate } from "../templates.ts";
import { nextDuplicateName } from "../duplicate-name.ts";
import type { CampaignDraft, CampaignTemplate } from "../types.ts";
import { composeMetaScheduleIso } from "./schedule.ts";
import type { CampaignPlan } from "./types.ts";

/**
 * Shared plan inputs overlaid onto a duplicated library campaign.
 * Everything else (audiences, creatives, captions, placements) carries over.
 */
export const PLAN_TO_DRAFT_OVERLAY: ReadonlyArray<{
  plan: string;
  draft: string;
}> = [
  { plan: "name", draft: "settings.campaignName" },
  { plan: "intent.eventId", draft: "settings.eventId" },
  { plan: "intent.destinationUrl", draft: "creatives[].destinationUrl" },
  { plan: "intent.budget.metaDaily", draft: "budgetSchedule.budgetAmount" },
  { plan: "intent.budget.metaDaily", draft: "optimisationStrategy.guardrails.baseCampaignBudget" },
  { plan: "intent.startDate + startTime", draft: "budgetSchedule.startDate" },
  { plan: "intent.endDate + endTime", draft: "budgetSchedule.endDate" },
];

/**
 * In-memory duplicate — same shape as `duplicateCampaign` (new id, draft
 * status, source untouched) but named with `nextDuplicateName`.
 */
export function cloneCampaignDraft(
  source: CampaignDraft,
  existingNames: readonly string[],
): CampaignDraft {
  const now = new Date().toISOString();
  const sourceName = source.settings.campaignName?.trim() || "Untitled";
  return {
    ...source,
    id: crypto.randomUUID(),
    settings: {
      ...source.settings,
      campaignName: nextDuplicateName(sourceName, existingNames),
    },
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
}

export function draftFromLibraryTemplate(
  template: CampaignTemplate,
  existingNames: readonly string[],
): CampaignDraft {
  const applied = applyTemplate(template);
  const sourceName = template.name.trim() || applied.settings.campaignName || "Untitled";
  return {
    ...applied,
    settings: {
      ...applied.settings,
      campaignName: nextDuplicateName(sourceName, existingNames),
    },
  };
}

export function overlayPlanSharedInputs(
  draft: CampaignDraft,
  plan: CampaignPlan,
  extras?: { clientId?: string | null },
): CampaignDraft {
  const destinationUrl = plan.intent.destinationUrl;
  const campaignName = plan.name?.trim() || draft.settings.campaignName;
  return {
    ...draft,
    settings: {
      ...draft.settings,
      campaignName,
      eventId: plan.intent.eventId,
      ...(extras?.clientId ? { clientId: extras.clientId } : {}),
    },
    budgetSchedule: {
      ...draft.budgetSchedule,
      budgetAmount: plan.intent.budget.metaDaily,
      startDate: composeMetaScheduleIso(plan.intent.startDate, plan.intent.startTime),
      endDate: composeMetaScheduleIso(plan.intent.endDate, plan.intent.endTime),
    },
    optimisationStrategy: {
      ...draft.optimisationStrategy,
      guardrails: {
        ...draft.optimisationStrategy.guardrails,
        baseCampaignBudget: plan.intent.budget.metaDaily,
      },
    },
    creatives: draft.creatives.map((creative) => ({
      ...creative,
      destinationUrl,
    })),
  };
}

export function planLaunchStatusIsIdle(plan: CampaignPlan): boolean {
  return (["meta", "tiktok", "google"] as const).every(
    (adapter) =>
      plan.launches[adapter].status === "idle" && !plan.launches[adapter].draftId,
  );
}
