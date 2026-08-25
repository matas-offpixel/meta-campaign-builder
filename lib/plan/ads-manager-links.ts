import { googleAdsCampaignDeepLink } from "../google-ads/campaign-writer-types.ts";
import { normalizeAdAccountId } from "../meta/ad-account.ts";
import { buildTikTokAdsManagerUrl } from "../tiktok/ads-manager-url.ts";
import type { CampaignPlan } from "./types.ts";

/** Same formula as `buildMetaAdsManagerCampaignUrl` — relative import so node:test can load it. */
function metaCampaignUrl(adAccountId: string, campaignId: string): string | null {
  const normalized = normalizeAdAccountId(adAccountId);
  if (!normalized || !campaignId) return null;
  const actDigits = normalized.replace(/^act_/, "");
  const params = new URLSearchParams({
    act: actDigits,
    selected_campaign_ids: campaignId,
  });
  return `https://business.facebook.com/adsmanager/manage/campaigns?${params.toString()}`;
}

export interface PlanAdsManagerLink {
  adapter: "meta" | "tiktok" | "google";
  href: string | null;
  unavailableReason: string | null;
}

export function planAdsManagerLinks(
  plan: CampaignPlan,
  ids: {
    metaAdAccountId?: string | null;
    tiktokAdvertiserId?: string | null;
    googleCustomerId?: string | null;
  } = {},
): PlanAdsManagerLink[] {
  const metaId = plan.launches.meta.platformCampaignId;
  const metaHref =
    metaId && ids.metaAdAccountId
      ? metaCampaignUrl(ids.metaAdAccountId, metaId)
      : null;

  const tiktokHref = buildTikTokAdsManagerUrl(ids.tiktokAdvertiserId);

  const googleId = plan.launches.google.platformCampaignId;
  const googleHref =
    googleId && ids.googleCustomerId
      ? googleAdsCampaignDeepLink(
          googleId.includes("campaigns/")
            ? googleId
            : `customers/${ids.googleCustomerId}/campaigns/${googleId}`,
          ids.googleCustomerId,
        )
      : null;

  return [
    {
      adapter: "meta",
      href: metaHref,
      unavailableReason: metaHref
        ? null
        : metaId
          ? "Meta campaign id is present but no ad account id to build the Ads Manager URL"
          : "No Meta campaign id yet",
    },
    {
      adapter: "tiktok",
      href: tiktokHref,
      unavailableReason: tiktokHref
        ? null
        : "No TikTok advertiser id — TikTok Ads Manager has no confirmed campaign-selection param",
    },
    {
      adapter: "google",
      href: googleHref,
      unavailableReason: googleHref
        ? null
        : "No Google campaign resource name / customer id yet",
    },
  ];
}
