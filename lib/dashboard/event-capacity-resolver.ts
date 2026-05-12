/**
 * lib/dashboard/event-capacity-resolver.ts
 *
 * Pure helper: resolve the authoritative capacity denominator for an event's
 * "% Sold" column in the Event Breakdown table.
 *
 * Priority:
 *   1. `events.capacity` (event-level, kept up to date by
 *      `updateEventCapacityFromTicketTiers` on every successful sync).
 *   2. Tier-rollup allocation (sum of `quantity_available` across tiers, or
 *      channel `allocation_count` when present) — used ONLY when the event
 *      row has no capacity yet (e.g. freshly imported event before first sync).
 *
 * Bug context (Bristol 2026-05-12):
 *   Before this fix the priority was reversed: tier allocation was preferred
 *   over event.capacity.  Bristol tiers each had `quantity_available=20`
 *   while the event's real capacity was 779-918.  The UI showed "236/20",
 *   "53/20", etc. and triggered false SOLD OUT badges.
 *
 * Kept in a separate pure module (no `server-only` guard) so it can be
 * imported directly by unit tests.
 */

/**
 * @param eventCapacity   - `events.capacity` from the DB row, or `null` when
 *   the event has never been synced.
 * @param tierAllocation  - Sum of tier-level slot counts from the rollup, or
 *   `null` when no tier data exists for the event.
 * @returns The capacity value to use as the denominator for % Sold, or `null`
 *   if neither source is available.
 */
export function resolveEventCapacity(
  eventCapacity: number | null | undefined,
  tierAllocation: number | null | undefined,
): number | null {
  if (eventCapacity != null && eventCapacity > 0) return eventCapacity;
  if (tierAllocation != null && tierAllocation > 0) return tierAllocation;
  return null;
}
