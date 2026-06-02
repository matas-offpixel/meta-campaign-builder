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
 * Full metric bundle requested from the integrated report.
 *
 * We request all conversion-event metrics in one call so the resolver
 * can pick the right field per campaign after we learn each campaign's
 * `optimization_goal` from `/campaign/get/`. Requesting more fields
 * than needed has no cost impact — TikTok returns null/0 for metrics
 * that don't apply to a given campaign objective.
 */
const METRICS = [
  "spend",
  "impressions",
  "reach",
  "clicks",
  "ctr",
  "cpm",
  // Generic conversion aggregate (used for LEAD / CONVERT objectives)
  "conversion",
  "cost_per_conversion",
  "conversion_rate",
  // Specific pixel-event metrics
  "complete_payment",
  "cost_per_complete_payment",
  "complete_payment_roas",
  "complete_registration",
  "cost_per_complete_registration",
  "add_to_cart",
  "cost_per_add_to_cart",
  "initiate_checkout",
  "cost_per_initiate_checkout",
  "add_to_wishlist",
  "cost_per_add_to_wishlist",
  "view_content",
  "cost_per_view_content",
  // Video engagement (retained for reference; no longer used as "results")
  "video_play",
  "video_views_p25",
  "video_views_p50",
  "video_views_p75",
  "video_views_p100",
  "average_video_play",
];

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
 * "Results" and CPR are resolved per campaign based on the campaign's
 * `optimization_goal` (fetched from /campaign/get/), so signup campaigns
 * show `complete_registration` counts, purchase campaigns show
 * `complete_payment` counts, and awareness-only campaigns fall back to
 * `view_content` (resulting in a — CPR).
 */
export async function fetchTikTokEventCampaignInsights(
  input: FetchTikTokEventCampaignInsightsInput,
): Promise<CampaignInsightsRow[]> {
  // Keep the constant referenced in the load-bearing callsite so a future
  // concurrency increase is an explicit product decision, not dead config.
  if (TIKTOK_CHUNK_CONCURRENCY !== 1) {
    throw new Error("TikTok insight chunks must run serially.");
  }

  const aggregates = new Map<string, Aggregate>();
  const request = input.request ?? tiktokGet;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await request<TikTokIntegratedResponse>(
      "/report/integrated/get/",
      {
        advertiser_id: input.advertiserId,
        report_type: "BASIC",
        data_level: "AUCTION_CAMPAIGN",
        dimensions: DIMENSIONS,
        metrics: METRICS,
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

  const { names: campaignNames, goals: campaignGoals } =
    await fetchTikTokCampaignMeta({
      advertiserId: input.advertiserId,
      token: input.token,
      campaignIds: [...aggregates.keys()],
      request,
    });

  const hasEnrichedNames = campaignNames.size > 0;
  return [...aggregates.values()].flatMap((a) => {
    const name = campaignNames.get(a.id) ?? "(unnamed)";
    if (hasEnrichedNames && !campaignNameMatchesEventCode(name, input.eventCode)) {
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
 * Fetch campaign names AND optimization goals in one /campaign/get/ call.
 * Returns two maps keyed by campaign_id.
 */
async function fetchTikTokCampaignMeta(input: {
  advertiserId: string;
  token: string;
  campaignIds: string[];
  request: TikTokGet;
}): Promise<{
  names: Map<string, string>;
  goals: Map<string, string>;
}> {
  if (input.campaignIds.length === 0) {
    return { names: new Map(), goals: new Map() };
  }
  const res = await input.request<TikTokCampaignGetResponse>(
    "/campaign/get/",
    {
      advertiser_id: input.advertiserId,
      campaign_ids: input.campaignIds,
      fields: ["campaign_id", "campaign_name", "optimization_goal"],
      page_size: PAGE_SIZE,
    },
    input.token,
  );
  const names = new Map<string, string>();
  const goals = new Map<string, string>();
  for (const row of res.list ?? []) {
    if (row.campaign_id) {
      if (row.campaign_name) names.set(row.campaign_id, row.campaign_name);
      if (row.optimization_goal) goals.set(row.campaign_id, row.optimization_goal);
    }
  }
  return { names, goals };
}

function numberMetric(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
