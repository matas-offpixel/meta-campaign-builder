/**
 * Read-side helpers for ANY surface that says "spend" or "paid media" to a
 * user. Meta-specific surfaces (creative health scorer, allocator splits, Meta
 * CPM) keep reading `ad_spend` directly.
 */

export function paidSpendOf(row: {
  ad_spend: number | string | null | undefined;
  tiktok_spend: number | string | null | undefined;
}): number {
  return safeNumber(row.ad_spend) + safeNumber(row.tiktok_spend);
}

export function paidLinkClicksOf(row: {
  link_clicks: number | string | null | undefined;
  tiktok_clicks: number | string | null | undefined;
}): number {
  return safeNumber(row.link_clicks) + safeNumber(row.tiktok_clicks);
}

function safeNumber(value: number | string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
