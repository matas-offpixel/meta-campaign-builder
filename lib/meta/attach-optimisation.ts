/**
 * Lowest-cost campaign budget (CBO) requires every ad set to use the same
 * optimisation. A new ad set takes that from the live campaign's existing
 * ad sets, not from the draft that was copied in.
 */

import type { CampaignObjective, OptimisationGoal } from "../types.ts";
import { buildPromotedObject, mapOptimisationGoal, resolveOptimisationGoal } from "./adset.ts";

/** Meta code 100, subcode 1885760. */
export const LOWEST_COST_SAME_OPTIMISATION =
  "The same optimisation for ad delivery selection is required if the campaign bid strategy is lowest cost.";

export interface AttachOptimisationAdSet {
  optimization_goal?: string;
  promoted_object?: { custom_event_type?: string };
}

/** Facts the picker stores, and the live campaign the launch reads. */
export interface AttachOptimisationCampaign {
  bid_strategy?: string;
  daily_budget?: string | number;
  lifetime_budget?: string | number;
  adsets?: { data?: AttachOptimisationAdSet[] };
}

export interface AttachDeliveryOptimisation {
  bidStrategy?: string;
  dailyBudget?: string;
  lifetimeBudget?: string;
  adSets: AttachOptimisationAdSet[];
}

export type AttachOptimisationDecision =
  | { action: "keep_draft" }
  | {
      action: "use_campaign";
      objective: CampaignObjective;
      optimisationGoal: OptimisationGoal;
      label: string;
      warning: string;
    }
  | { action: "refuse"; message: string };

const KNOWN: Record<string, { objective: CampaignObjective; goal: OptimisationGoal; label: string }> = {
  "LANDING_PAGE_VIEWS|": { objective: "traffic", goal: "landing_page_views", label: "Landing page views" },
  "LINK_CLICKS|": { objective: "traffic", goal: "link_clicks", label: "Link clicks" },
  "OFFSITE_CONVERSIONS|PURCHASE": { objective: "purchase", goal: "conversions", label: "Purchases" },
  "OFFSITE_CONVERSIONS|INITIATED_CHECKOUT": {
    objective: "initiate_checkout",
    goal: "conversions",
    label: "Initiate checkout",
  },
  "OFFSITE_CONVERSIONS|COMPLETE_REGISTRATION": {
    objective: "registration",
    goal: "complete_registration",
    label: "Complete registration",
  },
  "REACH|": { objective: "awareness", goal: "reach", label: "Reach" },
  "IMPRESSIONS|": { objective: "awareness", goal: "impressions", label: "Impressions" },
  "POST_ENGAGEMENT|": { objective: "engagement", goal: "post_engagement", label: "Post engagement" },
  "THRUPLAY|": { objective: "awareness", goal: "video_views", label: "Video views" },
  "VALUE|PURCHASE": { objective: "purchase", goal: "value", label: "Purchase value" },
};

function positiveBudget(value: string | number | undefined): boolean {
  if (value == null || value === "") return false;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0;
}

/** Campaign budget, and Meta's lowest cost (or no bid strategy at all). */
export function isLowestCostCampaignBudget(campaign: AttachOptimisationCampaign): boolean {
  const hasBudget = positiveBudget(campaign.daily_budget) || positiveBudget(campaign.lifetime_budget);
  if (!hasBudget) return false;
  const strategy = (campaign.bid_strategy ?? "").trim();
  return strategy === "" || strategy === "LOWEST_COST_WITHOUT_CAP";
}

function deliveryKey(goal: string | undefined, event: string | undefined): string {
  return `${goal ?? ""}|${event ?? ""}`;
}

function draftDeliveryKey(objective: CampaignObjective, goal: OptimisationGoal): string {
  const effective = resolveOptimisationGoal(goal, objective);
  const promoted = buildPromotedObject(effective, objective, "pixel");
  return deliveryKey(mapOptimisationGoal(effective), promoted?.custom_event_type);
}

/**
 * The optimisation most of the existing ad sets already use.
 * A tie, or no readable goal, is not a majority.
 */
