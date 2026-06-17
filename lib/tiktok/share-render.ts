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
  video_id?: string;
  image_ids?: string[];
  landing_page_url?: string;
  ad_text?: string;
  tiktok_item_id?: string;
  identity_id?: string;
  identity_type?: string;
}

interface TikTokVideoInfoRow {
  video_id?: string;
  video_cover_url?: string;
  preview_url?: string;
}

interface TikTokVideoInfoResponse {
  list?: TikTokVideoInfoRow[];
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
  /** Persisted for thumbnail re-resolution on cache hits. */
  video_id?: string | null;
  image_ids?: string[] | null;
  tiktok_item_id?: string | null;
  identity_id?: string | null;
  identity_type?: string | null;
}

const AD_FIELDS = [
  "ad_id",
  "ad_name",
  "campaign_id",
  "campaign_name",
  "operation_status",
  "secondary_status",
  // NOTE: `thumbnail_url` / `preview_url` are NOT valid /ad/get/ fields and
  // cause the entire call to 400. Thumbnails + previews are resolved from
  // the creative's `video_id` via /file/video/ad/info/ instead.
  "video_id",
  "image_ids",
  "landing_page_url",
  "ad_text",
  // Spark Ad creative identifiers — needed for /spark_ads/posts/get/ thumbnail lookup.
  "tiktok_item_id",
  "identity_id",
  "identity_type",
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

  const credentialsFromInput = input.credentials != null;
  const credentials =
    credentialsFromInput
      ? input.credentials
      : (await getTikTokCredentials(input.supabase, input.tiktokAccountId));

  // When credentials are provided directly (test hook) use advertiser_ids[0].
  // In production — credentials fetched from DB — prefer the explicitly-stored
  // tiktok_accounts.tiktok_advertiser_id over advertiser_ids[0], which is just
  // the first entry across ALL accounts the OAuth token has access to.
  const advertiserId = credentialsFromInput
    ? credentials?.advertiser_ids[0]
    : await resolveAdvertiserIdForAccount(
        input.supabase,
        input.tiktokAccountId,
        credentials,
      );
  if (!credentials?.access_token || !advertiserId) return [];

  const request = input.request ?? tiktokGet;
  const ads = await fetchAllAds({
    advertiserId,
    token: credentials.access_token,
    request,
  });
  if (ads.size === 0) return [];

  // Resolve thumbnails + previews from the creative's video (best-effort —
  // /ad/get/ does not expose thumbnail_url/preview_url). Ads without a
  // video_id fall back to their landing page for the deeplink.
  const videoIds = [
    ...new Set(
      [...ads.values()]
        .map((ad) => ad.videoId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const videoInfo = await fetchVideoInfo({
    advertiserId,
    token: credentials.access_token,
    videoIds,
    request,
  });
  for (const ad of ads.values()) {
    const info = ad.videoId ? videoInfo.get(ad.videoId) : undefined;
    if (info) {
      ad.thumbnailUrl = info.cover ?? ad.thumbnailUrl;
      ad.previewUrl = info.preview ?? ad.previewUrl;
    }
  }

  // Fallback: for ads that still lack a thumbnail but carry image_ids
  // (image-only or hybrid ad formats), resolve via /file/image/ad/info/.
  const imageIdsNeeded = [
    ...new Set(
      [...ads.values()]
        .filter((ad) => !ad.thumbnailUrl && ad.imageIds?.length)
        .flatMap((ad) => ad.imageIds ?? []),
    ),
  ];
  if (imageIdsNeeded.length > 0) {
    const imageInfo = await fetchImageInfo({
      advertiserId,
      token: credentials.access_token,
      imageIds: imageIdsNeeded,
      request,
    });
    for (const ad of ads.values()) {
      if (!ad.thumbnailUrl && ad.imageIds?.length) {
        for (const imageId of ad.imageIds) {
          const url = imageInfo.get(imageId);
          if (url) {
            ad.thumbnailUrl = url;
            break;
          }
        }
      }
    }
  }

  // Fallback: Spark Ads reference organic TikTok posts via tiktok_item_id.
  // These cannot be resolved via /file/video/ad/info/ or /file/image/ad/info/.
  // TikTok's Marketing API has no accessible endpoint for this; use the public
  // OEmbed endpoint which needs only the item_id and no auth.
  const sparkItemIds = [
    ...new Set(
      [...ads.values()]
        .filter((ad) => !ad.thumbnailUrl && Boolean(ad.tiktokItemId))
        .map((ad) => ad.tiktokItemId as string),
    ),
  ];
  if (sparkItemIds.length > 0) {
    const sparkInfo = await fetchSparkAdInfo(sparkItemIds);
    for (const ad of ads.values()) {
      if (ad.tiktokItemId) {
        const info = sparkInfo.get(ad.tiktokItemId);
        if (info) {
          if (!ad.thumbnailUrl && info.thumbnail) ad.thumbnailUrl = info.thumbnail;
          // Build canonical public URL from author_url + /video/{itemId}.
          // author_url = "https://www.tiktok.com/@username" — appending the
          // video path gives the correct shareable link with @username prefix.
          if (info.authorUrl) {
            ad.canonicalPostUrl = `${info.authorUrl}/video/${ad.tiktokItemId}`;
          }
        }
      }
    }
  }

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
          post_url: ad.previewUrl ?? ad.landingPageUrl ?? ad.canonicalPostUrl ?? (ad.tiktokItemId ? `https://www.tiktok.com/video/${ad.tiktokItemId}` : null),
          thumbnail_url: ad.thumbnailUrl,
          deeplink_url: ad.previewUrl ?? ad.landingPageUrl ?? ad.canonicalPostUrl ?? (ad.tiktokItemId ? `https://www.tiktok.com/video/${ad.tiktokItemId}` : null),
          ad_text: ad.adText,
          video_id: ad.videoId,
          image_ids: ad.imageIds,
          tiktok_item_id: ad.tiktokItemId,
          identity_id: ad.identityId,
          identity_type: ad.identityType,
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
        videoId: row.video_id ?? null,
        imageIds: row.image_ids?.length ? row.image_ids : null,
        tiktokItemId: row.tiktok_item_id ?? null,
        identityId: row.identity_id ?? null,
        identityType: row.identity_type ?? null,
        thumbnailUrl: null,
        previewUrl: null,
        landingPageUrl: row.landing_page_url ?? null,
        adText: row.ad_text ?? null,
        canonicalPostUrl: null,
      });
    }
    const pageInfo = res.page_info;
    if (!pageInfo?.total_page || page >= pageInfo.total_page) break;
  }
  return out;
}

