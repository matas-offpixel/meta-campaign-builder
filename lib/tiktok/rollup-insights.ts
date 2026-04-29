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

export interface TikTokDailyInsightRow {
  date: string;
  tiktok_spend: number;
  tiktok_impressions: number;
  tiktok_reach: number;
  tiktok_clicks: number;
  tiktok_video_views: number;
  tiktok_video_views_2s: number;
  tiktok_video_views_6s: number;
  tiktok_video_views_100p: number;
  tiktok_avg_play_time_ms: number | null;
  tiktok_post_engagement: number;
  tiktok_results: number;
}

export interface FetchTikTokDailyRollupInsightsInput {
  advertiserId: string;
  token: string;
  eventCode: string;
  since: string;
  until: string;
  /** Test hook only — production callers use the default `tiktokGet`. */
  request?: TikTokGet;
}

const METRICS = [
  "spend",
  "impressions",
  "reach",
  "clicks",
  "engagements",
  "post_engagement",
  "video_play_actions",
  "video_watched_2s",
  "video_watched_6s",
  "video_views_p25",
  "video_views_p50",
  "video_views_p75",
  "video_views_p100",
  "average_video_play",
];

const DIMENSIONS = ["campaign_id", "stat_time_day"];
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const MAX_WINDOW_DAYS = 30;

/**
 * TikTok analogue of Meta's `fetchEventDailyMetaMetrics`: read daily
 * campaign insights, enrich campaign names through `/campaign/get/`, apply the
 * reporting-layer event_code matcher to those names, then aggregate by day.
 */
