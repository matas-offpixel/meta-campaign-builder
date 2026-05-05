export function suggestedPct(actualPct: number): number {
  if (!Number.isFinite(actualPct) || actualPct <= 0) return 60;
  if (actualPct < 75) {
    return Math.max(60, Math.min(95, actualPct + 20));
  }
  if (actualPct < 90) {
    return 95 + ((actualPct - 75) / 15) * 4;
  }
  return 99;
}
