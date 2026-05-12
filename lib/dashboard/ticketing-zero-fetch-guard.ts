/**
 * lib/dashboard/ticketing-zero-fetch-guard.ts
 *
 * Pure guard: detect when a 4theFans / foursomething API call returned a
 * suspiciously low lifetime total that indicates bad data rather than genuine
 * zero sales.
 *
 * These providers report a cumulative lifetime total, not per-order buckets.
 * A current total of 0 while the most-recent snapshot already recorded a
 * positive total is physically impossible — the lifetime total cannot
 * decrease.  The most likely cause is a rate-limit, empty response body, or a
 * transient provider outage.
 *
 * When this returns `true` the caller should skip both the snapshot insert and
 * the rollup row write so the daily delta chain is not corrupted.
 *
 * Kept in a separate pure module (no `server-only` guard) so it can be
 * imported directly by unit tests.
 */

/**
 * Returns `true` when a provider's current lifetime ticket total looks like a
 * bad API response rather than genuine zero sales.
 *
 * @param currentLifetime  - Lifetime total returned by the provider API call.
 * @param previousLifetime - Lifetime total from the most-recent stored
 *   snapshot, or `null` if this is the first-ever sync for this link.
 */
export function isSuspiciousTicketingZeroFetch(
  currentLifetime: number,
  previousLifetime: number | null,
): boolean {
  return currentLifetime === 0 && previousLifetime != null && previousLifetime > 0;
}
