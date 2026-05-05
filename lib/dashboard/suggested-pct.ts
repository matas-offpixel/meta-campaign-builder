export type TierSaleStatus = "sold_out" | "on_sale" | "on_sale_soon";
export type SuggestedPct = number | "SOLD OUT" | "ON SALE SOON";

export function tierSaleStatus(
  quantitySold: number,
  quantityAvailable: number | null,
): TierSaleStatus {
  if (quantityAvailable === 0 && quantitySold > 0) return "sold_out";
  if (quantityAvailable === 0 && quantitySold === 0) return "on_sale_soon";
  return "on_sale";
}

export function suggestedPct(
  actualPct: number,
  opts?: { isSoldOut?: boolean },
): SuggestedPct {
  if (opts?.isSoldOut) return "SOLD OUT";
  if (actualPct >= 100) return "SOLD OUT";
  if (!Number.isFinite(actualPct) || actualPct <= 0) return 60;
  if (actualPct < 75) {
    return Math.max(60, Math.min(95, actualPct + 20));
  }
  if (actualPct < 90) {
    return 95 + ((actualPct - 75) / 15) * 4;
  }
  return 99;
}
