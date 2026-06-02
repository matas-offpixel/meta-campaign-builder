import type { CampaignInsightsRow } from "../reporting/event-insights";
import { tiktokGet, TIKTOK_CHUNK_CONCURRENCY } from "./client.ts";
import { campaignNameMatchesEventCode } from "./matching.ts";
import { resolveGoalInfo } from "./optimization-goal-map.ts";

interface TikTokIntegratedRow {
  dimensions?: Record<string, string | undefined>;
  metrics?: Record<string, string | number | null | undefined>;
}

interface TikTokIntegratedResponse {
  list?: TikTokIntegratedRow[];
  page_info?: {
    page?: number;
    page_size?: number;
    total_number?: number;
    total_page?: number;
  };
}

interface TikTokCampaignGetRow {
  campaign_id?: string;
  campaign_name?: string;
  optimization_goal?: string;
}

interface TikTokCampaignGetResponse {
  list?: TikTokCampaignGetRow[];
  page_info?: {
    total_page?: number;
  };
}

type TikTokGet = typeof tiktokGet;

export interface FetchTikTokEventCampaignInsightsInput {
  advertiserId: string;
  token: string;
  eventCode: string;
  window: { since: string; until: string };
  /** Test hook only — production callers use the default `tiktokGet`. */
  request?: TikTokGet;
}

/**
 * Universal metrics valid across every TikTok campaign objective.
 *
 * These are safe to include in any /report/integrated/get/ call regardless
 * of the advertiser's campaign types or optimization goals.
 *
 * NOTE: `video_play_actions` is the correct field name (not `video_play` —
 * `video_play` was removed by TikTok and causes "invalid metric fields" errors).
 */
export const BASE_METRICS = [
  "spend",
  "impressions",
  "reach",
  "clicks",
  "ctr",
  "cpm",
  // Generic conversion metrics — valid for all objectives
  "conversion",
  "cost_per_conversion",
  "conversion_rate",
  "real_time_conversion",
  "real_time_cost_per_conversion",
  "real_time_conversion_rate",
  // Video metrics — correct field names
  "video_play_actions",     // was incorrectly "video_play" — causes API rejection
  "video_views_p25",
  "video_views_p50",
  "video_views_p75",
  "video_views_p100",
  // view_content is the fallback metric for awareness/unknown goals
  "view_content",
] as const;

/**
 * Per-optimization-goal metrics added ON TOP of BASE_METRICS.
 *
 * TikTok's /report/integrated/get/ validates that requested metrics are
 * compatible with the campaign objectives in the advertiser account. Requesting
 * a metric like `add_to_cart` when the account has no ADD_TO_CART campaigns
 * causes the entire API call to fail with "Invalid metric fields".
 *
 * Each entry is only included when we are fetching data for campaigns that
 * actually use that optimization goal.
 */
const GOAL_EXTRA_METRICS: Record<string, readonly string[]> = {
  COMPLETE_PAYMENT: [
    "complete_payment",
    "cost_per_complete_payment",
    "complete_payment_roas",
  ],
  COMPLETE_REGISTRATION: [
    "complete_registration",
    "cost_per_complete_registration",
  ],
  ADD_TO_CART: ["add_to_cart", "cost_per_add_to_cart"],
  INITIATE_CHECKOUT: ["initiate_checkout", "cost_per_initiate_checkout"],
  ADD_TO_WISHLIST: ["add_to_wishlist", "cost_per_add_to_wishlist"],
};

/**
 * Build the metric list for a /report/integrated/get/ call for campaigns
 * with the given optimization goal.
 *
 * BASE_METRICS are always included. Goal-specific conversion metrics are
 * appended only when the goal is known — avoiding "invalid metric fields"
 * errors when the advertiser does not run campaigns with those objectives.
 *
 * Exported for testability.
 */
export function buildMetricsForCampaign(
  optimizationGoal: string | null | undefined,
): string[] {
  const base: string[] = [...BASE_METRICS];
  const goal = (optimizationGoal ?? "").toUpperCase();
  const extras = GOAL_EXTRA_METRICS[goal] ?? [];
  return [...base, ...extras];
}

