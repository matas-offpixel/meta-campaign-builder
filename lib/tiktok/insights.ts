import type { CampaignInsightsRow } from "../reporting/event-insights";
import { tiktokGet, TIKTOK_CHUNK_CONCURRENCY } from "./client.ts";
import { campaignNameMatchesEventCode } from "./matching.ts";

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

const METRICS = [
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpm",
  "video_play_actions",
  "video_views_p100",
  "average_video_play",
];

const DIMENSIONS = ["campaign_id", "stat_time_day"];
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

/**
 * Fetch TikTok campaign-day insights, aggregate by campaign, and return the
 * same row contract the Meta reporting layer exposes. TikTok does not expose a
 * generic "results" metric across every campaign objective, so CPR uses
 * video_play_actions as the closest live engagement result for now; manual XLSX
 * snapshots remain the richer fallback for creative/audience reporting.
 */
export async function fetchTikTokEventCampaignInsights(
  input: FetchTikTokEventCampaignInsightsInput,
): Promise<CampaignInsightsRow[]> {
  // Keep the constant referenced in the load-bearing callsite so a future
  // concurrency increase is an explicit product decision, not dead config.
  if (TIKTOK_CHUNK_CONCURRENCY !== 1) {
    throw new Error("TikTok insight chunks must run serially.");
  }

  const aggregates = new Map<
    string,
    {
      id: string;
      spend: number;
      impressions: number;
      clicks: number;
      results: number;
    }
  >();
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
      const metrics = row.metrics ?? {};
      const id = dims.campaign_id;
      if (!id) continue;
      const existing = aggregates.get(id) ?? {
        id,
        spend: 0,
        impressions: 0,
        clicks: 0,
        results: 0,
      };
      existing.spend += numberMetric(metrics.spend);
      existing.impressions += numberMetric(metrics.impressions);
      existing.clicks += numberMetric(metrics.clicks);
      existing.results += numberMetric(metrics.video_play_actions);
      aggregates.set(id, existing);
    }

    const pageInfo = res.page_info;
    if (!pageInfo?.total_page || page >= pageInfo.total_page) break;
  }

  const campaignNames = await fetchTikTokCampaignNames({
    advertiserId: input.advertiserId,
    token: input.token,
    campaignIds: [...aggregates.keys()],
    request,
  });

  const hasEnrichedNames = campaignNames.size > 0;
  return [...aggregates.values()].flatMap((a) => {
    const name = campaignNames.get(a.id) ?? "(unnamed)";
    // If /campaign/get/ returns no names at all, keep the rows visible rather
    // than presenting a false "no matching campaigns" state. As soon as TikTok
    // returns any campaign-name data, filtering uses the enriched names.
    if (hasEnrichedNames && !campaignNameMatchesEventCode(name, input.eventCode)) {
      return [];
    }
    const ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : null;
    const cpm = a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null;
    const cpr = a.results > 0 ? a.spend / a.results : null;
    return [{
      id: a.id,
      name,
      status: "UNKNOWN",
      spend: a.spend,
      impressions: a.impressions,
      clicks: a.clicks,
      ctr,
      cpm,
      cpr,
      results: a.results,
      ad_account_id: input.advertiserId,
    }];
  });
}

async function fetchTikTokCampaignNames(input: {
  advertiserId: string;
  token: string;
  campaignIds: string[];
  request: TikTokGet;
}): Promise<Map<string, string>> {
  if (input.campaignIds.length === 0) return new Map();
  const res = await input.request<TikTokCampaignGetResponse>(
    "/campaign/get/",
    {
      advertiser_id: input.advertiserId,
      campaign_ids: input.campaignIds,
      fields: ["campaign_id", "campaign_name"],
      page_size: PAGE_SIZE,
    },
    input.token,
  );
  const names = new Map<string, string>();
  for (const row of res.list ?? []) {
    if (row.campaign_id && row.campaign_name) {
      names.set(row.campaign_id, row.campaign_name);
    }
  }
  return names;
}

function numberMetric(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
