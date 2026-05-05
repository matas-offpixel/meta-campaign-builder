import type { SuggestedPct, TierSaleStatus } from "./suggested-pct";

export type CommsPhrase = {
  primary: string;
  short: string;
};

export function suggestedCommsPhrase(
  suggestedPct: SuggestedPct | undefined | null,
  saleStatus: TierSaleStatus = "on_sale",
): CommsPhrase {
  if (
    saleStatus === "on_sale_soon" ||
    suggestedPct === "ON SALE SOON" ||
    suggestedPct === undefined
  ) {
    return { primary: "On Sale Soon", short: "Soon" };
  }
  if (suggestedPct === null) return { primary: "On sale now", short: "On sale" };
  if (suggestedPct === "SOLD OUT") {
    return { primary: "SOLD OUT", short: "Sold Out" };
  }
  if (suggestedPct >= 99) {
    return { primary: "Final tickets remaining", short: "Final tickets" };
  }
  if (suggestedPct >= 90) return { primary: "Almost sold out", short: "Almost sold out" };
  if (suggestedPct >= 80) {
    return { primary: "Limited tickets remaining", short: "Limited" };
  }
  if (suggestedPct >= 70) return { primary: "Selling fast", short: "Selling fast" };
  if (suggestedPct >= 60) return { primary: "Over half sold", short: "Half sold" };
  return { primary: "On sale now", short: "On sale" };
}
