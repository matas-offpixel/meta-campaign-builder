import type { SupabaseClient } from "@supabase/supabase-js";

import { extractVideoIdsFromCreative } from "./extract-video-ids-from-creative.ts";
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

interface RawVideo {
  id: string;
  title?: string;
  picture?: string;
  length?: number;
  /** Present when the video was published from a FB Page (not uploaded directly to the ad account). */
  from?: { id?: string; name?: string };
}

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

  const ads = await graphGetWithToken<GraphPagedResponse<RawAd>>(
    `/${campaignId}/ads`,
    {
      fields:
        "id,creative{id,name,video_id,object_story_spec{video_data,page_id},asset_feed_spec,platform_customizations}",
      limit: "500",
    },
    token,
  );

  // Collect page_id from each ad's creative.
  // Meta exposes the publishing page in multiple creative shapes:
  //   - Standard ads: creative.object_story_spec.page_id
  //   - Advantage+ / dynamic ads: creative.platform_customizations.{facebook,instagram}.page_id
  //   - Asset feed creatives: creative.asset_feed_spec.page_ids[0]
  // We collect from all shapes so contextPageId resolves for any campaign type.
  const pageCounts = new Map<string, number>();
  const videoIds = new Set<string>();
  for (const ad of ads.data ?? []) {
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

  const videos = await Promise.all(
    Array.from(videoIds).map(async (videoId) => {
      const video = await graphGetWithToken<RawVideo>(
        `/${videoId}`,
        { fields: "id,picture,title,length,from" },
        token,
      ).catch(() => ({ id: videoId } as RawVideo));

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
      if (!thumbnailUrl) {
        thumbnailUrl = await graphGetWithToken<{ data?: RawThumbnail[] }>(
          `/${videoId}/thumbnails`,
          { limit: "1" },
          token,
        )
          .then((r) => r.data?.[0]?.uri ?? undefined)
          .catch(() => undefined);
      }

      return {
        id: video.id,
        title: video.title,
        thumbnailUrl,
        length: video.length,
      };
    }),
  );

  const validVideos = videos.filter(
    (v): v is NonNullable<typeof v> => v !== null,
  );
  const skippedCount = videos.length - validVideos.length;

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

function slugFromLink(link?: string): string | undefined {
  if (!link) return undefined;
  try {
    const url = new URL(link);
    return url.pathname.split("/").filter(Boolean)[0];
  } catch {
    return undefined;
  }
}
