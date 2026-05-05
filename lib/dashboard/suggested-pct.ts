export type SuggestedPct = number | "SOLD OUT";

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

export function suggestedCommsPhrase(suggested: SuggestedPct): string {
  if (suggested === "SOLD OUT") return "SOLD OUT";
  if (suggested >= 99) return "Final tickets remaining";
  if (suggested >= 90) return "Almost sold out";
  if (suggested >= 80) return "Limited tickets remaining";
  if (suggested >= 70) return "Selling fast";
  if (suggested >= 60) return "Over half sold";
  return "On sale now";
}
