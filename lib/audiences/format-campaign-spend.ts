/** GBP spend label for audience source campaign pickers (UK ops default). */
export function formatCampaignSpendGbp(spend: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(spend);
}
