import { paidSpendOf } from "./paid-spend.ts";
import type { DailyRollupRow } from "@/lib/db/client-portal-server";

/**
 * Sums lifetime paid-media spend across ALL platforms (Meta + TikTok + Google
 * Ads) for a venue's rollup rows. For the Meta column it honours the allocator
 * split (ad_spend_allocated + ad_spend_presale) when present; for multi-event
 * venues with no allocated spend yet, the Meta contribution is treated as null
 * (not counted) until the allocator runs. TikTok and Google Ads are always
 * summed regardless of the Meta allocator state.
 */
export function sumLifetimePaidMediaSpend(
  rollups: DailyRollupRow[],
  isMultiEventVenue: boolean,
): number {
  let total = 0;
  for (const row of rollups) {
    const hasAllocatedSpend =
      row.ad_spend_allocated != null || row.ad_spend_presale != null;
    const metaSpendForRow = hasAllocatedSpend
      ? (row.ad_spend_allocated ?? 0) + (row.ad_spend_presale ?? 0)
      : isMultiEventVenue
        ? null
        : row.ad_spend;
    total += paidSpendOf({
      ad_spend: metaSpendForRow,
      tiktok_spend: row.tiktok_spend,
      google_ads_spend: row.google_ads_spend ?? null,
    });
  }
  return total;
}
