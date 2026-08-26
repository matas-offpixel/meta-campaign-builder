import {
  IDLE_PLAN_LAUNCH,
  type CampaignPlan,
  type CampaignPlanObjectiveIntent,
} from "./types.ts";

export function createEmptyCampaignPlan(input: {
  userId: string;
  eventId: string;
  name?: string;
}): CampaignPlan {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    userId: input.userId,
    name: input.name ?? null,
    status: "draft",
    intent: {
      eventId: input.eventId,
      objectiveIntent: "registration",
      budget: {
        totalDaily: 0,
        metaDaily: 0,
        tiktokDaily: 0,
        googleDaily: 0,
      },
      destinationUrl: "",
      audienceClusterRef: null,
      creativeSetRef: null,
      startDate: null,
      endDate: null,
      startTime: null,
      endTime: null,
    },
    launches: {
      meta: { ...IDLE_PLAN_LAUNCH },
      tiktok: { ...IDLE_PLAN_LAUNCH },
      google: { ...IDLE_PLAN_LAUNCH },
    },
    createdAt: now,
    updatedAt: now,
  };
}

export const PLAN_OBJECTIVE_OPTIONS: CampaignPlanObjectiveIntent[] = [
  "purchase",
  "registration",
  "traffic",
  "awareness",
  "engagement",
];
