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

const CATEGORY_ORDER = ["PR", "INFLUENCER", "PRINT", "RADIO", "OTHER"] as const;

export type SpendCategoryLine = { category: string; amount: number };

/**
 * Per-day lines for tooltips (e.g. Day other: PR £100, Influencer £50).
 */
export function additionalSpendBreakdownLinesByDate(
  entries: ReadonlyArray<{ date: string; amount: number; category: string }>,
): Map<string, SpendCategoryLine[]> {
  const byDate = new Map<string, Map<string, number>>();
  for (const e of entries) {
    let inner = byDate.get(e.date);
    if (!inner) {
      inner = new Map();
      byDate.set(e.date, inner);
    }
    const cat = e.category;
    inner.set(cat, (inner.get(cat) ?? 0) + Number(e.amount));
  }
  const out = new Map<string, SpendCategoryLine[]>();
  for (const [d, inner] of byDate) {
    const lines: SpendCategoryLine[] = [...inner.entries()].map(
      ([category, amount]) => ({ category, amount }),
    );
    lines.sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.category as (typeof CATEGORY_ORDER)[number]) -
        CATEGORY_ORDER.indexOf(b.category as (typeof CATEGORY_ORDER)[number]),
    );
    out.set(d, lines);
  }
  return out;
}

/** Sort merged category lines for stable tooltip / weekly rollup display. */
export function sortSpendCategoryLines(
  lines: SpendCategoryLine[],
): SpendCategoryLine[] {
  return [...lines].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category as (typeof CATEGORY_ORDER)[number]) -
      CATEGORY_ORDER.indexOf(b.category as (typeof CATEGORY_ORDER)[number]),
  );
}
