/** GBP spend label for audience source campaign pickers (UK ops default). */
export function formatCampaignSpendGbp(spend: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(spend);
}

/** Impressions stat label shown when spend = 0 (e.g. archived campaigns). */
export function formatImpressionsStat(impressions: number): string {
  if (impressions >= 1_000_000) {
    return `${(impressions / 1_000_000).toFixed(1)}M impr.`;
  }
  if (impressions >= 1_000) {
    return `${Math.round(impressions / 1_000)}K impr.`;
  }
  if (impressions > 0) {
    return `${impressions} impr.`;
  }
  return "—";
}

/** Returns spend label if non-zero, else impressions label. */
export function formatCampaignStat(spend: number, impressions?: number): string {
  if (spend > 0) return formatCampaignSpendGbp(spend);
  return formatImpressionsStat(impressions ?? 0);
}
