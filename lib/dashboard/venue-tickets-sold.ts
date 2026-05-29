/**
 * lib/dashboard/venue-tickets-sold.ts
 *
 * Canonical ticket-count aggregation for the Funnel Pacing tab.
 *
 * Aligns to the same MAX-across-sources resolution used by the
 * Performance tab (`resolveDisplayTicketCount`) so both surfaces show
 * the same headline ticket count. Prior to #489 the Funnel Pacing
 * page read `events.tickets_sold` directly, which only reflects the
 * 4TF API connector's write target and misses Venue direct / box-office
 * sales captured in `tier_channel_sales`.
 *
 * Why we don't call `resolveDisplayTicketCount` directly:
 *   That function also takes `ticket_tiers: EventTicketTierRow[]`, which
 *   adds `SUM(tier.quantity_sold)` as a fourth MAX input. For the Funnel
 *   Pacing call site, this equals `events.tickets_sold` (confirmed by SQL
 *   for all WC26 venues on 2026-05-29), so the `ticket_tiers` path never
 *   wins and can be safely omitted here. Inlining the three-field MAX
 *   keeps this module dependency-free and trivially testable.
 *
 * Per-event resolution:
 *   MAX(
 *     latest_snapshot.tickets_sold,  // freshest API or manual cumulative
 *     events.tickets_sold,           // legacy fallback / 4TF connector
 *     tier_channel_sales_tickets,    // multi-channel (Venue + 4TF box office)
 *   )
 *
 * Impact confirmed via SQL (2026-05-29):
 *   WC26-MANCHESTER   849 → 1,348   (+499 Venue direct sales)
 *   WC26-GLASGOW-SWG3 2,570 → 3,298 (+728)
 *   WC26-BRISTOL      546 → 701     (+155)
 *   WC26-BRIGHTON     2,388 → 2,567  (+179)
 *   WC26-MARGATE      148 → 160     (+12)
 *   WC26-EDINBURGH    no change     (TCS ≤ events.tickets_sold)
 */

/** Minimal shape required from a portal event object. */
export interface VenueEventTicketInput {
  tickets_sold: number | null;
  latest_snapshot?: { tickets_sold: number | null } | null;
  tier_channel_sales_tickets: number | null;
}

/**
 * Sum of resolved ticket counts across all events at a venue.
 *
 * Each event contributes `MAX(snapshot, events.tickets_sold, tier_channel_sales)`.
 * Returns 0 when the array is empty or all values are null.
 *
 * Pass this as `ticketsSold` into `buildVenueCanonicalFunnel`.
 */
export function resolveVenueTicketsSold(
  events: ReadonlyArray<VenueEventTicketInput>,
): number {
  let total = 0;
  for (const e of events) {
    const snapshot = e.latest_snapshot?.tickets_sold ?? 0;
    const legacy = e.tickets_sold ?? 0;
    const tcs = e.tier_channel_sales_tickets ?? 0;
    total += Math.max(snapshot, legacy, tcs, 0);
  }
  return total;
}
