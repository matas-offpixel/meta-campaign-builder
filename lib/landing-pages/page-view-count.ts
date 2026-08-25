/**
 * First-party LP views, counted per event per UTC day.
 * The funnel helper sums these for the lifetime LPV stage.
 */

export function utcDayFromOccurredAt(iso: string): string | null {
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export function countPageViewsByUtcDay(
  occurredAts: string[],
): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const iso of occurredAts) {
    const day = utcDayFromOccurredAt(iso);
    if (!day) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return byDay;
}

export function lifetimePageViewCount(occurredAts: string[]): number {
  return occurredAts.reduce((sum, iso) => {
    return utcDayFromOccurredAt(iso) ? sum + 1 : sum;
  }, 0);
}