async function fetchVideoInfo(input: {
  advertiserId: string;
  token: string;
  videoIds: string[];
  request: TikTokGet;
}): Promise<Map<string, { cover: string | null; preview: string | null }>> {
  const out = new Map<string, { cover: string | null; preview: string | null }>();
  if (input.videoIds.length === 0) return out;
  // /file/video/ad/info/ caps video_ids per call; chunk defensively. Failures
  // are non-fatal — thumbnails are cosmetic and must never block the snapshot.
  const CHUNK = 60;
  for (let i = 0; i < input.videoIds.length; i += CHUNK) {
    const chunk = input.videoIds.slice(i, i + CHUNK);
    try {
      const res = await input.request<TikTokVideoInfoResponse>(
        "/file/video/ad/info/",
        { advertiser_id: input.advertiserId, video_ids: chunk },
        input.token,
      );
      for (const row of res.list ?? []) {
        if (!row.video_id) continue;
        out.set(row.video_id, {
          cover: row.video_cover_url ?? null,
          preview: row.preview_url ?? null,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[tiktok-active-creatives] video info skipped: ${message}`);
    }
  }
  return out;
}

async function fetchImageInfo(input: {
  advertiserId: string;
  token: string;
  imageIds: string[];
  request: TikTokGet;
}): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (input.imageIds.length === 0) return out;
  const CHUNK = 60;
  for (let i = 0; i < input.imageIds.length; i += CHUNK) {
    const chunk = input.imageIds.slice(i, i + CHUNK);
    try {
      const res = await input.request<{
        list?: Array<{ image_id?: string; image_url?: string }>;
      }>(
        "/file/image/ad/info/",
        { advertiser_id: input.advertiserId, image_ids: chunk },
        input.token,
      );
      for (const row of res.list ?? []) {
        if (!row.image_id || !row.image_url) continue;
        out.set(row.image_id, row.image_url);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[tiktok-share-render] image info skipped: ${message}`);
    }
  }
  return out;
}

/** Resolve thumbnails and canonical author URLs for Spark Ads via TikTok's public OEmbed endpoint.
 *  Spark Ads reference an organic TikTok post (tiktok_item_id).  TikTok's
 *  Marketing API has no accessible endpoint for fetching organic post info;
 *  the public OEmbed endpoint (https://www.tiktok.com/oembed) works instead,
 *  requires no authentication, and returns thumbnail_url + author_url.
 *  Returns Map<tiktok_item_id, { thumbnail, authorUrl }>. */
async function fetchSparkAdInfo(itemIds: string[]): Promise<Map<string, { thumbnail?: string; authorUrl?: string }>> {
  const out = new Map<string, { thumbnail?: string; authorUrl?: string }>();
  if (itemIds.length === 0) return out;

  // console.error — Vercel reliably surfaces error-level logs; console.log/warn
  // can be filtered under load (observed in PR #514).
  console.error(`[spark-oembed] start: ${itemIds.length} items to resolve`, itemIds);

  for (const itemId of itemIds) {
    try {
      const url = `https://www.tiktok.com/oembed?url=${encodeURIComponent(`https://www.tiktok.com/video/${itemId}`)}`;
      const res = await fetch(url, {
        cache: "no-store",
        headers: {
          // TikTok's OEmbed endpoint blocks requests with the bare Node.js
          // fetch User-Agent (or no UA). Supply a browser UA to match the
          // behaviour of local curl / browser testing where OEmbed works.
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
      });
      const bodyText = await res.text();
      if (!res.ok) {
        console.error(
          `[spark-oembed] non-OK ${res.status} item=${itemId} body=${bodyText.slice(0, 200)}`,
        );
        continue;
      }
      let json: { thumbnail_url?: string; author_url?: string };
      try {
        json = JSON.parse(bodyText) as { thumbnail_url?: string; author_url?: string };
      } catch {
        console.error(
          `[spark-oembed] non-JSON item=${itemId} body=${bodyText.slice(0, 200)}`,
        );
        continue;
      }
      const entry: { thumbnail?: string; authorUrl?: string } = {};
      if (json.thumbnail_url) entry.thumbnail = json.thumbnail_url;
      if (json.author_url) entry.authorUrl = json.author_url;
      if (entry.thumbnail || entry.authorUrl) {
        out.set(itemId, entry);
        console.error(`[spark-oembed] resolved item=${itemId} thumbnail=${!!entry.thumbnail} authorUrl=${!!entry.authorUrl}`);
      } else {
        console.error(
          `[spark-oembed] no thumbnail_url/author_url item=${itemId} body=${bodyText.slice(0, 200)}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[spark-oembed] threw item=${itemId} message=${message}`);
    }
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
  videoId: string | null;
  imageIds: string[] | null;
  tiktokItemId: string | null;
  identityId: string | null;
  identityType: string | null;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  landingPageUrl: string | null;
  adText: string | null;
  /** Canonical public URL for Spark Ads, built from OEmbed author_url + /video/{itemId}. */
  canonicalPostUrl: string | null;
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

/**
 * Look up the primary TikTok advertiser ID for this account row.
 *
 * The OAuth token's `advertiser_ids` array lists every account the token has
 * been granted access to. Index 0 is NOT the account we configured —
 * `tiktok_accounts.tiktok_advertiser_id` is the explicitly-stored primary
 * advertiser. Fall back to `advertiser_ids[0]` only when the row is missing.
 *
 * Exported for unit testing.
 */
export async function resolveAdvertiserIdForAccount(
  supabase: SupabaseClient<Database>,
  tiktokAccountId: string | null,
  credentials: { access_token: string; advertiser_ids: string[] } | null | undefined,
): Promise<string | null> {
  if (tiktokAccountId) {
    const { data } = await supabase
      .from("tiktok_accounts")
      .select("tiktok_advertiser_id")
      .eq("id", tiktokAccountId)
      .maybeSingle();
    const storedId = (data as { tiktok_advertiser_id: string | null } | null)
      ?.tiktok_advertiser_id;
    if (storedId) return storedId;
  }
  return credentials?.advertiser_ids[0] ?? null;
}
