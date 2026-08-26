import {
  DEFAULT_GEO_TARGET_TYPE,
  DEFAULT_STRUCTURE_MODE,
  type GoogleSearchPlanTree,
} from "../../google-search/types.ts";
import type { CampaignPlan } from "../types.ts";

function clip(text: string, max: number): string {
  const trimmed = text.trim() || "Event";
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

/**
 * Map a campaign plan onto the existing Google Search plan tree
 * (google_search_plans + children). No launch. Keywords are left empty
 * on purpose — inventing search terms would be a guess; existing
 * validateGoogleSearchPlan reports that blocker.
 */
export function planToGoogleDraft(plan: CampaignPlan): GoogleSearchPlanTree {
  const { intent } = plan;
  const now = new Date().toISOString();
  const planId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const adGroupId = crypto.randomUUID();
  const rsaId = crypto.randomUUID();
  const name = plan.name?.trim() || "Plan campaign";

  return {
    plan: {
      id: planId,
      user_id: plan.userId,
      event_id: intent.eventId,
      google_ads_account_id: null,
      name,
      status: "draft",
      total_budget: intent.budget.googleDaily,
      bidding_strategy: "maximize_clicks",
      structure_mode: DEFAULT_STRUCTURE_MODE,
      geo_targets: [],
      geo_target_type: DEFAULT_GEO_TARGET_TYPE,
      date_range:
        intent.startDate && intent.endDate
          ? { since: intent.startDate, until: intent.endDate }
          : null,
      pushed_at: null,
      created_at: now,
      updated_at: now,
    },
    campaigns: [
      {
        id: campaignId,
        plan_id: planId,
        name,
        priority: null,
        monthly_budget: null,
        daily_budget: intent.budget.googleDaily,
        bid_adjustments: {},
        notes: null,
        sort_order: 0,
        pushed_resource_name: null,
        created_at: now,
        ad_groups: [
          {
            id: adGroupId,
            campaign_id: campaignId,
            name: intent.audienceClusterRef?.trim() || "Search",
            default_cpc: null,
            sort_order: 0,
            pushed_resource_name: null,
            created_at: now,
            keywords: [],
            rsas: [
              {
                id: rsaId,
                ad_group_id: adGroupId,
                headlines: [
                  { text: clip(name, 30) },
                  { text: clip(`${name} tickets`, 30) },
                  { text: "Get tickets" },
                ],
                descriptions: [
                  { text: clip(`Tickets for ${name}`, 90) },
                  { text: "Official event tickets." },
                ],
                final_url: intent.destinationUrl,
                path1: null,
                path2: null,
                pushed_resource_name: null,
                created_at: now,
              },
            ],
          },
        ],
        negatives: [],
      },
    ],
    plan_negatives: [],
    sitelinks: [],
  };
}
