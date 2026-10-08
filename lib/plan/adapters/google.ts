import { derivePlanDailyBudget, inclusiveDays } from "../../google-search/budget.ts";
import {
  DEFAULT_GEO_TARGET_TYPE,
  DEFAULT_PACING,
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
  const dateRange =
    intent.startDate && intent.endDate
      ? { since: intent.startDate, until: intent.endDate }
      : null;
  const days = inclusiveDays(dateRange);
  const totalBudget =
    days && intent.budget.googleDaily > 0
      ? Math.round(intent.budget.googleDaily * days * 100) / 100
      : null;

  return {
    plan: {
      id: planId,
      user_id: plan.userId,
      event_id: intent.eventId,
      google_ads_account_id: null,
      name,
      status: "draft",
      // A plan total, not a daily figure: Review checks campaign spend
      // over the window against it.
      total_budget: totalBudget,
      daily_budget: derivePlanDailyBudget(totalBudget, dateRange),
      pacing: DEFAULT_PACING,
      bidding_strategy: "maximize_clicks",
      structure_mode: DEFAULT_STRUCTURE_MODE,
      geo_targets: [],
      geo_target_type: DEFAULT_GEO_TARGET_TYPE,
      // Google Ads campaign date_range is date-level. Plan start/end times
      // are not invented into a time-of-day the API does not accept.
      date_range: dateRange,
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
