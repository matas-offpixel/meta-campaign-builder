import type { PortalEvent } from "@/lib/db/client-portal-server";
import {
  resolveDisplayTicketCount,
  resolveDisplayTicketRevenue,
} from "@/lib/dashboard/tier-channel-rollups";
import type { GroupSpend } from "@/lib/dashboard/venue-spend-model";

/**
 * Per-event spend / ticketing metrics for the expanded portal row
 * (Pre-reg · Ad spend · CPT · revenue · ROAS). Shared by
 * `client-portal-venue-table` and `VenueEventBreakdown` so dashboard and
 * share surfaces stay numerically aligned.
 */
export interface PortalEventSpendRowMetrics {
  prereg: number | null;
  perEventTotal: number | null;
  perEventAd: number | null;
  tickets: number;
  prevTickets: number;
  change: number;
  cpt: number | null;
  cptPrevious: number | null;
  cptChange: number | null;
  revenue: number | null;
  roas: number | null;
}

export function computePortalEventSpendRowMetrics(
  ev: PortalEvent,
  spend: GroupSpend,
): PortalEventSpendRowMetrics {
  const allocPresale =
    spend.kind === "allocated" ? spend.byEventId.get(ev.id) : undefined;
  const prereg =
    allocPresale && allocPresale.daysCoveredPresale > 0
      ? 0
      : ev.prereg_spend;

  let perEventAd: number | null;
  let perEventTotal: number | null;
  if (spend.kind === "allocated") {
    const alloc = spend.byEventId.get(ev.id);
    perEventAd = alloc?.paidMedia ?? null;
    perEventTotal = perEventAd !== null ? (prereg ?? 0) + perEventAd : null;
  } else if (spend.kind === "split") {
    perEventTotal = spend.perEventTotal;
    perEventAd =
      perEventTotal !== null ? perEventTotal - (prereg ?? 0) : null;
  } else if (spend.kind === "add") {
    perEventAd = spend.perEventAd;
    perEventTotal = perEventAd !== null ? (prereg ?? 0) + perEventAd : null;
  } else {
    perEventAd = spend.byEventId.get(ev.id) ?? null;
    perEventTotal = perEventAd !== null ? (prereg ?? 0) + perEventAd : null;
  }

  const tickets =
    ev.ticket_tiers.length > 0
      ? resolveDisplayTicketCount({
          ticket_tiers: ev.ticket_tiers,
          latest_snapshot_tickets: ev.latest_snapshot?.tickets_sold ?? null,
          fallback_tickets: ev.tickets_sold ?? null,
        })
      : ev.latest_snapshot?.tickets_sold ?? ev.tickets_sold ?? 0;
  const prev = ev.tickets_sold_previous ?? 0;
  const cpt =
    perEventTotal !== null && perEventTotal > 0 && tickets > 0
      ? perEventTotal / tickets
      : null;
  const cptPrevious =
    perEventTotal !== null && perEventTotal > 0 && prev > 0
      ? perEventTotal / prev
      : null;
  const cptChange =
    cpt !== null && cptPrevious !== null ? cpt - cptPrevious : null;
  const revenue =
    ev.ticket_tiers.length > 0
      ? resolveDisplayTicketRevenue({
          ticket_tiers: ev.ticket_tiers,
          latest_snapshot_revenue: ev.latest_snapshot?.revenue ?? null,
        })
      : ev.latest_snapshot?.revenue ?? null;
  const roas =
    revenue !== null && perEventTotal !== null && perEventTotal > 0
      ? revenue / perEventTotal
      : null;
  return {
    prereg,
    perEventTotal,
    perEventAd,
    tickets,
    prevTickets: prev,
    change: tickets - prev,
    cpt,
    cptPrevious,
    cptChange,
    revenue,
    roas,
  };
}
