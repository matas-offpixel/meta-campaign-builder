/**
 * lib/ticketing/tier-channel-stale-delete.ts
 *
 * Pure planner for retiring `tier_channel_sales` rows whose `tier_name`
 * dropped out of the provider's current API response — e.g. a venue renamed
 * "General Admission (Final Release)" → "79 GA – Arena Stands". Without
 * retirement the old-name row keeps its last-synced count forever and the
 * venue over-counts (Aston Villa hit 18,911 on a 7,344-cap venue across 3
 * rename generations).
 *
 * SAFETY-CRITICAL — two invariants this function exists to guarantee, both
 * covered by `__tests__/tier-channel-stale-delete.test.ts`:
 *
 *  1. **Channel scope.** Only rows on `channelId` (the provider's own
 *     automatic channel — `4TF` for fourthefans) are ever eligible for
 *     deletion. Operator channels (Venue, CP, DS, …) hold manually-imported
 *     external sales the provider API never sees, so their tier names will
 *     ALWAYS look "absent from the API" — they must never be marked stale.
 *     The function filters `existingRows` to `channelId` itself, so even a
 *     caller that over-reads (passes other channels' rows) cannot trigger a
 *     cross-channel delete. The DB read + delete are independently
 *     channel-scoped too; this is the third layer.
 *
 *  2. **Empty-response guard.** When `currentTierNames` is empty (the API
 *     returned zero tiers — a rate-limit, empty body, or outage, not a real
 *     "all tiers gone"), this returns `[]` — never the whole channel. This
 *     guard is the single thing standing between a flaky API response and a
 *     wiped channel.
 *
 * Pure (no DB / network / `server-only`) so it is unit-testable in isolation
 * under `node --test` — the supabase-backed `upsertProviderTierChannelSales`
 * in `lib/db/ticketing.ts` cannot be imported there (server-only + `@/`
 * alias).
 */

export interface TierChannelRowRef {
  tier_name: string;
  channel_id: string;
}

/**
 * Given the existing `tier_channel_sales` rows, the tier names present in the
 * current provider API response, and the resolved automatic `channelId`,
 * return the subset of rows that should be deleted (renamed-out tiers on the
 * automatic channel only).
 *
 * @param existingRows      Rows read back from `tier_channel_sales` for this
 *                          event. SHOULD already be filtered to `channelId`
 *                          at the DB read; the helper re-filters defensively.
 * @param currentTierNames  Tier names just upserted from the provider API.
 * @param channelId         The resolved provider automatic channel id (4TF).
 */
export function computeStaleTierChannelDeletions<T extends TierChannelRowRef>(
  existingRows: readonly T[],
  currentTierNames: readonly string[],
  channelId: string,
): T[] {
  // Empty-response guard: the API gave us nothing this sync — treat it as a
  // blip, not "all tiers retired". Never delete on an empty response.
  if (currentTierNames.length === 0) return [];

  const survivors = new Set(currentTierNames);
  return existingRows.filter(
    (row) => row.channel_id === channelId && !survivors.has(row.tier_name),
  );
}
