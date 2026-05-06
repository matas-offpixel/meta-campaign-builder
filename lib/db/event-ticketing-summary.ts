import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  getLatestSnapshotForEvent,
  listConnectionsForUser,
  listLinksForEvent,
  sumLatestSnapshotRevenueForEvent,
} from "@/lib/db/ticketing";
import type {
  EventTicketingLink,
  TicketingConnection,
  TicketSalesSnapshot,
} from "@/lib/ticketing/types";

/**
 * lib/db/event-ticketing-summary.ts
 *
 * Server-side aggregator that backs the new "live Eventbrite block"
 * + "Link Eventbrite event" panel at the top of the event detail
 * page (and the matching `/api/ticketing/eventbrite-stats` endpoint
 * that the client-side refresh button calls).
 *
 * Returns four things in one round-trip:
 *
 *   - `links`                — every `event_ticketing_links` row for this
 *                              event (multiple external listings allowed).
 *
 *   - `link`                 — backwards-compat alias for `links[0]`.
 *
 *   - `connection`           — the connection backing `link`, with
 *                              credentials wiped (the browser never
 *                              sees the token blob).
 *
 *   - `latestSnapshot`       — the most-recent ticket_sales_snapshots
 *                              row for the event (any listing).
 *
 *   - `aggregatedTicketsSold` / `aggregatedCapacity` — from `events`.
 *
 *   - `aggregatedGrossRevenueCents` — sum of latest snapshot revenue per
 *      linked external event.
 *
 *   - `availableConnections` — every connection on the event's client.
 */

export type SafeTicketingConnection = Omit<TicketingConnection, "credentials"> & {
  credentials: null;
};

export interface EventTicketingSummary {
  links: EventTicketingLink[];
  link: EventTicketingLink | null;
  connection: SafeTicketingConnection | null;
  latestSnapshot: TicketSalesSnapshot | null;
  aggregatedTicketsSold: number | null;
  aggregatedCapacity: number | null;
  aggregatedGrossRevenueCents: number | null;
  aggregatedCurrency: string | null;
  availableConnections: SafeTicketingConnection[];
}

function redact(c: TicketingConnection): SafeTicketingConnection {
  return { ...c, credentials: null };
}

export async function getEventTicketingSummary(
  eventId: string,
  clientId: string | null,
): Promise<EventTicketingSummary> {
  const supabase = await createClient();

  const [eventRes, links, connectionsForClient, latest] = await Promise.all([
    supabase
      .from("events")
      .select("tickets_sold, capacity")
      .eq("id", eventId)
      .maybeSingle(),
    listLinksForEvent(supabase, eventId).catch(() => []),
    clientId
      ? listConnectionsForUser(supabase, { clientId }).catch(() => [])
      : Promise.resolve<TicketingConnection[]>([]),
    getLatestSnapshotForEvent(supabase, eventId).catch(() => null),
  ]);

  const linkList = links;
  const primaryLink = linkList[0] ?? null;
  const connection = primaryLink
    ? (connectionsForClient.find((c) => c.id === primaryLink.connection_id) ??
      null)
    : null;

  const revenue = await sumLatestSnapshotRevenueForEvent(
    supabase,
    eventId,
    linkList,
  ).catch(() => ({ totalCents: 0, currency: null as string | null }));

  const er = eventRes.data as
    | { tickets_sold: number | null; capacity: number | null }
    | null;

  return {
    links: linkList,
    link: primaryLink,
    connection: connection ? redact(connection) : null,
    latestSnapshot: latest,
    aggregatedTicketsSold:
      typeof er?.tickets_sold === "number" && Number.isFinite(er.tickets_sold)
        ? er.tickets_sold
        : null,
    aggregatedCapacity:
      typeof er?.capacity === "number" && Number.isFinite(er.capacity)
        ? er.capacity
        : null,
    aggregatedGrossRevenueCents:
      revenue.totalCents > 0 ? revenue.totalCents : null,
    aggregatedCurrency: revenue.currency,
    availableConnections: connectionsForClient.map(redact),
  };
}
