import type { SupabaseClient } from "@supabase/supabase-js";

import { extractVideoIdsFromCreative } from "./extract-video-ids-from-creative.ts";
import {
  batchFetchVideoMetadata as _batchFetchVideoMetadata,
  VIDEO_BATCH_SIZE,
  type RawVideoMetadata,
} from "./batch-fetch-video-metadata.ts";
import { withActPrefix, withoutActPrefix } from "../meta/ad-account-id.ts";
import {
  fetchBusinessIdForAccount,
  graphGetWithToken,
  type RawMetaCampaign,
} from "../meta/client.ts";
import type { Database } from "../db/database.types.ts";

type TypedSupabaseClient = SupabaseClient<Database>;

interface GraphPagedResponse<T> {
  data?: T[];
  paging?: { next?: string; cursors?: { after?: string } };
}

export interface AudienceSourceContext {
  clientId: string;
  clientName: string;
  metaAdAccountId: string;
}

export interface AudiencePageSource {
  id: string;
  name: string;
  slug?: string;
  thumbnailUrl?: string;
  instagramBusinessAccount?: {
    id: string;
    username?: string;
    name?: string;
    thumbnailUrl?: string;
  } | null;
}

export interface AudiencePixelSource {
  id: string;
  name: string;
  lastFiredTime?: string | null;
}

export interface AudienceCampaignSource {
  id: string;
  name: string;
  effectiveStatus?: string;
  createdTime?: string;
  spend: number;
  /** Impressions over the last 12 months; populated when spend is 0 so the UI can show
   *  activity signal for archived / brand campaigns that ran historically. */
  impressions?: number;
}

export interface AudienceVideoSource {
  id: string;
  title?: string;
  thumbnailUrl?: string;
  length?: number;
}

interface RawPage {
  id: string;
  name?: string;
  username?: string;
  link?: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: {
    id?: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
  } | null;
  connected_instagram_account?: {
    id?: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
  } | null;
}

interface RawPixel {
  id: string;
  name?: string;
  last_fired_time?: string | null;
}

interface RawAd {
  id: string;
  creative?: Record<string, unknown>;
}

/** Alias for the shared video-metadata shape from batch-fetch-video-metadata.ts. */
type RawVideo = RawVideoMetadata;

interface RawThumbnail {
  uri?: string;
}

export async function resolveAudienceSourceContext(
  supabase: TypedSupabaseClient,
  userId: string,
  clientId: string,
): Promise<AudienceSourceContext | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, meta_ad_account_id")
    .eq("id", clientId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const client = data as {
    id: string;
    name: string;
    meta_ad_account_id: string | null;
  } | null;
  if (!client) return null;
  if (!client.meta_ad_account_id) {
    throw new Error(
      "This client has no Meta ad account linked. Connect Meta in client settings first.",
    );
  }
  return {
    clientId: client.id,
    clientName: client.name,
    metaAdAccountId: client.meta_ad_account_id,
  };
}

