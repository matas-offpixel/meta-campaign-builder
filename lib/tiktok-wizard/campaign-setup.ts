import type {
  TikTokBidStrategy,
  TikTokObjective,
  TikTokOptimisationGoal,
} from "@/lib/types/tiktok-draft";

export const TIKTOK_OBJECTIVES: TikTokObjective[] = [
  "TRAFFIC",
  "LEAD_GENERATION",
  "CONVERSIONS",
  "VIDEO_VIEWS",
  "REACH",
  "AWARENESS",
  "ENGAGEMENT",
];

export const TIKTOK_RETIRED_OBJECTIVES: readonly TikTokObjective[] = [
  "CONVERSIONS",
];

export const TIKTOK_OBJECTIVE_LABELS: Record<TikTokObjective, string> = {
  TRAFFIC: "Traffic",
  LEAD_GENERATION: "Lead generation",
  CONVERSIONS: "Conversions (retired — use Lead generation)",
  VIDEO_VIEWS: "Video views",
  REACH: "Reach",
  AWARENESS: "Awareness",
  ENGAGEMENT: "Engagement",
};

/**
 * Per-objective goals. AdgroupCreateBody.optimization_goal is unconstrained
 * `str` (no enum). LEAD_GENERATION → CONVERSION (maps to CONVERT) is the
 * goal on live Ironworks Lead generation campaigns (PR #517) and matches
 * Ads Manager "Leads". Do not invent VALUE / LEAD_GENERATION as a goal
 * without an SDK enum.
 */
export const TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE: Record<
  TikTokObjective,
  TikTokOptimisationGoal[]
> = {
  TRAFFIC: ["CLICK", "LANDING_PAGE_VIEW", "REACH"],
  LEAD_GENERATION: ["CONVERSION"],
  CONVERSIONS: ["CONVERSION", "VALUE"],
  VIDEO_VIEWS: ["VIDEO_VIEW", "VIEW_6_SECOND"],
  REACH: ["REACH"],
  AWARENESS: ["SHOW"],
  ENGAGEMENT: ["ENGAGEMENT"],
};

export const TIKTOK_OPTIMISATION_GOAL_LABELS: Record<
  TikTokOptimisationGoal,
  string
> = {
  CLICK: "Click",
  LANDING_PAGE_VIEW: "Landing page view",
  CONVERSION: "Conversion",
  VALUE: "Value",
  VIDEO_VIEW: "Video view",
  VIEW_6_SECOND: "6-second view",
  REACH: "Reach",
  SHOW: "Show",
  ENGAGEMENT: "Engagement",
};

export function isRetiredTikTokObjective(
  objective: TikTokObjective | null,
): boolean {
  return objective != null && TIKTOK_RETIRED_OBJECTIVES.includes(objective);
}

export function tikTokOptimisationGoalLabel(
  goal: TikTokOptimisationGoal,
  objective?: TikTokObjective | null,
): string {
  if (objective === "LEAD_GENERATION" && goal === "CONVERSION") return "Leads";
  return TIKTOK_OPTIMISATION_GOAL_LABELS[goal];
}

export const TIKTOK_BID_STRATEGIES: TikTokBidStrategy[] = [
  "LOWEST_COST",
  "COST_CAP",
  "SMART_PLUS",
];

export const TIKTOK_BID_STRATEGY_LABELS: Record<TikTokBidStrategy, string> = {
  LOWEST_COST: "Lowest cost",
  COST_CAP: "Cost cap",
  SMART_PLUS: "Smart+",
};

export function ensureTikTokCampaignNamePrefix(
  eventCode: string | null,
  rawName: string,
): string {
  const name = rawName.trimStart();
  if (!eventCode?.trim()) return name;
  const prefix = `[${eventCode.trim()}] `;
  return name.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
    ? name
    : `${prefix}${stripAnyLeadingEventCode(name)}`;
}

export function stripLockedEventCodePrefix(
  eventCode: string | null,
  campaignName: string,
): string {
  if (!eventCode?.trim()) return campaignName;
  const prefix = `[${eventCode.trim()}] `;
  return campaignName.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
    ? campaignName.slice(prefix.length)
    : stripAnyLeadingEventCode(campaignName);
}

export function validOptimisationGoalForObjective(
  objective: TikTokObjective | null,
  goal: TikTokOptimisationGoal | null,
): boolean {
  if (!objective || !goal) return false;
  return TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE[objective].includes(goal);
}

export function defaultOptimisationGoalForObjective(
  objective: TikTokObjective,
): TikTokOptimisationGoal {
  return TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE[objective][0];
}

function stripAnyLeadingEventCode(value: string): string {
  return value.replace(/^\[[^\]]+\]\s*/, "");
}
