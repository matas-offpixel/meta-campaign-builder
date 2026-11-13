/**
 * lib/event-config/allocation.ts
 *
 * Sellable allocation (D9): the sum of tier_channel_allocations for paid
 * tiers, else events.capacity. The trajectory and "needed" use it. It is a
 * read helper, never a column, and there is no default: no capacity and no
 * paid tier allocation means null, and the trajectory says NO_CAPACITY.
 *
 * A tier is a comp (never sellable) when its name says guest list, comps or
 * free (the names Internal Counts uses, D8), or when its stored price is
 * zero or below (DJ EZ's "VIP Free" at −£1.00). A tier with no stored price
 * is paid unless its name says otherwise.
 *
 * Pure. Relative imports only: the `node --test` runner can't resolve `@/`.
 */

/** The same names HD1's parser flags as comps (lib/internal-counts/parse.ts). */
export const COMP_TIER_NAME = /\b(guest|guests|guestlist|gl|comp|comps|complimentary|free)\b/i;

export function isCompTier(tierName: string, price: number | null | undefined): boolean {
  if (COMP_TIER_NAME.test(tierName)) return true;
  return price != null && Number(price) <= 0;
}

export interface TierAllocation {
  tier_name: string;
  allocation_count: number;
}

export type AllocationSource = "tiers" | "capacity";

export interface SellableAllocation {
  /** Null when the event has neither a capacity nor a paid tier allocation. */
  allocation: number | null;
  source: AllocationSource | null;
  /** Sum of the paid tiers' allocations across channels; null when no paid tier has one. */
  paidTierAllocation: number | null;
  /** Allocation on comp tiers, left out of the sellable figure. */
  compAllocation: number;
  capacity: number | null;
}

/** A stored capacity of 0 or less is no capacity: there is no default. */
export function usableCapacity(capacity: number | null | undefined): number | null {
  if (capacity == null) return null;
  const n = Number(capacity);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/**
 * `allocations` are the event's tier_channel_allocations rows (one per
 * tier and channel). `tierPrices` maps a tier name, exactly as stored, to
 * its price from event_ticket_tiers.
 */
export function sellableAllocation(input: {
  capacity: number | null | undefined;
  allocations: readonly TierAllocation[];
  tierPrices?: ReadonlyMap<string, number | null>;
}): SellableAllocation {
  const capacity = usableCapacity(input.capacity);
  let paid = 0;
  let paidRows = 0;
  let comp = 0;
  for (const row of input.allocations) {
    const count = Math.max(0, Math.trunc(Number(row.allocation_count) || 0));
    if (isCompTier(row.tier_name, input.tierPrices?.get(row.tier_name))) {
      comp += count;
      continue;
    }
    paid += count;
    paidRows += 1;
  }
  const paidTierAllocation = paidRows > 0 && paid > 0 ? paid : null;
  if (paidTierAllocation != null) {
    return { allocation: paidTierAllocation, source: "tiers", paidTierAllocation, compAllocation: comp, capacity };
  }
  return {
    allocation: capacity,
    source: capacity != null ? "capacity" : null,
    paidTierAllocation: null,
    compAllocation: comp,
    capacity,
  };
}