/** All conversion-related metric keys tracked in the per-campaign aggregate. */
const CONVERSION_KEYS = [
  "complete_registration",
  "complete_payment",
  "add_to_cart",
  "initiate_checkout",
  "add_to_wishlist",
  "view_content",
  "conversion",
] as const;

type ConversionKey = (typeof CONVERSION_KEYS)[number];

type Aggregate = {
  id: string;
  spend: number;
  impressions: number;
  clicks: number;
} & Record<ConversionKey, number>;

const DIMENSIONS = ["campaign_id", "stat_time_day"];
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

/**
 * Fetch TikTok campaign-day insights, aggregate by campaign, and return
 * the same row contract as the Meta reporting layer.
 *
 * Architecture (post PR fix/tiktok-per-campaign-metrics):
 *
 *   1. Call /campaign/get/ FIRST (before the report) to learn each
 *      campaign's name and optimization_goal.
 *   2. Filter to event-code matching campaigns.
 *   3. Group matching campaigns by optimization_goal — campaigns with the
 *      same goal share one /report/integrated/get/ call (one call per
 *      distinct metric set rather than N calls per campaign).
 *   4. For each goal group, call /report/integrated/get/ with BASE_METRICS
 *      plus the goal-specific extra metrics. Filter aggregated rows to only
 *      the campaigns in that group.
 *   5. Return results for all matched campaigns.
 *
 * Why this order? TikTok rejects a /report/integrated/get/ call if ANY
 * metric in the list is invalid for the advertiser's account (e.g.
 * requesting `add_to_cart` for an account that only runs LEAD_GENERATION
 * campaigns). Fetching campaign goals first lets us build a metric list
 * that only includes fields valid for the actual campaigns in each call.
 */
