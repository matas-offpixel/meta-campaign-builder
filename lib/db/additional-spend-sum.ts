/**
 * Pure helpers for additional spend window sums — safe for client import.
 */

export function sumAdditionalSpendAmounts(
  entries: ReadonlyArray<{ date: string; amount: number }>,
  window: Set<string> | null,
): number {
  let t = 0;
  for (const e of entries) {
    if (window != null && !window.has(e.date)) continue;
    t += Number(e.amount);
  }
  return t;
}

export function additionalSpendTotalsByDate(
  entries: ReadonlyArray<{ date: string; amount: number }>,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) {
    m.set(e.date, (m.get(e.date) ?? 0) + Number(e.amount));
  }
  return m;
}
