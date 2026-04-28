import type { EventAllocationLifetime } from "@/lib/db/client-dashboard-aggregations";

const LONDON_VENUE_COUNT = 4;

export interface VenueSpendEvent {
  id: string;
}

export interface VenueSpendGroup<Event extends VenueSpendEvent = VenueSpendEvent> {
  city: string | null;
  campaignSpend: number | null;
  eventCount: number;
  events: Event[];
}

export type GroupSpend =
  | {
      kind: "allocated";
      /** Per-event lifetime allocation, keyed by event id. */
      byEventId: Map<string, EventAllocationLifetime>;
      /** Sum across all events of opponent-matched spend. */
      venueSpecific: number;
      /** Sum across all events of venue-wide generic share. */
      venueGenericPool: number;
      /** `venueSpecific + venueGenericPool`. */
      venueTotal: number;
      /** Sum of allocator-written presale spend across events. */
      venuePresale: number;
      /** `venueTotal + venuePresale`, the venue table paid-media total. */
      venuePaidMedia: number;
      /** `venueGenericPool / eventCount`. */
      genericSharePerEvent: number;
      /** Number of events covered by this allocation. */
      eventCount: number;
    }
  | { kind: "split"; perEventTotal: number | null }
  | { kind: "add"; perEventAd: number | null }
  | { kind: "rollup"; byEventId: Map<string, number>; venuePaidMedia: number };

/**
 * True when the venue has any positive rollup-derived paid media.
 * Used to prefer rollups over a null/zero Meta cache without changing
 * behaviour for genuinely zero-spend venues.
 */
export function hasRollupPaidSpend(
  group: VenueSpendGroup,
  paidSpendByEvent: Map<string, number>,
): boolean {
  for (const ev of group.events) {
    const spend = paidSpendByEvent.get(ev.id);
    if (spend != null && spend > 0) return true;
  }
  return false;
}

/**
 * Selects the per-venue paid-media model used by the client portal venue table.
 * Meta allocator outputs stay preferred; rollup-derived spend fills the
 * TikTok-only case where the Meta campaign cache is null or zero.
 */
export function venueSpend<Event extends VenueSpendEvent>(
  group: VenueSpendGroup<Event>,
  londonOnsaleSpend: number | null,
  allocationByEvent: Map<string, EventAllocationLifetime>,
  paidSpendByEvent: Map<string, number>,
): GroupSpend {
  if (
    group.events.length > 0 &&
    group.events.every((ev) => allocationByEvent.has(ev.id))
  ) {
    const byEventId = new Map<string, EventAllocationLifetime>();
    let venueSpecific = 0;
    let venueGenericPool = 0;
    let venuePresale = 0;
    for (const ev of group.events) {
      const alloc = allocationByEvent.get(ev.id)!;
      byEventId.set(ev.id, alloc);
      venueSpecific += alloc.specific;
      venueGenericPool += alloc.genericShare;
      venuePresale += alloc.presale;
    }
    const venueTotal = venueSpecific + venueGenericPool;
    const venuePaidMedia = venueTotal + venuePresale;
    const eventCount = group.events.length;
    const genericSharePerEvent =
      eventCount > 0 ? venueGenericPool / eventCount : 0;
    return {
      kind: "allocated",
      byEventId,
      venueSpecific,
      venueGenericPool,
      venueTotal,
      venuePresale,
      venuePaidMedia,
      genericSharePerEvent,
      eventCount,
    };
  }

  if (isLondonCity(group.city) && londonOnsaleSpend !== null) {
    const onsaleShare = londonOnsaleSpend / LONDON_VENUE_COUNT;
    const venueMeta = group.campaignSpend ?? 0;
    const perEventAd =
      group.eventCount > 0 ? (onsaleShare + venueMeta) / group.eventCount : null;
    return { kind: "add", perEventAd };
  }

  if (
    (group.campaignSpend === null || group.campaignSpend === 0) &&
    hasRollupPaidSpend(group, paidSpendByEvent)
  ) {
    let venuePaidMedia = 0;
    const byEventId = new Map<string, number>();
    for (const ev of group.events) {
      const paid = paidSpendByEvent.get(ev.id);
      if (paid == null) continue;
      byEventId.set(ev.id, paid);
      venuePaidMedia += paid;
    }
    return { kind: "rollup", byEventId, venuePaidMedia };
  }

  const perEventTotal =
    group.campaignSpend !== null && group.eventCount > 0
      ? group.campaignSpend / group.eventCount
      : null;
  return { kind: "split", perEventTotal };
}

function isLondonCity(city: string | null | undefined): boolean {
  return (city ?? "").toLowerCase() === "london";
}
