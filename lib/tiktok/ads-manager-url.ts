/**
 * Deep link into TikTok Ads Manager scoped to one advertiser.
 *
 * Verified 2026-08-21 on advertiser 7639802149165301776: Ads Manager's
 * campaign list at
 * `https://ads.tiktok.com/i18n/perf/campaign?aadvid=<ID>`
 * redirects to
 * `https://ads.tiktok.com/i18n/manage/campaign?aadvid=<ID>&st=…&et=…`.
 * The real destination is `/i18n/manage/campaign`. `st`/`et` are an optional
 * display range and are not required.
 *
 * No campaign-selection parameter is shipped. Meta Ads Manager has
 * `selected_campaign_ids`; TikTok has no confirmed equivalent. Do not invent
 * one.
 */
export function buildTikTokAdsManagerUrl(
  advertiserId: string | null | undefined,
): string | null {
  const id = advertiserId?.trim();
  if (!id) return null;

  const params = new URLSearchParams({ aadvid: id });
  return `https://ads.tiktok.com/i18n/manage/campaign?${params.toString()}`;
}