export async function fetchAudiencePageSources(
  adAccountId: string,
  token: string,
): Promise<AudiencePageSource[]> {
  const fields = [
    "id",
    "name",
    "username",
    "link",
    "picture{url}",
    "instagram_business_account{id,username,name,profile_picture_url}",
    "connected_instagram_account{id,username,name,profile_picture_url}",
  ].join(",");

  const businessId = await fetchBusinessIdForAccount(adAccountId, token);
  const sources = await Promise.all([
    businessId
      ? graphGetWithToken<GraphPagedResponse<RawPage>>(
          `/${businessId}/owned_pages`,
          { fields, limit: "200" },
          token,
        ).catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
    businessId
      ? graphGetWithToken<GraphPagedResponse<RawPage>>(
          `/${businessId}/client_pages`,
          { fields, limit: "200" },
          token,
        ).catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
    graphGetWithToken<GraphPagedResponse<RawPage>>(
      "/me/accounts",
      { fields, limit: "200" },
      token,
    ).catch(() => ({ data: [] })),
  ]);

  const seen = new Map<string, AudiencePageSource>();
  for (const source of sources) {
    for (const page of source.data ?? []) {
      if (!page.id || seen.has(page.id)) continue;
      const ig =
        page.instagram_business_account?.id
          ? page.instagram_business_account
          : page.connected_instagram_account?.id
            ? page.connected_instagram_account
            : null;
      seen.set(page.id, {
        id: page.id,
        name: page.name ?? page.id,
        slug: page.username ?? slugFromLink(page.link),
        thumbnailUrl: page.picture?.data?.url,
        instagramBusinessAccount: ig?.id
          ? {
              id: ig.id,
              username: ig.username,
              name: ig.name,
              thumbnailUrl: ig.profile_picture_url,
            }
          : null,
      });
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchAudiencePixels(
  adAccountId: string,
  token: string,
): Promise<AudiencePixelSource[]> {
  const res = await graphGetWithToken<GraphPagedResponse<RawPixel>>(
    `/${withActPrefix(adAccountId)}/adspixels`,
    { fields: "id,name,last_fired_time", limit: "100" },
    token,
  );
  return (res.data ?? []).map((pixel) => ({
    id: pixel.id,
    name: pixel.name ?? pixel.id,
    lastFiredTime: pixel.last_fired_time ?? null,
  }));
}

export async function fetchAudienceCampaigns(
  adAccountId: string,
  token: string,
  limit: number,
): Promise<AudienceCampaignSource[]> {
  // Campaign-level insights: `lifetime` is not a valid date_preset in field expansion; `last_year` matches the 12-month spend label in the UI.
  const res = await graphGetWithToken<GraphPagedResponse<
    RawMetaCampaign & {
      insights?: { data?: Array<{ spend?: string; impressions?: string }> };
    }
  >>(
    `/${withActPrefix(adAccountId)}/campaigns`,
    {
      fields:
        "id,name,effective_status,created_time,insights.date_preset(last_year){spend,impressions}",
      limit: String(Math.min(Math.max(limit, 1), 200)),
    },
    token,
  );
  return (res.data ?? [])
    .map((campaign) => {
      const insightRow = campaign.insights?.data?.[0];
      return {
        id: campaign.id,
        name: campaign.name,
        effectiveStatus: campaign.effective_status,
        createdTime: campaign.created_time,
        spend: Number(insightRow?.spend ?? 0) || 0,
        impressions: Number(insightRow?.impressions ?? 0) || 0,
      };
    })
    .sort((a, b) => b.spend - a.spend || (b.impressions ?? 0) - (a.impressions ?? 0) || a.name.localeCompare(b.name));
}

// ─── Batched video-metadata helpers ──────────────────────────────────────────

// VIDEO_BATCH_SIZE is re-exported from batch-fetch-video-metadata.ts (imported above).
// Referenced here as a named const so downstream code and tests can grep for it.
void VIDEO_BATCH_SIZE; // re-exported via import

/**
 * Max concurrent thumbnail-fallback calls when picture is absent.
 * The batch metadata fetch is already sequential (ceil(N/25) serial calls),
 * so only the rare thumbnail fallbacks need their own concurrency cap.
 */
const THUMBNAIL_FALLBACK_CONCURRENCY = 3;

/** Minimal concurrency semaphore for the thumbnail-fallback fan-out. */
function makeSemaphore(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let running = 0;
  const queue: Array<() => void> = [];
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      function attempt() {
        if (running >= concurrency) {
          queue.push(attempt);
          return;
        }
        running++;
        fn().then(
          (v) => { running--; queue.shift()?.(); resolve(v); },
          (e) => { running--; queue.shift()?.(); reject(e as unknown); },
        );
      }
      attempt();
    });
  };
}

/**
 * Bound wrapper around `batchFetchVideoMetadata` from the utility module,
 * supplying `graphGetWithToken` as the fetcher. Cuts N per-video Graph
 * calls down to ceil(N/25) batched calls.
 */
async function batchFetchVideoMetadata(
  videoIds: readonly string[],
  token: string,
): Promise<Map<string, RawVideo>> {
  return _batchFetchVideoMetadata(
    videoIds,
    token,
    graphGetWithToken as (
      path: string,
      params: Record<string, string>,
      token: string,
    ) => Promise<Record<string, RawVideo>>,
  );
}