export async function fetchTikTokDailyRollupInsights(
  input: FetchTikTokDailyRollupInsightsInput,
): Promise<TikTokDailyInsightRow[]> {
  if (TIKTOK_CHUNK_CONCURRENCY !== 1) {
    throw new Error("TikTok rollup chunks must run serially.");
  }

  const request = input.request ?? tiktokGet;
  const rawRows: Array<{
    campaignId: string;
    date: string;
    spend: number;
    impressions: number;
    clicks: number;
    reach: number;
    videoViews2s: number;
    videoViews6s: number;
    videoViews100p: number;
    avgPlayTimeMs: number | null;
    postEngagement: number;
    results: number;
  }> = [];
  const campaignIds = new Set<string>();

  for (const window of buildDateWindows(input.since, input.until)) {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const res = await request<TikTokIntegratedResponse>(
        "/report/integrated/get/",
        {
          advertiser_id: input.advertiserId,
          report_type: "BASIC",
          data_level: "AUCTION_CAMPAIGN",
          dimensions: DIMENSIONS,
          metrics: METRICS,
          start_date: window.since,
          end_date: window.until,
          page,
          page_size: PAGE_SIZE,
        },
        input.token,
      );

      for (const row of res.list ?? []) {
        const dims = row.dimensions ?? {};
        const campaignId = dims.campaign_id;
        const date = dims.stat_time_day;
        if (!campaignId || !date) continue;
        campaignIds.add(campaignId);
        const metrics = row.metrics ?? {};
        rawRows.push({
          campaignId,
          date: date.slice(0, 10),
          spend: numberMetric(metrics.spend),
          impressions: numberMetric(metrics.impressions),
          reach: numberMetric(metrics.reach),
          clicks: numberMetric(metrics.clicks),
          videoViews2s: numberMetric(metrics.video_watched_2s),
          videoViews6s: numberMetric(metrics.video_watched_6s),
          videoViews100p: numberMetric(metrics.video_views_p100),
          avgPlayTimeMs: nullableNumberMetric(metrics.average_video_play),
          postEngagement: numberMetric(metrics.post_engagement) || numberMetric(metrics.engagements),
          results: numberMetric(metrics.video_play_actions),
        });
      }

      const pageInfo = res.page_info;
      if (!pageInfo?.total_page || page >= pageInfo.total_page) break;
    }
  }

  if (rawRows.length === 0) return [];

  const names = await fetchTikTokCampaignNames({
    advertiserId: input.advertiserId,
    token: input.token,
    campaignIds: [...campaignIds],
    request,
  });
  const hasEnrichedNames = names.size > 0;
  const byDate = new Map<string, TikTokDailyInsightRow>();

  for (const row of rawRows) {
    const name = names.get(row.campaignId) ?? "(unnamed)";
    if (hasEnrichedNames && !campaignNameMatchesEventCode(name, input.eventCode)) {
      continue;
    }
    const existing = byDate.get(row.date) ?? {
      date: row.date,
      tiktok_spend: 0,
      tiktok_impressions: 0,
      tiktok_reach: 0,
      tiktok_clicks: 0,
      tiktok_video_views: 0,
      tiktok_video_views_2s: 0,
      tiktok_video_views_6s: 0,
      tiktok_video_views_100p: 0,
      tiktok_avg_play_time_ms: null,
      tiktok_post_engagement: 0,
      tiktok_results: 0,
    };
    existing.tiktok_spend += row.spend;
    existing.tiktok_impressions += row.impressions;
    existing.tiktok_reach += row.reach;
    existing.tiktok_clicks += row.clicks;
    existing.tiktok_video_views += row.videoViews100p;
    existing.tiktok_video_views_2s += row.videoViews2s;
    existing.tiktok_video_views_6s += row.videoViews6s;
    existing.tiktok_video_views_100p += row.videoViews100p;
    existing.tiktok_avg_play_time_ms = weightedAverage(
      existing.tiktok_avg_play_time_ms,
      existing.tiktok_impressions - row.impressions,
      row.avgPlayTimeMs,
      row.impressions,
    );
    existing.tiktok_post_engagement += row.postEngagement;
    existing.tiktok_results += row.results;
    byDate.set(row.date, existing);
  }

  return [...byDate.values()]
    .map((row) => ({
      ...row,
      tiktok_spend: round2(row.tiktok_spend),
      tiktok_impressions: Math.round(row.tiktok_impressions),
      tiktok_reach: Math.round(row.tiktok_reach),
      tiktok_clicks: Math.round(row.tiktok_clicks),
      tiktok_video_views: Math.round(row.tiktok_video_views),
      tiktok_video_views_2s: Math.round(row.tiktok_video_views_2s),
      tiktok_video_views_6s: Math.round(row.tiktok_video_views_6s),
      tiktok_video_views_100p: Math.round(row.tiktok_video_views_100p),
      tiktok_avg_play_time_ms:
        row.tiktok_avg_play_time_ms == null
          ? null
          : Math.round(row.tiktok_avg_play_time_ms),
      tiktok_post_engagement: Math.round(row.tiktok_post_engagement),
      tiktok_results: Math.round(row.tiktok_results),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
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

function nullableNumberMetric(
  value: string | number | null | undefined,
): number | null {
  if (value == null) return null;
  const n = numberMetric(value);
  return Number.isFinite(n) ? n : null;
}

function weightedAverage(
  currentAverage: number | null,
  currentWeight: number,
  nextAverage: number | null,
  nextWeight: number,
): number | null {
  if (nextAverage == null || nextWeight <= 0) return currentAverage;
  if (currentAverage == null || currentWeight <= 0) return nextAverage;
  return (
    (currentAverage * currentWeight + nextAverage * nextWeight) /
    (currentWeight + nextWeight)
  );
}

function buildDateWindows(
  since: string,
  until: string,
): Array<{ since: string; until: string }> {
  const windows: Array<{ since: string; until: string }> = [];
  let cursor = parseYmdUtc(since);
  const end = parseYmdUtc(until);

  while (cursor.getTime() <= end.getTime()) {
    const windowEnd = minDate(addDaysUtc(cursor, MAX_WINDOW_DAYS - 1), end);
    windows.push({ since: formatYmdUtc(cursor), until: formatYmdUtc(windowEnd) });
    cursor = addDaysUtc(windowEnd, 1);
  }

  return windows;
}

function parseYmdUtc(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid YYYY-MM-DD date: ${value}`);
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysUtc(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

function formatYmdUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
