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
  const res = await graphGetWithToken<GraphPagedResponse<
    RawMetaCampaign & {
      insights?: { data?: Array<{ spend?: string }> };
    }
  >>(
    `/${withActPrefix(adAccountId)}/campaigns`,
    {
      fields:
        "id,name,effective_status,created_time,insights.date_preset(lifetime){spend}",
      limit: String(Math.min(Math.max(limit, 1), 50)),
    },
    token,
  );
  return (res.data ?? [])
    .map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      effectiveStatus: campaign.effective_status,
      createdTime: campaign.created_time,
      spend: Number(campaign.insights?.data?.[0]?.spend ?? 0) || 0,
    }))
    .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
}

export async function fetchAudienceCampaignVideos(
  adAccountId: string,
  campaignId: string,
  token: string,
): Promise<{ campaignName: string; videos: AudienceVideoSource[] }> {
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
        "id,creative{id,name,video_id,object_story_spec{video_data},asset_feed_spec,platform_customizations}",
      limit: "500",
    },
    token,
  );

  const videoIds = new Set<string>();
  for (const ad of ads.data ?? []) {
    for (const id of extractVideoIdsFromCreative(ad.creative)) {
      videoIds.add(id);
    }
  }

  const videos = await Promise.all(
    Array.from(videoIds).map(async (videoId) => {
      const video = await graphGetWithToken<RawVideo>(
        `/${videoId}`,
        { fields: "id,picture,title,length" },
        token,
      ).catch(() => ({ id: videoId } as RawVideo));
      return {
        id: video.id,
        title: video.title,
        thumbnailUrl: video.picture,
        length: video.length,
      };
    }),
  );

  return {
    campaignName: campaign.name ?? campaignId,
    videos: videos.sort((a, b) => a.id.localeCompare(b.id)),
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
