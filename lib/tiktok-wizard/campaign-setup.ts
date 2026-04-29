import type {
  TikTokBidStrategy,
  TikTokObjective,
  TikTokOptimisationGoal,
} from "@/lib/types/tiktok-draft";

export const TIKTOK_OBJECTIVES: TikTokObjective[] = [
  "TRAFFIC",
  "CONVERSIONS",
  "VIDEO_VIEWS",
  "REACH",
  "AWARENESS",
  "ENGAGEMENT",
];

export const TIKTOK_OBJECTIVE_LABELS: Record<TikTokObjective, string> = {
  TRAFFIC: "Traffic",
  CONVERSIONS: "Conversions",
  VIDEO_VIEWS: "Video views",
  REACH: "Reach",
  AWARENESS: "Awareness",
  ENGAGEMENT: "Engagement",
};

export const TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE: Record<
  TikTokObjective,
  TikTokOptimisationGoal[]
> = {
  TRAFFIC: ["CLICK", "LANDING_PAGE_VIEW", "REACH"],
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
