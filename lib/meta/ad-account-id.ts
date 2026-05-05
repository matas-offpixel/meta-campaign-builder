/**
 * Meta Graph API requires the `act_` prefix for ad-account-scoped edges
 * (e.g. /act_{id}/campaigns, /act_{id}/adspixels, /act_{id}/customaudiences).
 *
 * clients.meta_ad_account_id is stored as a bare numeric ID. Always normalise
 * via this helper before passing to Graph API endpoints.
 */
export function withActPrefix(adAccountId: string): string {
  if (!adAccountId) return adAccountId;
  return adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
}

export function withoutActPrefix(adAccountId: string): string {
  return adAccountId.replace(/^act_/, "");
}
