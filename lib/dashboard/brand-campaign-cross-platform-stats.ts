/**
 * Weighted cross-platform rate metrics for brand_campaign "All" views.
 *
 * CTR / CPM / CPC must be computed from summed numerators and denominators,
 * never averaged from per-platform rates.
 */

export interface CrossPlatformSpendInputs {
  metaSpend: number;
  tiktokSpend: number;
  googleSpend: number;
}

export interface CrossPlatformDeliveryInputs {
  metaImpressions: number;
  tiktokImpressions: number;
  googleImpressions: number;
  metaClicks: number;
  tiktokClicks: number;
  googleClicks: number;
  /** Platform reach sums — additive across platforms (not deduplicated). Optional; defaults to 0. */
  metaReach?: number;
  tiktokReach?: number;
  googleReach?: number;
}

export interface CrossPlatformRateMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  /** Additive cross-platform reach (per-platform sums; not deduplicated). */
  reach: number;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
}

export function sumCrossPlatformSpend(input: CrossPlatformSpendInputs): number {
  return input.metaSpend + input.tiktokSpend + input.googleSpend;
}

export function computeCrossPlatformRateMetrics(
  spend: CrossPlatformSpendInputs,
  delivery: CrossPlatformDeliveryInputs,
): CrossPlatformRateMetrics {
  const totalSpend = sumCrossPlatformSpend(spend);
  const impressions =
    delivery.metaImpressions + delivery.tiktokImpressions + delivery.googleImpressions;
  const clicks =
    delivery.metaClicks + delivery.tiktokClicks + delivery.googleClicks;
  const reach =
    (delivery.metaReach ?? 0) + (delivery.tiktokReach ?? 0) + (delivery.googleReach ?? 0);

  return {
    spend: totalSpend,
    impressions,
    clicks,
    reach,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
    cpm: impressions > 0 ? (totalSpend / impressions) * 1000 : null,
    cpc: clicks > 0 ? totalSpend / clicks : null,
  };
}
