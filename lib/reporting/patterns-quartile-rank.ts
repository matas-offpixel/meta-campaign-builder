export type PerformanceQuartile = 1 | 2 | 3 | 4;

export interface QuartileRank<T> {
  item: T;
  quartile: PerformanceQuartile;
  rank: number;
}

export function rankByMetricQuartile<T>(
  items: readonly T[],
  metricFor: (item: T) => number | null,
  tieBreakFor: (item: T) => number = () => 0,
): Array<QuartileRank<T>> {
  const sorted = [...items].sort((a, b) => {
    const primary = compareAscNullsLast(metricFor(a), metricFor(b));
    if (primary !== 0) return primary;
    return tieBreakFor(b) - tieBreakFor(a);
  });

  const count = sorted.length;
  return sorted.map((item, index) => ({
    item,
    rank: index + 1,
    quartile: quartileForIndex(index, count),
  }));
}

function quartileForIndex(index: number, count: number): PerformanceQuartile {
  if (count <= 0) return 4;
  const bucket = Math.floor((index * 4) / count) + 1;
  return Math.min(bucket, 4) as PerformanceQuartile;
}

function compareAscNullsLast(a: number | null, b: number | null): number {
  const aValid = a != null && Number.isFinite(a);
  const bValid = b != null && Number.isFinite(b);
  if (!aValid && !bValid) return 0;
  if (!aValid) return 1;
  if (!bValid) return -1;
  return a! - b!;
}
