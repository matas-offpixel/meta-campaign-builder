/**
 * Convert a provider's current lifetime ticket total into today's daily delta.
 *
 * 4thefans and foursomething_internal expose "tickets sold so far" rather
 * than per-order daily buckets. The daily tracker needs a per-day number, so
 * each sync compares the current total with the previous snapshot total.
 */
export function currentSnapshotDailyDelta(args: {
  currentTotal: number;
  previousTotal: number | null;
}): number {
  const current = Math.max(0, Math.round(args.currentTotal));
  if (args.previousTotal == null || !Number.isFinite(args.previousTotal)) {
    return current;
  }
  const previous = Math.max(0, Math.round(args.previousTotal));
  return Math.max(0, current - previous);
}
