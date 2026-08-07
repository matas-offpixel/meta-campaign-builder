import { normalizeAdAccountId } from "@/lib/meta/ad-account";

/**
 * Deep link to Meta Ads Manager's campaign view filtered to one campaign —
 * the "Open in Ads Manager" button on the budget-pacing Slack alert
 * (task #121 Phase 2). Same `selected_*_ids` query-param convention as
 * `lib/bulk-attach/meta-ads-manager-url.ts`'s ad-set version, just one
 * level up the object hierarchy.
 */
export function buildMetaAdsManagerCampaignUrl(adAccountId: string, campaignId: string): string | null {
  const normalized = normalizeAdAccountId(adAccountId);
  if (!normalized || !campaignId) return null;

  const actDigits = normalized.replace(/^act_/, "");
  const params = new URLSearchParams({
    act: actDigits,
    selected_campaign_ids: campaignId,
  });
  return `https://business.facebook.com/adsmanager/manage/campaigns?${params.toString()}`;
}
