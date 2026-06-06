import { normalizeAdAccountId } from "@/lib/meta/ad-account";

/**
 * Deep link to Meta Ads Manager ads view filtered to specific ad sets.
 */
export function buildMetaAdsManagerAdsUrl(
  adAccountId: string,
  adSetIds: string[],
): string | null {
  const normalized = normalizeAdAccountId(adAccountId);
  if (!normalized || adSetIds.length === 0) return null;

  const actDigits = normalized.replace(/^act_/, "");
  const params = new URLSearchParams({
    act: actDigits,
    selected_ad_set_ids: adSetIds.join(","),
  });
  return `https://business.facebook.com/adsmanager/manage/ads?${params.toString()}`;
}
