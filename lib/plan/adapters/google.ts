import { lookupFallbackGeoConstant } from "../../google-ads/geo-resolve.ts";
import { derivePlanDailyBudget, inclusiveDays } from "../../google-search/budget.ts";
import {
  DEFAULT_GEO_TARGET_TYPE,
  DEFAULT_PACING,
  DEFAULT_STRUCTURE_MODE,
  type GoogleSearchGeoTarget,
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

/**
 * Labels the verified geotarget list can name. Anything else is left
 * out — a nearby id is not invented.
 */
export function googleGeoTargetsFromLabels(labels: string[]): GoogleSearchGeoTarget[] {
  const seen = new Set<string>();
  const targets: GoogleSearchGeoTarget[] = [];
  for (const label of labels) {
    const trimmed = label.trim();
    if (!trimmed) continue;
    const resource = lookupFallbackGeoConstant(trimmed);
    if (!resource || seen.has(resource)) continue;
    seen.add(resource);
    targets.push({
      location: trimmed,
      resolved_resource_name: resource,
      resolved_name: trimmed,
    });
  }
  return targets;
}

/**
 * Write the Google share onto the Search plan's budget columns
 * (total_budget, daily_budget, campaign daily_budget) and the plan dates.
 * Resolved location labels replace geo targets. An unresolved list leaves
 * the targets already on the plan.
 */
export function applyPlanBudgetToGoogle(
  tree: GoogleSearchPlanTree,
  input: {
    googleDaily: number;
    startDate: string | null;
    endDate: string | null;
    locationLabels: string[];
  },
): GoogleSearchPlanTree {
  const start = input.startDate?.slice(0, 10) || null;
  const end = input.endDate?.slice(0, 10) || null;
  const dateRange = start && end ? { since: start, until: end } : tree.plan.date_range;
  const days = inclusiveDays(dateRange);
  const daily = Math.round(Math.max(0, input.googleDaily) * 100) / 100;
  const totalBudget = days && daily > 0 ? Math.round(daily * days * 100) / 100 : null;
  const resolved = googleGeoTargetsFromLabels(input.locationLabels);
  const campaigns =
    tree.campaigns.length === 1
      ? tree.campaigns.map((campaign) => ({ ...campaign, daily_budget: daily }))
      : tree.campaigns;

  return {
    ...tree,
    plan: {
      ...tree.plan,
      total_budget: totalBudget,
      daily_budget: derivePlanDailyBudget(totalBudget, dateRange),
      date_range: dateRange,
      geo_targets: resolved.length > 0 ? resolved : tree.plan.geo_targets,
    },
    campaigns,
  };
}
