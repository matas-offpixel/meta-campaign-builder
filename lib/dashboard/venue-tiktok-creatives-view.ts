/**
 * lib/dashboard/venue-tiktok-creatives-view.ts
 *
 * Pure view model for the TikTok half of the venue "Top creatives"
 * section (`components/share/venue-active-creatives.tsx`). Shared by the
 * server loader (`venue-tiktok-creatives.ts`) and the client component,
 * so it carries no Supabase or React imports.
 */

import type { TikTokCreativeGroup } from "../reporting/group-tiktok-creatives.ts";
import type { PlatformId } from "./platform-colors.ts";

/**
 * One TikTok concept card. Only metrics the snapshot stores: there is no
 * conversion column on `tiktok_active_creatives_snapshots`, so no
 * conversion or cost-per-conversion field. `null` renders blank.
 */
export interface VenueTikTokCreativeCard {
  group_key: string;
  display_name: string;
  ad_count: number;
  campaign_count: number;
  spend: number;
  impressions: number;
  clicks: number;
  cpc: number | null;
  /** TikTok `video_watched_2s`, summed. Null when no ad in the group has it. */
  video_views_2s: number | null;
  thumbnail_url: string | null;
  deeplink_url: string | null;
}

export interface VenueTikTokEventGroup {
  event_id: string;
  event_name: string;
  window: { since: string; until: string };
  fetched_at: string;
  cards: VenueTikTokCreativeCard[];
}

export function tiktokCardFromGroup(
  group: TikTokCreativeGroup,
  now: Date,
): VenueTikTokCreativeCard {
  return {
    group_key: group.group_key,
    display_name: group.display_name,
    ad_count: group.ad_count,
    campaign_count: group.campaign_count,
    spend: group.spend,
    impressions: group.impressions,
    clicks: group.clicks,
    cpc: group.clicks > 0 ? group.spend / group.clicks : null,
    video_views_2s: group.video_views_2s,
    thumbnail_url: liveTikTokThumbnailUrl(group.thumbnail_url, now),
    deeplink_url: group.deeplink_url,
  };
}

/**
 * TikTok CDN thumbnails are signed (`x-expires=<unix seconds>`, about six
 * hours after the cron fetch). An expired URL is dropped so the card shows
 * its placeholder instead of requesting a 403.
 */
export function liveTikTokThumbnailUrl(
  url: string | null,
  now: Date,
): string | null {
  if (!url) return null;
  const match = /[?&]x-expires=(\d+)/i.exec(url);
  if (match && Number(match[1]) * 1000 <= now.getTime()) return null;
  return url;
}

export interface VenueCreativesLayout {
  fetchMeta: boolean;
  fetchTikTok: boolean;
  showMeta: boolean;
  showTikTok: boolean;
  /** Label the Meta and TikTok groups, Meta first. Only when both render. */
  labelPlatformGroups: boolean;
  /** Platform that still gets the "not yet wired" card. */
  notWired: PlatformId | null;
}

export function venueCreativesLayout(
  platform: PlatformId,
  tiktokGroupCount: number,
): VenueCreativesLayout {
  const hasTikTok = tiktokGroupCount > 0;
  switch (platform) {
    case "all":
      return {
        fetchMeta: true,
        fetchTikTok: true,
        showMeta: true,
        showTikTok: hasTikTok,
        labelPlatformGroups: hasTikTok,
        notWired: null,
      };
    case "meta":
      return {
        fetchMeta: true,
        fetchTikTok: false,
        showMeta: true,
        showTikTok: false,
        labelPlatformGroups: false,
        notWired: null,
      };
    case "tiktok":
      return {
        fetchMeta: false,
        fetchTikTok: true,
        showMeta: false,
        showTikTok: hasTikTok,
        labelPlatformGroups: false,
        notWired: null,
      };
    default:
      return {
        fetchMeta: false,
        fetchTikTok: false,
        showMeta: false,
        showTikTok: false,
        labelPlatformGroups: false,
        notWired: platform,
      };
  }
}
