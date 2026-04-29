import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../db/database.types.ts";
import type { TikTokAdRow } from "../types/tiktok.ts";
import { getTikTokCredentials } from "./credentials.ts";
import { tiktokGet, TIKTOK_CHUNK_CONCURRENCY } from "./client.ts";
import { campaignNameMatchesEventCode } from "./matching.ts";

type TikTokGet = typeof tiktokGet;

interface TikTokAdGetRow {
  ad_id?: string;
  ad_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  operation_status?: string;
  secondary_status?: string;
  thumbnail_url?: string;
  preview_url?: string;
  landing_page_url?: string;
  ad_text?: string;
}

interface TikTokAdGetResponse {
  list?: TikTokAdGetRow[];
  page_info?: {
    page?: number;
    total_page?: number;
  };
}

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

export interface FetchTikTokAdsForShareInput {
  supabase: SupabaseClient<Database>;
  tiktokAccountId: string | null;
  eventCode: string | null;
  since: string;
  until: string;
  /** Test hook only. Production callers use the encrypted account credentials. */
  credentials?: { access_token: string; advertiser_ids: string[] } | null;
  /** Test hook only. Production callers use the default TikTok HTTP client. */
  request?: TikTokGet;
}

export interface TikTokShareAdRow extends TikTokAdRow {
  ad_id: string;
  campaign_id: string | null;
  campaign_name: string | null;
  thumbnail_url: string | null;
  deeplink_url: string | null;
  ad_text: string | null;
}

const AD_FIELDS = [
  "ad_id",
  "ad_name",
  "campaign_id",
  "campaign_name",
  "operation_status",
  "secondary_status",
  "thumbnail_url",
  "preview_url",
  "landing_page_url",
  "ad_text",
];
const AD_METRICS = [
  "spend",
  "impressions",
  "reach",
  "clicks",
  "ctr",
  "cpm",
  "video_watched_2s",
  "video_watched_6s",
  "video_views_p100",
  "average_video_play",
];
const AD_DIMENSIONS = ["ad_id", "stat_time_day"];
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const MAX_WINDOW_DAYS = 30;

export const fetchTikTokAdsForShare = cache(fetchTikTokAdsForShareUncached);

export async function fetchTikTokAdsForShareUncached(
  input: FetchTikTokAdsForShareInput,
): Promise<TikTokShareAdRow[]> {
  if (TIKTOK_CHUNK_CONCURRENCY !== 1) {
    throw new Error("TikTok share-render chunks must run serially.");
  }
  if (!input.tiktokAccountId || !input.eventCode?.trim()) return [];

  const credentials =
    input.credentials ??
    (await getTikTokCredentials(input.supabase, input.tiktokAccountId));
  const advertiserId = credentials?.advertiser_ids[0];
  if (!credentials?.access_token || !advertiserId) return [];

  const request = input.request ?? tiktokGet;
  const ads = await fetchAllAds({
    advertiserId,
    token: credentials.access_token,
    request,
  });
  if (ads.size === 0) return [];

  const metricsByAd = await fetchAdMetrics({
    advertiserId,
    token: credentials.access_token,
    since: input.since,
    until: input.until,
    request,
  });
  const campaignNames = await fetchCampaignNames({
    advertiserId,
    token: credentials.access_token,
    campaignIds: [...new Set([...ads.values()].map((ad) => ad.campaignId))],
    request,
  });

  return [...ads.values()]
    .flatMap((ad): TikTokShareAdRow[] => {
      const campaignName =
        ad.campaignName ?? campaignNames.get(ad.campaignId) ?? null;
      if (
        !adMatchesEventCode({
          adName: ad.adName,
          campaignName,
          eventCode: input.eventCode ?? "",
        })
      ) {
        return [];
      }
      const metrics = metricsByAd.get(ad.adId) ?? emptyMetrics();
      return [
        {
          ad_id: ad.adId,
          campaign_id: ad.campaignId,
          campaign_name: campaignName,
          ad_name: ad.adName,
          primary_status: ad.status,
          secondary_status: ad.secondaryStatus,
          reach: metrics.reach,
          cost_per_1000_reached:
            metrics.reach != null && metrics.reach > 0
              ? (metrics.cost / metrics.reach) * 1000
              : null,
          frequency:
            metrics.reach != null && metrics.reach > 0
              ? metrics.impressions / metrics.reach
              : null,
          clicks_all: metrics.clicks,
          ctr_all: metrics.ctr,
          secondary_source: null,
          primary_source: null,
          attribution_source: null,
          currency: "GBP",
          post_url: ad.previewUrl ?? ad.landingPageUrl,
          thumbnail_url: ad.thumbnailUrl,
          deeplink_url: ad.previewUrl ?? ad.landingPageUrl,
          ad_text: ad.adText,
          cost: metrics.cost,
          impressions: metrics.impressions,
          impressions_raw: null,
          cpm: metrics.cpm,
          clicks_destination: metrics.clicks,
          cpc_destination:
            metrics.clicks > 0 ? metrics.cost / metrics.clicks : null,
          ctr_destination: metrics.ctr,
          video_views_2s: metrics.videoViews2s,
          video_views_6s: metrics.videoViews6s,
          video_views_p25: null,
          video_views_p50: null,
          video_views_p75: null,
          video_views_p100: metrics.videoViews100p,
          avg_play_time_per_user: metrics.avgPlayTime,
          avg_play_time_per_video_view: null,
          interactive_addon_impressions: null,
          interactive_addon_destination_clicks: null,
        },
      ];
    })
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
}

