/**
 * Platform-neutral campaign plan (Phase D.1).
 *
 * Intent lives on CampaignPlanIntent — no platform enum. Adapter outcomes
 * are three named records (table-per-adapter in SQL), not a
 * `platform: 'meta' | …` list.
 */

export const CAMPAIGN_PLAN_STATUSES = [
  "draft",
  "launching",
  "live_partial",
  "live",
  "failed",
  "archived",
] as const;

export type CampaignPlanStatus = (typeof CAMPAIGN_PLAN_STATUSES)[number];

export const CAMPAIGN_PLAN_OBJECTIVE_INTENTS = [
  "purchase",
  "registration",
  "traffic",
  "awareness",
  "engagement",
] as const;

export type CampaignPlanObjectiveIntent =
  (typeof CAMPAIGN_PLAN_OBJECTIVE_INTENTS)[number];

export const CAMPAIGN_PLAN_LAUNCH_STATUSES = [
  "idle",
  "launching",
  "live",
  "failed",
  "skipped",
] as const;

export type CampaignPlanLaunchStatus =
  (typeof CAMPAIGN_PLAN_LAUNCH_STATUSES)[number];

export interface CampaignPlanBudgetSplit {
  /** Daily total in major currency units (£/€/$). */
  totalDaily: number;
  metaDaily: number;
  tiktokDaily: number;
  googleDaily: number;
}

export interface CampaignPlanIntent {
  eventId: string;
  objectiveIntent: CampaignPlanObjectiveIntent;
  budget: CampaignPlanBudgetSplit;
  /** Any URL (v2.1) — event LP or operator-pasted destination. */
  destinationUrl: string;
  /** ClusterLabel string or null. Not a FK. */
  audienceClusterRef: string | null;
  /** Opaque creative-set reference or null. Not a FK. */
  creativeSetRef: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface CampaignPlanLaunchRecord {
  status: CampaignPlanLaunchStatus;
  platformCampaignId: string | null;
  draftId: string | null;
  error: string | null;
}

export interface CampaignPlanLaunches {
  meta: CampaignPlanLaunchRecord;
  tiktok: CampaignPlanLaunchRecord;
  google: CampaignPlanLaunchRecord;
}

export interface CampaignPlan {
  id: string;
  userId: string;
  name: string | null;
  status: CampaignPlanStatus;
  intent: CampaignPlanIntent;
  launches: CampaignPlanLaunches;
  createdAt: string;
  updatedAt: string;
}

export const IDLE_PLAN_LAUNCH: CampaignPlanLaunchRecord = {
  status: "idle",
  platformCampaignId: null,
  draftId: null,
  error: null,
};

export function isCampaignPlanStatus(value: string): value is CampaignPlanStatus {
  return (CAMPAIGN_PLAN_STATUSES as readonly string[]).includes(value);
}

export function isCampaignPlanObjectiveIntent(
  value: string,
): value is CampaignPlanObjectiveIntent {
  return (CAMPAIGN_PLAN_OBJECTIVE_INTENTS as readonly string[]).includes(value);
}

/**
 * Overall plan status from adapter outcomes.
 * live_partial is first-class: ≥1 live AND ≥1 failed. Sibling success
 * is never rolled back by a sibling failure.
 */
export function deriveCampaignPlanStatus(
  launches: CampaignPlanLaunches,
): Exclude<CampaignPlanStatus, "archived"> {
  const records = [launches.meta, launches.tiktok, launches.google];
  if (records.some((record) => record.status === "launching")) {
    return "launching";
  }

  const liveCount = records.filter((record) => record.status === "live").length;
  const failedCount = records.filter((record) => record.status === "failed").length;

  if (liveCount > 0 && failedCount > 0) return "live_partial";
  if (liveCount > 0 && failedCount === 0) return "live";
  if (failedCount > 0 && liveCount === 0) return "failed";
  return "draft";
}

export function budgetedLaunchAdapters(budget: CampaignPlanBudgetSplit): Array<
  keyof CampaignPlanLaunches
> {
  const adapters: Array<keyof CampaignPlanLaunches> = [];
  if (budget.metaDaily > 0) adapters.push("meta");
  if (budget.tiktokDaily > 0) adapters.push("tiktok");
  if (budget.googleDaily > 0) adapters.push("google");
  return adapters;
}
