import type {
  TikTokBidStrategy,
  TikTokObjective,
  TikTokOptimisationGoal,
  TikTokSalesDestination,
} from "@/lib/types/tiktok-draft";

/**
 * Selectable Ads Manager objectives. `AWARENESS` is loadable on existing
 * drafts but is not a TikTok `objective_type` — do not offer it.
 */
export const TIKTOK_OBJECTIVES: TikTokObjective[] = [
  "TRAFFIC",
  "LEAD_GENERATION",
  "CONVERSIONS",
  "VIDEO_VIEWS",
  "REACH",
  "ENGAGEMENT",
];

export const TIKTOK_SALES_DESTINATIONS: TikTokSalesDestination[] = [
  "TIKTOK_SHOP",
  "WEBSITE",
  "APP",
];

export const TIKTOK_OBJECTIVE_LABELS: Record<TikTokObjective, string> = {
  TRAFFIC: "Traffic",
  LEAD_GENERATION: "Lead generation",
  CONVERSIONS: "Sales",
  VIDEO_VIEWS: "Video views",
  REACH: "Reach",
  AWARENESS: "Awareness",
  ENGAGEMENT: "Community interaction",
};

export const TIKTOK_SALES_DESTINATION_LABELS: Record<
  TikTokSalesDestination,
  string
> = {
  TIKTOK_SHOP: "TikTok Shop",
  WEBSITE: "Website",
  APP: "App",
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

export function tikTokObjectivePickerValues(
  current: TikTokObjective | null,
): TikTokObjective[] {
  if (current === "AWARENESS") return [...TIKTOK_OBJECTIVES, "AWARENESS"];
  return TIKTOK_OBJECTIVES;
}

export function isAwarenessTikTokObjective(
  objective: TikTokObjective | null,
): boolean {
  return objective === "AWARENESS";
}

export function tikTokAwarenessReplacementMessage(): string {
  return "Awareness is not a TikTok campaign objective — switch to Reach.";
}

export function isTikTokSalesObjective(
  objective: TikTokObjective | null,
): boolean {
  return objective === "CONVERSIONS";
}

export function defaultTikTokSalesDestination(): TikTokSalesDestination {
  return "WEBSITE";
}

export function resolveTikTokSalesDestination(
  value: unknown,
): TikTokSalesDestination {
  if (value === "TIKTOK_SHOP" || value === "WEBSITE" || value === "APP") {
    return value;
  }
  return "WEBSITE";
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