export function majorityAdSetOptimisation(
  adSets: AttachOptimisationAdSet[],
): { goal: string; event?: string } | null {
  const counts = new Map<string, number>();
  for (const row of adSets) {
    if (!row.optimization_goal) continue;
    const key = deliveryKey(row.optimization_goal, row.promoted_object?.custom_event_type);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best = 0;
  const winners: string[] = [];
  for (const [key, n] of counts) {
    if (n > best) {
      best = n;
      winners.length = 0;
      winners.push(key);
    } else if (n === best) {
      winners.push(key);
    }
  }
  if (winners.length !== 1) return null;
  const [goal, event] = winners[0].split("|");
  return { goal, event: event || undefined };
}

export function attachOptimisationWillMatchLine(label: string): string {
  return `This campaign optimises for ${label}; new ad sets will too.`;
}

export function attachOptimisationRefusal(campaignName: string): string {
  return (
    `${campaignName} uses lowest cost, so every new ad set has to use the same optimisation as the ones already in it. ` +
    `${LOWEST_COST_SAME_OPTIMISATION} ` +
    `The existing ad sets don't share one optimisation this launch can match, so no audience, creative, or ad set was created.`
  );
}

/**
 * What a new ad set should optimise for under this live campaign.
 * Lowest-cost CBO uses the existing ad sets' majority. Any other bid
 * strategy keeps the draft. A lowest-cost mismatch with no majority refuses.
 */
export function decideAttachOptimisation(input: {
  campaignName: string;
  draftObjective: CampaignObjective;
  draftOptimisationGoal: OptimisationGoal;
  campaign: AttachOptimisationCampaign;
}): AttachOptimisationDecision {
  if (!isLowestCostCampaignBudget(input.campaign)) return { action: "keep_draft" };

  const rows = input.campaign.adsets?.data ?? [];
  if (rows.length === 0) return { action: "keep_draft" };

  const majority = majorityAdSetOptimisation(rows);
  if (!majority) {
    return { action: "refuse", message: attachOptimisationRefusal(input.campaignName) };
  }

  const known = KNOWN[deliveryKey(majority.goal, majority.event)];
  const draftKey = draftDeliveryKey(input.draftObjective, input.draftOptimisationGoal);
  const majorityKey = deliveryKey(majority.goal, majority.event);
  if (!known) {
    if (draftKey === majorityKey) return { action: "keep_draft" };
    return { action: "refuse", message: attachOptimisationRefusal(input.campaignName) };
  }
  if (draftKey === majorityKey) return { action: "keep_draft" };

  return {
    action: "use_campaign",
    objective: known.objective,
    optimisationGoal: known.goal,
    label: known.label,
    warning: attachOptimisationWillMatchLine(known.label),
  };
}

/** Step 1 / Review. Null when the picker never read the ad sets. */
export function attachOptimisationWarningForCampaign(input: {
  draftObjective: CampaignObjective;
  draftOptimisationGoal: OptimisationGoal;
  campaignName: string;
  delivery?: AttachDeliveryOptimisation | null;
}): string | null {
  if (!input.delivery || input.delivery.adSets.length === 0) return null;
  const decision = decideAttachOptimisation({
    campaignName: input.campaignName,
    draftObjective: input.draftObjective,
    draftOptimisationGoal: input.draftOptimisationGoal,
    campaign: {
      bid_strategy: input.delivery.bidStrategy,
      daily_budget: input.delivery.dailyBudget,
      lifetime_budget: input.delivery.lifetimeBudget,
      adsets: { data: input.delivery.adSets },
    },
  });
  return decision.action === "use_campaign" ? decision.warning : null;
}

/**
 * An empty `existingMetaCampaigns` array must not hide the singular
 * campaign. The launch still reads that campaign live.
 */
export function attachCampaignTargets<T extends { id: string }>(
  listed: T[] | undefined | null,
  singular: T | undefined | null,
): T[] {
  if (listed && listed.length > 0) return listed;
  return singular ? [singular] : [];
}
