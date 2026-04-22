import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  getLatestSnapshotForEvent,
  listConnectionsForUser,
  listLinksForEvent,
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
 *   - `link`                 — the existing event_ticketing_links row
 *                              for this event (or null when not yet
 *                              linked). v1 only ever surfaces the
 *                              first link; multi-provider events are
 *                              not modelled in this UI yet.
 *
 *   - `connection`           — the connection backing `link`, with
 *                              credentials wiped (the browser never
 *                              sees the token blob).
 *
 *   - `latestSnapshot`       — the most-recent ticket_sales_snapshots
 *                              row for the event. Drives the live
 *                              capacity / sold / revenue / sell-through
 *                              numbers.
 *
 *   - `availableConnections` — every connection on the event's client.
 *                              Drives the dropdown when the event is
 *                              not yet linked. Empty array when the
 *                              client hasn't connected Eventbrite yet,
 *                              which the panel renders as the "set up
 *                              ticketing first" empty state.
 *
 * All five lookups are wrapped in a single Promise.all + a defensive
 * fallback so a missing migration / RLS hiccup degrades to "no data"
 * rather than 500-ing the whole event page.
 */

export type SafeTicketingConnection = Omit<TicketingConnection, "credentials"> & {
  credentials: null;
};

export interface EventTicketingSummary {
  link: EventTicketingLink | null;
  connection: SafeTicketingConnection | null;
  latestSnapshot: TicketSalesSnapshot | null;
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

  // Pull links + every connection for the client in parallel; the
  // dropdown needs the full list even when a link already exists so
  // the user can re-bind to a different connection if needed.
  const [links, connectionsForClient, latest] = await Promise.all([
    listLinksForEvent(supabase, eventId).catch(() => []),
    clientId
      ? listConnectionsForUser(supabase, { clientId }).catch(() => [])
      : Promise.resolve<TicketingConnection[]>([]),
    getLatestSnapshotForEvent(supabase, eventId).catch(() => null),
  ]);

  const link = links[0] ?? null;
  const connection = link
    ? (connectionsForClient.find((c) => c.id === link.connection_id) ?? null)
    : null;

  return {
    link,
    connection: connection ? redact(connection) : null,
    latestSnapshot: latest,
    availableConnections: connectionsForClient.map(redact),
  };
}
