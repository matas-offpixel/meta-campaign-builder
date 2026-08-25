import type { LiveCampaignDestination } from "./off-funnel-audit.ts";

/**
 * Flatten cached snapshot payloads into live destination rows.
 * No platform I/O — callers pass already-loaded snapshot JSON.
 *
 * Structural slice of ShareActiveCreativesResult so this module
 * stays importable from node:test (share-active-creatives is
 * server-only).
 */

export interface MetaSnapshotPayloadSlice {
  kind: string;
  groups?: ReadonlyArray<{
    spend?: number;
    any_ad_active?: boolean;
    campaigns?: ReadonlyArray<{ id: string; name: string | null }>;
    representative_preview?: { link_url?: string | null };
  }>;
}

export function liveDestinationsFromMetaSnapshot(
  payload: MetaSnapshotPayloadSlice | null | undefined,
  event: { eventId: string; eventName: string },
): LiveCampaignDestination[] {
  if (!payload || payload.kind !== "ok") return [];
  const out: LiveCampaignDestination[] = [];
  for (const group of payload.groups ?? []) {
    const dest = group.representative_preview?.link_url ?? null;
    const campaigns = group.campaigns ?? [];
    if (campaigns.length === 0) continue;
    const spendShare = (group.spend ?? 0) / campaigns.length;
    const active = group.any_ad_active === true;
    for (const campaign of campaigns) {
      if (!campaign.id) continue;
      out.push({
        campaignId: campaign.id,
        campaignName: campaign.name?.trim() || campaign.id,
        platform: "meta",
        destinationUrl: dest,
        spend: spendShare,
        active,
        eventId: event.eventId,
        eventName: event.eventName,
      });
    }
  }
  return out;
}

export interface TikTokSnapshotAd {
  campaign_id: string | null;
  campaign_name: string | null;
  deeplink_url: string | null;
  spend: number | string | null;
  status: string | null;
}

export function isTikTokAdActive(status: string | null | undefined): boolean {
  const s = (status ?? "").trim().toUpperCase();
  return s === "ENABLE" || s === "ENABLED" || s === "ACTIVE";
}

export function liveDestinationsFromTikTokAds(
  rows: readonly TikTokSnapshotAd[],
  event: { eventId: string; eventName: string },
): LiveCampaignDestination[] {
  const out: LiveCampaignDestination[] = [];
  for (const row of rows) {
    const campaignId = row.campaign_id?.trim();
    if (!campaignId) continue;
    const spend =
      typeof row.spend === "number"
        ? row.spend
        : Number.parseFloat(String(row.spend ?? "0")) || 0;
    out.push({
      campaignId,
      campaignName: row.campaign_name?.trim() || campaignId,
      platform: "tiktok",
      destinationUrl: row.deeplink_url,
      spend,
      active: isTikTokAdActive(row.status),
      eventId: event.eventId,
      eventName: event.eventName,
    });
  }
  return out;
}