async function fetchAllAds(input: {
  advertiserId: string;
  token: string;
  request: TikTokGet;
}): Promise<Map<string, NormalizedAd>> {
  const out = new Map<string, NormalizedAd>();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await input.request<TikTokAdGetResponse>(
      "/ad/get/",
      {
        advertiser_id: input.advertiserId,
        fields: AD_FIELDS,
        page,
        page_size: PAGE_SIZE,
      },
      input.token,
    );
    for (const row of res.list ?? []) {
      if (!row.ad_id || !row.ad_name || !row.campaign_id) continue;
      out.set(row.ad_id, {
        adId: row.ad_id,
        adName: row.ad_name,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name ?? null,
        status: row.operation_status ?? "UNKNOWN",
        secondaryStatus: row.secondary_status ?? "UNKNOWN",
        thumbnailUrl: row.thumbnail_url ?? null,
        previewUrl: row.preview_url ?? null,
        landingPageUrl: row.landing_page_url ?? null,
        adText: row.ad_text ?? null,
      });
    }
    const pageInfo = res.page_info;
    if (!pageInfo?.total_page || page >= pageInfo.total_page) break;
  }
  return out;
}

async function fetchAdMetrics(input: {
  advertiserId: string;
  token: string;
  since: string;
  until: string;
  request: TikTokGet;
}): Promise<Map<string, AdMetrics>> {
  const out = new Map<string, AdMetrics>();
  for (const window of buildDateWindows(input.since, input.until)) {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const res = await input.request<TikTokIntegratedResponse>(
        "/report/integrated/get/",
        {
          advertiser_id: input.advertiserId,
          report_type: "BASIC",
          data_level: "AUCTION_AD",
          dimensions: AD_DIMENSIONS,
          metrics: AD_METRICS,
          start_date: window.since,
          end_date: window.until,
          page,
          page_size: PAGE_SIZE,
        },
        input.token,
      );
      for (const row of res.list ?? []) {
        const adId = row.dimensions?.ad_id;
        if (!adId) continue;
        const metrics = row.metrics ?? {};
        const existing = out.get(adId) ?? emptyMetrics();
        existing.cost += numberMetric(metrics.spend);
        existing.impressions += numberMetric(metrics.impressions);
        existing.reach = nullableSum(existing.reach, metrics.reach);
        existing.clicks += numberMetric(metrics.clicks);
        existing.videoViews2s += numberMetric(metrics.video_watched_2s);
        existing.videoViews6s += numberMetric(metrics.video_watched_6s);
        existing.videoViews100p += numberMetric(metrics.video_views_p100);
        existing.avgPlayTime = weightedAverage(
          existing.avgPlayTime,
          existing.impressions,
          numberMetric(metrics.average_video_play),
          numberMetric(metrics.impressions),
        );
        out.set(adId, existing);
      }
      const pageInfo = res.page_info;
      if (!pageInfo?.total_page || page >= pageInfo.total_page) break;
    }
  }

  for (const metrics of out.values()) {
    metrics.cost = round2(metrics.cost);
    metrics.impressions = Math.round(metrics.impressions);
    metrics.clicks = Math.round(metrics.clicks);
    metrics.videoViews2s = Math.round(metrics.videoViews2s);
    metrics.videoViews6s = Math.round(metrics.videoViews6s);
    metrics.videoViews100p = Math.round(metrics.videoViews100p);
    metrics.ctr =
      metrics.impressions > 0 ? (metrics.clicks / metrics.impressions) * 100 : null;
    metrics.cpm =
      metrics.impressions > 0 ? (metrics.cost / metrics.impressions) * 1000 : null;
  }
  return out;
}

async function fetchCampaignNames(input: {
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
  const out = new Map<string, string>();
  for (const row of res.list ?? []) {
    if (row.campaign_id && row.campaign_name) {
      out.set(row.campaign_id, row.campaign_name);
    }
  }
  return out;
}

function adMatchesEventCode(input: {
  adName: string;
  campaignName: string | null;
  eventCode: string;
}): boolean {
  if (campaignNameMatchesEventCode(input.adName, input.eventCode)) return true;
  if (!input.campaignName) return false;
  return campaignNameMatchesEventCode(input.campaignName, input.eventCode);
}

export function buildDateWindows(
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

interface NormalizedAd {
  adId: string;
  adName: string;
  campaignId: string;
  campaignName: string | null;
  status: string;
  secondaryStatus: string;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  landingPageUrl: string | null;
  adText: string | null;
}

interface AdMetrics {
  cost: number;
  impressions: number;
  reach: number | null;
  clicks: number;
  ctr: number | null;
  cpm: number | null;
  videoViews2s: number;
  videoViews6s: number;
  videoViews100p: number;
  avgPlayTime: number | null;
}

function emptyMetrics(): AdMetrics {
  return {
    cost: 0,
    impressions: 0,
    reach: null,
    clicks: 0,
    ctr: null,
    cpm: null,
    videoViews2s: 0,
    videoViews6s: 0,
    videoViews100p: 0,
    avgPlayTime: null,
  };
}

function nullableSum(
  current: number | null,
  value: string | number | null | undefined,
): number | null {
  if (value == null) return current;
  return (current ?? 0) + numberMetric(value);
}

function weightedAverage(
  currentAverage: number | null,
  currentWeight: number,
  nextAverage: number,
  nextWeight: number,
): number | null {
  if (nextWeight <= 0) return currentAverage;
  if (currentAverage == null || currentWeight <= 0) return nextAverage;
  return (
    (currentAverage * currentWeight + nextAverage * nextWeight) /
    (currentWeight + nextWeight)
  );
}

function numberMetric(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
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
