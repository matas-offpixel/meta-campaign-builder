/**
 * lib/google-search/push-preview.ts
 *
 * One Review row per campaign: the daily budget and CPC ceiling push will
 * send. Built from the same resolvers as the writer.
 */

import { formatPounds, resolveCampaignDailyBudgets, type CampaignBudgetSource } from "./budget.ts";
import { resolveCpcCeilingMicros } from "./bids.ts";
import type { GoogleSearchPlanTree } from "./types.ts";

export interface CampaignPushPreviewRow {
  campaignId: string;
  campaignName: string;
  daily: string;
  source: CampaignBudgetSource;
  sourceLabel: string;
  /** Null under Manual CPC — there is no campaign ceiling. */
  ceiling: string | null;
  ceilingFromSheet: boolean;
  serves: boolean;
}

const SOURCE_LABELS: Record<CampaignBudgetSource, string> = {
  campaign_daily: "campaign daily budget",
  campaign_monthly: "campaign monthly ÷ 30",
  plan_split: "share of plan daily budget",
  fallback: "£5 last resort",
};

export function campaignPushPreview(
  tree: Pick<GoogleSearchPlanTree, "plan" | "campaigns">,
): CampaignPushPreviewRow[] {
  const maximiseClicks = tree.plan.bidding_strategy === "maximize_clicks";
  const byId = new Map(tree.campaigns.map((c) => [c.id, c]));
  return resolveCampaignDailyBudgets(tree).map((budget) => {
    const ceiling = resolveCpcCeilingMicros(byId.get(budget.campaignId)?.bid_adjustments ?? {});
    return {
      campaignId: budget.campaignId,
      campaignName: budget.campaignName,
      daily: formatPounds(budget.micros / 1_000_000),
      source: budget.source,
      sourceLabel: SOURCE_LABELS[budget.source],
      ceiling: maximiseClicks ? formatPounds(ceiling.micros / 1_000_000) : null,
      ceilingFromSheet: ceiling.fromSheet,
      serves: budget.serves,
    };
  });
}