export async function fetchTikTokEventCampaignInsights(
  input: FetchTikTokEventCampaignInsightsInput,
): Promise<CampaignInsightsRow[]> {
  // Keep the constant referenced in the load-bearing callsite so a future
  // concurrency increase is an explicit product decision, not dead config.
  if (TIKTOK_CHUNK_CONCURRENCY !== 1) {
    throw new Error("TikTok insight chunks must run serially.");
  }

  const request = input.request ?? tiktokGet;

  // ── Step 1: Fetch ALL campaigns (names + goals) up-front ──────────────────
  // Previously this was called AFTER the integrated report using only the
  // campaign IDs found in the report. Now we call it first so we can build
  // the correct per-goal metric lists before hitting /report/integrated/get/.
  const { names: campaignNames, goals: campaignGoals } =
    await fetchAllTikTokCampaignMeta({
      advertiserId: input.advertiserId,
      token: input.token,
      request,
    });

  const hasNames = campaignNames.size > 0;

  // ── Step 2: Identify event-code matching campaigns ────────────────────────
  const matchingIds = hasNames
    ? [...campaignNames.keys()].filter((id) =>
        campaignNameMatchesEventCode(campaignNames.get(id)!, input.eventCode),
      )
    : [];

  // ── Step 3: Build goal groups ─────────────────────────────────────────────
  // Each goal group gets one /report/integrated/get/ call with the metric set
  // for that goal. An empty-string goal key uses only BASE_METRICS (safe
  // fallback for unrecognised or missing objectives).
  //
  // Special case: if /campaign/get/ returned nothing (hasNames false), we
  // fall back to a single bulk call with BASE_METRICS, include all campaigns
  // in the response (filterIds = false), and return them as "(unnamed)".
  interface GoalGroup {
    ids: Set<string>;
    filterIds: boolean;
  }
  const goalGroups = new Map<string, GoalGroup>();

  if (!hasNames) {
    // Fallback: no campaign meta available, use universal metrics, no filtering.
    goalGroups.set("", { ids: new Set(), filterIds: false });
  } else if (matchingIds.length === 0) {
    // Has names but no campaigns match this event code — nothing to fetch.
    return [];
  } else {
    for (const id of matchingIds) {
      const goal = (campaignGoals.get(id) ?? "").toUpperCase();
      const existing = goalGroups.get(goal) ?? { ids: new Set(), filterIds: true };
      existing.ids.add(id);
      goalGroups.set(goal, existing);
    }
  }

  // ── Step 4: Per-goal-group report calls ───────────────────────────────────
  const aggregates = new Map<string, Aggregate>();

  for (const [goal, { ids: campaignIdSet, filterIds }] of goalGroups) {
    const metrics = buildMetricsForCampaign(goal);

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const res = await request<TikTokIntegratedResponse>(
        "/report/integrated/get/",
        {
          advertiser_id: input.advertiserId,
          report_type: "BASIC",
          data_level: "AUCTION_CAMPAIGN",
          dimensions: DIMENSIONS,
          metrics,
          start_date: input.window.since,
          end_date: input.window.until,
          page,
          page_size: PAGE_SIZE,
        },
        input.token,
      );

      for (const row of res.list ?? []) {
        const dims = row.dimensions ?? {};
        const m = row.metrics ?? {};
        const id = dims.campaign_id;
        if (!id) continue;
        // Skip campaigns outside this goal group when we have filtered targeting.
        if (filterIds && !campaignIdSet.has(id)) continue;

        const existing: Aggregate = aggregates.get(id) ?? {
          id,
          spend: 0,
          impressions: 0,
          clicks: 0,
          complete_registration: 0,
          complete_payment: 0,
          add_to_cart: 0,
          initiate_checkout: 0,
          add_to_wishlist: 0,
          view_content: 0,
          conversion: 0,
        };
        existing.spend += numberMetric(m.spend);
        existing.impressions += numberMetric(m.impressions);
        existing.clicks += numberMetric(m.clicks);
        for (const key of CONVERSION_KEYS) {
          existing[key] += numberMetric(m[key]);
        }
        aggregates.set(id, existing);
      }

      const pageInfo = res.page_info;
      if (!pageInfo?.total_page || page >= pageInfo.total_page) break;
    }
  }

  // ── Step 5: Build output rows ─────────────────────────────────────────────
  return [...aggregates.values()].flatMap((a) => {
    const name = campaignNames.get(a.id) ?? "(unnamed)";
    if (hasNames && !campaignNameMatchesEventCode(name, input.eventCode)) {
      return [];
    }
    const goalInfo = resolveGoalInfo(campaignGoals.get(a.id));
    const results = a[goalInfo.metricKey as ConversionKey] ?? 0;
    const ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : null;
    const cpm = a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null;
    const cpr = results > 0 ? a.spend / results : null;
    return [
      {
        id: a.id,
        name,
        status: "UNKNOWN",
        spend: a.spend,
        impressions: a.impressions,
        clicks: a.clicks,
        ctr,
        cpm,
        cpr,
        results,
        ad_account_id: input.advertiserId,
        optimization_goal_label: goalInfo.label,
      },
    ];
  });
}

/**
 * Fetch ALL campaigns for an advertiser (names + optimization_goals), paginated.
 *
 * Unlike the previous `fetchTikTokCampaignMeta` which was called AFTER the
 * integrated report with specific campaign IDs, this is called FIRST without
 * a campaign_ids filter so we can build per-goal metric lists upfront.
 */
async function fetchAllTikTokCampaignMeta(input: {
  advertiserId: string;
  token: string;
  request: TikTokGet;
}): Promise<{
  names: Map<string, string>;
  goals: Map<string, string>;
}> {
  const names = new Map<string, string>();
  const goals = new Map<string, string>();

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await input.request<TikTokCampaignGetResponse>(
      "/campaign/get/",
      {
        advertiser_id: input.advertiserId,
        fields: ["campaign_id", "campaign_name", "optimization_goal"],
        page_size: PAGE_SIZE,
        page,
      },
      input.token,
    );
    for (const row of res.list ?? []) {
      if (row.campaign_id) {
        if (row.campaign_name) names.set(row.campaign_id, row.campaign_name);
        if (row.optimization_goal) goals.set(row.campaign_id, row.optimization_goal);
      }
    }
    const pageInfo = res.page_info;
    if (!pageInfo?.total_page || page >= pageInfo.total_page) break;
  }

  return { names, goals };
}

function numberMetric(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