export async function fetchAudienceCampaignVideos(
  adAccountId: string,
  campaignId: string,
  token: string,
): Promise<{ campaignName: string; videos: AudienceVideoSource[]; contextPageId?: string; skippedCount: number }> {
  const campaign = await graphGetWithToken<{
    id: string;
    name?: string;
    account_id?: string;
  }>(`/${campaignId}`, { fields: "id,name,account_id" }, token);
  const expectedAccountId = withoutActPrefix(adAccountId);
  if (campaign.account_id && campaign.account_id !== expectedAccountId) {
    throw new Error("Campaign does not belong to this client's Meta ad account");
  }

  // Page size is 100 (down from 500): high-spend campaigns like Junction 2
  // Fragrance trip Meta's "reduce data" gate when we ask for 500 ads + nested
  // creative + asset_feed + platform_customizations in one shot. Page through
  // with `after` so large campaigns still collect every ad.
  const ADS_FIELDS =
    "id,creative{id,name,video_id,object_story_spec{video_data,page_id},asset_feed_spec,platform_customizations}";
  const ADS_PAGE_LIMIT = "100";
  const MAX_AD_PAGES = 50;

  const adsData: RawAd[] = [];
  let adsAfter: string | undefined;
  for (let adPage = 0; adPage < MAX_AD_PAGES; adPage++) {
    const params: Record<string, string> = {
      fields: ADS_FIELDS,
      limit: ADS_PAGE_LIMIT,
    };
    if (adsAfter) params.after = adsAfter;

    const adsPage = await graphGetWithToken<GraphPagedResponse<RawAd>>(
      `/${campaignId}/ads`,
      params,
      token,
    );
    const chunk = adsPage.data ?? [];
    adsData.push(...chunk);
    adsAfter = adsPage.paging?.cursors?.after;
    if (!adsAfter || chunk.length === 0) break;
  }

  // Collect page_id from each ad's creative.
  // Meta exposes the publishing page in multiple creative shapes:
  //   - Standard ads: creative.object_story_spec.page_id
  //   - Advantage+ / dynamic ads: creative.platform_customizations.{facebook,instagram}.page_id
  //   - Asset feed creatives: creative.asset_feed_spec.page_ids[0]
  // We collect from all shapes so contextPageId resolves for any campaign type.
  const pageCounts = new Map<string, number>();
  const videoIds = new Set<string>();
  for (const ad of adsData) {
    for (const id of extractVideoIdsFromCreative(ad.creative)) {
      videoIds.add(id);
    }
    const creative = ad.creative as Record<string, unknown> | undefined;
    if (!creative) continue;

    // Standard creative shape
    const spec = creative.object_story_spec as Record<string, unknown> | undefined;
    const standardPageId = spec?.page_id;
    if (typeof standardPageId === "string" && standardPageId) {
      pageCounts.set(standardPageId, (pageCounts.get(standardPageId) ?? 0) + 1);
    }

    // Advantage+ / dynamic creatives
    const platforms = creative.platform_customizations as
      | Record<string, { page_id?: unknown }>
      | undefined;
    for (const platform of ["facebook", "instagram"] as const) {
      const platformPageId = platforms?.[platform]?.page_id;
      if (typeof platformPageId === "string" && platformPageId) {
        pageCounts.set(platformPageId, (pageCounts.get(platformPageId) ?? 0) + 1);
      }
    }

    // Asset feed creatives (multi-creative ads)
    const assetFeed = creative.asset_feed_spec as
      | { page_ids?: unknown }
      | undefined;
    if (Array.isArray(assetFeed?.page_ids)) {
      for (const id of assetFeed.page_ids) {
        if (typeof id === "string" && id) {
          pageCounts.set(id, (pageCounts.get(id) ?? 0) + 1);
        }
      }
    }
  }

  // Fallback: if no page_id surfaced from any creative shape, use the first
  // resolvable video's `from.id` (we already query that field below). For now,
  // this is set after the video walk completes — handled in the return shape.
  let contextPageId = [...pageCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  // Collect video page IDs from the video walk too — used as a fallback for
  // contextPageId when creative-level extraction returns nothing (e.g. Asset
  // feed creatives with no top-level page_ids).
  const videoFromPageCounts = new Map<string, number>();

  // BATCHED FETCH: replace per-video Graph calls with Meta's `GET /?ids=...`
  // batched endpoint (max 25 IDs per call). Cuts ~50 serial calls down to
  // ceil(50/25)=2 calls. Thumbnail fallbacks (rare) are bounded at 3-concurrent.
  const videoIdList = Array.from(videoIds);
  const videoMap = await batchFetchVideoMetadata(videoIdList, token);
  const thumbnailSem = makeSemaphore(THUMBNAIL_FALLBACK_CONCURRENCY);

  const videoResults: Array<AudienceVideoSource | null> = await Promise.all(
    videoIdList.map(async (videoId) => {
      const video = videoMap.get(videoId) ?? ({ id: videoId } as RawVideo);

      // Meta requires every video in a video-views audience to be published from
      // a FB Page (not uploaded directly to the ad account). Videos with no
      // `from.id` trigger #2654 subcode 1713216 "No Page or New Page Experience
      // Association". Return null so we can filter them out below.
      if (!video.from?.id) {
        return null;
      }

      // Track which page each surviving video was published from — used as
      // contextPageId fallback below.
      videoFromPageCounts.set(
        video.from.id,
        (videoFromPageCounts.get(video.from.id) ?? 0) + 1,
      );

      let thumbnailUrl: string | undefined = video.picture ?? undefined;

      // Fallback: try /{id}/thumbnails when picture is absent (common for
      // archived / age-out videos where Meta strips the stored asset).
      // Rate-limited to THUMBNAIL_FALLBACK_CONCURRENCY=3 concurrent calls.
      if (!thumbnailUrl) {
        thumbnailUrl = await thumbnailSem(() =>
          graphGetWithToken<{ data?: RawThumbnail[] }>(
            `/${videoId}/thumbnails`,
            { limit: "1" },
            token,
          )
            .then((r) => r.data?.[0]?.uri ?? undefined)
            .catch(() => undefined),
        );
      }

      return {
        id: video.id,
        title: video.title,
        thumbnailUrl,
        length: video.length,
      };
    }),
  );

  const validVideos = videoResults.filter(
    (v): v is NonNullable<typeof v> => v !== null,
  );
  const skippedCount = videoResults.length - validVideos.length;

  // Fallback: if creative-level extraction yielded no contextPageId (common
  // for asset_feed_spec creatives in Bristol/regional WC26 campaigns), use
  // the most-common `from.id` across the surviving videos themselves.
  if (!contextPageId && videoFromPageCounts.size > 0) {
    contextPageId = [...videoFromPageCounts.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0];
  }

  if (skippedCount > 0) {
    console.warn(
      `[fetchAudienceCampaignVideos] Dropped ${skippedCount} video(s) with no Page association` +
        ` (campaign ${campaignId}). Meta requires videos to be published from a FB Page.`,
    );
  }

  return {
    campaignName: campaign.name ?? campaignId,
    videos: validVideos.sort((a, b) => a.id.localeCompare(b.id)),
    contextPageId,
    skippedCount,
  };
}

export interface AudienceMultiCampaignVideosResult {
  videos: AudienceVideoSource[];
  contextPageId?: string;
  skippedCount: number;
  /** Distinct video IDs seen across all campaigns before the orphan filter. */
  uniqueVideoCount: number;
  /** Number of campaigns walked. */
  campaignCount: number;
}

/**
 * Fetch and dedup videos across multiple campaigns in one server pass.
 *
 * Problem: the per-campaign endpoint walks `/campaignId/ads` + fetches
 * per-video metadata independently for every campaign. When campaigns share
 * videos (Meta's "include views from related ads"), the same 18 videos can
 * be fetched up to 7 times, blowing through Vercel's function timeout on
 * high-spend ad accounts like Junction 2 Fragrance.
 *
 * Fix:
 *   1. Walk each campaign's ads sequentially (avoids hammering `/ads`
 *      with parallel page streams on the same account).
 *   2. Accumulate a SINGLE Set of unique video IDs across all campaigns.
 *   3. Fetch video metadata exactly once per unique video (chunked, 5-
 *      concurrent — same rate-safe pattern as the single-campaign path).
 *   4. Apply the Page-association filter and resolve contextPageId from
 *      all creative shapes exactly as the single-campaign path does.
 */
export async function fetchAudienceMultiCampaignVideos(
  adAccountId: string,
  campaignIds: string[],
  token: string,
): Promise<AudienceMultiCampaignVideosResult> {
  if (campaignIds.length === 0) {
    return {
      videos: [],
      contextPageId: undefined,
      skippedCount: 0,
      uniqueVideoCount: 0,
      campaignCount: 0,
    };
  }

  const expectedAccountId = withoutActPrefix(adAccountId);
  const ADS_FIELDS =
    "id,creative{id,name,video_id,object_story_spec{video_data,page_id},asset_feed_spec,platform_customizations}";
  const ADS_PAGE_LIMIT = "100";
  const MAX_AD_PAGES = 50;

  const allVideoIds = new Set<string>();
  const pageCounts = new Map<string, number>();

  // Walk each campaign sequentially to avoid parallel page-stream rate pressure.
  for (const campaignId of campaignIds) {
    // Ownership check: validate campaign belongs to this ad account.
    const campaign = await graphGetWithToken<{
      id: string;
      account_id?: string;
    }>(`/${campaignId}`, { fields: "id,account_id" }, token).catch(
      () => null,
    );
    if (
      campaign?.account_id &&
      campaign.account_id !== expectedAccountId
    ) {
      throw new Error(
        `Campaign ${campaignId} does not belong to this client's Meta ad account`,
      );
    }

    // Paginated ad walk — same shape as fetchAudienceCampaignVideos.
    let adsAfter: string | undefined;
    for (let adPage = 0; adPage < MAX_AD_PAGES; adPage++) {
      const params: Record<string, string> = {
        fields: ADS_FIELDS,
        limit: ADS_PAGE_LIMIT,
      };
      if (adsAfter) params.after = adsAfter;

      const adsPage = await graphGetWithToken<GraphPagedResponse<RawAd>>(
        `/${campaignId}/ads`,
        params,
        token,
      );
      const chunk = adsPage.data ?? [];

      for (const ad of chunk) {
        for (const id of extractVideoIdsFromCreative(ad.creative)) {
          allVideoIds.add(id);
        }
        const creative = ad.creative as Record<string, unknown> | undefined;
        if (!creative) continue;

        const spec = creative.object_story_spec as
          | Record<string, unknown>
          | undefined;
        const standardPageId = spec?.page_id;
        if (typeof standardPageId === "string" && standardPageId) {
          pageCounts.set(
            standardPageId,
            (pageCounts.get(standardPageId) ?? 0) + 1,
          );
        }

        const platforms = creative.platform_customizations as
          | Record<string, { page_id?: unknown }>
          | undefined;
        for (const platform of ["facebook", "instagram"] as const) {
          const platformPageId = platforms?.[platform]?.page_id;
          if (typeof platformPageId === "string" && platformPageId) {
            pageCounts.set(
              platformPageId,
              (pageCounts.get(platformPageId) ?? 0) + 1,
            );
          }
        }

        const assetFeed = creative.asset_feed_spec as
          | { page_ids?: unknown }
          | undefined;
        if (Array.isArray(assetFeed?.page_ids)) {
          for (const id of assetFeed.page_ids) {
            if (typeof id === "string" && id) {
              pageCounts.set(id, (pageCounts.get(id) ?? 0) + 1);
            }
          }
        }
      }

      adsAfter = adsPage.paging?.cursors?.after;
      if (!adsAfter || chunk.length === 0) break;
    }
  }

  const uniqueVideoCount = allVideoIds.size;

  // contextPageId: most-common page from creative-level extraction.
  let contextPageId = [...pageCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0];

  const videoFromPageCounts = new Map<string, number>();
  const videoIdList = Array.from(allVideoIds);
  const videoMap = await batchFetchVideoMetadata(videoIdList, token);
  const thumbnailSem = makeSemaphore(THUMBNAIL_FALLBACK_CONCURRENCY);

  const videoResults: Array<AudienceVideoSource | null> = await Promise.all(
    videoIdList.map(async (videoId) => {
      const video = videoMap.get(videoId) ?? ({ id: videoId } as RawVideo);

      if (!video.from?.id) return null;

      videoFromPageCounts.set(
        video.from.id,
        (videoFromPageCounts.get(video.from.id) ?? 0) + 1,
      );

      let thumbnailUrl: string | undefined = video.picture ?? undefined;
      if (!thumbnailUrl) {
        thumbnailUrl = await thumbnailSem(() =>
          graphGetWithToken<{ data?: RawThumbnail[] }>(
            `/${videoId}/thumbnails`,
            { limit: "1" },
            token,
          )
            .then((r) => r.data?.[0]?.uri ?? undefined)
            .catch(() => undefined),
        );
      }

      return {
        id: video.id,
        title: video.title,
        thumbnailUrl,
        length: video.length,
      };
    }),
  );

  const validVideos = videoResults.filter(
    (v): v is NonNullable<typeof v> => v !== null,
  );
  const skippedCount = videoResults.length - validVideos.length;

  if (!contextPageId && videoFromPageCounts.size > 0) {
    contextPageId = [...videoFromPageCounts.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0];
  }

  if (skippedCount > 0) {
    console.warn(
      `[fetchAudienceMultiCampaignVideos] Dropped ${skippedCount} video(s) with no Page association` +
        ` (${campaignIds.length} campaigns). Meta requires videos to be published from a FB Page.`,
    );
  }

  return {
    videos: validVideos.sort((a, b) => a.id.localeCompare(b.id)),
    contextPageId,
    skippedCount,
    uniqueVideoCount,
    campaignCount: campaignIds.length,
  };
}

function slugFromLink(link?: string): string | undefined {
  if (!link) return undefined;
  try {
    const url = new URL(link);
    return url.pathname.split("/").filter(Boolean)[0];
  } catch {
    return undefined;
  }
}
