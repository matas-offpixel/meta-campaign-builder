/**
 * Read-side helpers for ANY surface that says "spend" or "paid media" to a
 * user. Meta-specific surfaces (creative health scorer, allocator splits, Meta
 * CPM) keep reading `ad_spend` directly.
 */

/** Meta paid media only — honours allocator columns + Meta presale split. */
export function metaPaidSpendOf(row: {
  ad_spend: number | string | null | undefined;
  ad_spend_allocated?: number | string | null | undefined;
  ad_spend_presale?: number | string | null | undefined;
}): number {
  const presale = safeNumber(row.ad_spend_presale);
  const allocated = row.ad_spend_allocated;
  if (allocated != null || row.ad_spend_presale != null) {
    if (allocated != null) {
      return safeNumber(allocated) + presale;
    }
    return safeNumber(row.ad_spend) + presale;
  }
  return safeNumber(row.ad_spend);
}

export function paidSpendOf(row: {
  ad_spend: number | string | null | undefined;
  ad_spend_allocated?: number | string | null | undefined;
  ad_spend_presale?: number | string | null | undefined;
  tiktok_spend: number | string | null | undefined;
  google_ads_spend?: number | string | null | undefined;
}): number {
  return (
    metaPaidSpendOf(row) +
    safeNumber(row.tiktok_spend) +
    safeNumber(row.google_ads_spend)
  );
}

export function paidLinkClicksOf(row: {
  link_clicks: number | string | null | undefined;
  tiktok_clicks: number | string | null | undefined;
  google_ads_clicks?: number | string | null | undefined;
}): number {
  return (
    safeNumber(row.link_clicks) +
    safeNumber(row.tiktok_clicks) +
    safeNumber(row.google_ads_clicks)
  );
}

function safeNumber(value: number | string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
