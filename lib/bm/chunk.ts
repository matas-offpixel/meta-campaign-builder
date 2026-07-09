/**
 * lib/bm/chunk.ts
 *
 * Pure array-chunking helper for `scanBusinessManager`
 * (`lib/bm/sync.ts`). Split out as a standalone, dependency-free module so
 * it's unit-testable directly — `sync.ts` imports `@/lib/meta/client`
 * (`MetaApiError`'s TypeScript-parameter-property constructor, unsupported
 * by Node's `--experimental-strip-types` test runner) and `server-only`,
 * neither of which this file needs.
 *
 * Used by the 2026-07-09 scan-timeout fix to batch `bm_page_access_events`
 * inserts (and checkpoint `last_scanned_at`) at a fixed boundary instead of
 * awaiting one insert per detected page.
 */

/**
 * Splits `items` into consecutive groups of at most `size`. Preserves
 * order; never drops or duplicates items; the last chunk may be smaller
 * than `size`. Returns `[]` for an empty input.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) {
    throw new RangeError(`chunk size must be > 0, got ${size}`);
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
