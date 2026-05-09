/**
 * Run `fn` over `items` with at most `limit` simultaneous in-flight calls.
 * Results are returned in the same order as `items`.
 *
 * Lives in a standalone file so it can be unit-tested without importing
 * lib/meta/client.ts (which uses TS parameter properties incompatible with
 * Node's --experimental-strip-types test runner).
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}
