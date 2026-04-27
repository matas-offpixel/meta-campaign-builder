import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getClientByIdServer } from "@/lib/db/clients-server";
import { listEventsServer } from "@/lib/db/events-server";
import { listConnectionsForUser } from "@/lib/db/ticketing";
import type { ClientRow } from "@/lib/db/clients";
import type { EventWithClient } from "@/lib/db/events";
import type {
  EventTicketingLink,
  TicketingConnection,
} from "@/lib/ticketing/types";
import {
  computeEventReadiness,
  type ReadinessResult,
} from "@/lib/db/event-readiness";

/**
 * lib/db/client-rollout-query.ts
 *
 * Single-round-trip loader for `/clients/[id]/rollout`. Bundles:
 *
 *   - client row
 *   - events for the client (RLS-scoped to the signed-in user)
 *   - ticketing connections for the client
 *   - event_ticketing_links for every event in one IN() query
 *   - report_shares (event-scope) for every event in one IN() query
 *
 * Emits a joined row per event with the computed readiness state so the
 * page component has nothing to fetch on its own. Kept deliberately
 * separate from the per-event dashboard loader — this one never touches
 * rollups, Meta insights, or active-creatives; it's an audit view.
 */

export interface ClientRolloutEventRow {
  event: EventWithClient;
  readiness: ReadinessResult;
  share: {
    token: string;
    can_edit: boolean;
    enabled: boolean;
    scope: string | null;
    event_id: string | null;
  } | null;
  ticketingLinks: EventTicketingLink[];
  ticketingConnections: TicketingConnection[];
  primaryConnection: TicketingConnection | null;
}

export interface ClientRolloutData {
  client: ClientRow;
  events: ClientRolloutEventRow[];
  counts: { ready: number; partial: number; blocked: number; total: number };
}

function eventCmp(
  a: EventWithClient,
  b: EventWithClient,
): number {
  const aTs = a.event_date ? Date.parse(a.event_date) : 0;
  const bTs = b.event_date ? Date.parse(b.event_date) : 0;
  return bTs - aTs;
}

/**
 * Return null when the client id is unknown or the authed user does not
 * own the row. `events` always comes back filtered to `userId` (RLS
 * already does this but belt-and-braces).
 */
export async function loadClientRollout(
  clientId: string,
  userId: string,
): Promise<ClientRolloutData | null> {
  const client = await getClientByIdServer(clientId);
  if (!client || client.user_id !== userId) return null;

  const supabase = await createClient();
  const [events, connections] = await Promise.all([
    listEventsServer(userId, { clientId }),
    listConnectionsForUser(supabase, { clientId }),
  ]);

  const eventIds = events.map((e) => e.id);
  const [linksByEvent, sharesByEvent] = await Promise.all([
    fetchLinksForEvents(supabase, eventIds),
    fetchSharesForEvents(supabase, eventIds),
  ]);

  const nowMs = Date.now();
  const rows: ClientRolloutEventRow[] = events
    .slice()
    .sort(eventCmp)
    .map((event) => {
      const evLinks = linksByEvent.get(event.id) ?? [];
      const share = sharesByEvent.get(event.id) ?? null;
      const primary =
        connections.find((c) =>
          evLinks.some((l) => l.connection_id === c.id),
        ) ?? connections[0] ?? null;
      const readiness = computeEventReadiness({
        event: {
          id: event.id,
          name: event.name,
          event_code: event.event_code,
          capacity: event.capacity,
          event_date: event.event_date,
          general_sale_at: event.general_sale_at,
          kind: event.kind,
        },
        client: { meta_ad_account_id: client.meta_ad_account_id ?? null },
        ticketingLinks: evLinks.map((l) => ({
          connection_id: l.connection_id,
          external_event_id: l.external_event_id,
        })),
        ticketingConnections: connections.map((c) => ({
          id: c.id,
          provider: c.provider,
          status: c.status,
        })),
        share,
        nowMs,
      });
      return {
        event,
        readiness,
        share,
        ticketingLinks: evLinks,
        ticketingConnections: connections,
        primaryConnection: primary,
      };
    });

  const counts = {
    total: rows.length,
    ready: rows.filter((r) => r.readiness.status === "ready").length,
    partial: rows.filter((r) => r.readiness.status === "partial").length,
    blocked: rows.filter((r) => r.readiness.status === "blocked").length,
  };

  return { client, events: rows, counts };
}

type AnySupabase = Awaited<ReturnType<typeof createClient>>;

async function fetchLinksForEvents(
  supabase: AnySupabase,
  eventIds: string[],
): Promise<Map<string, EventTicketingLink[]>> {
  const out = new Map<string, EventTicketingLink[]>();
  if (eventIds.length === 0) return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb
    .from("event_ticketing_links")
    .select("*")
    .in("event_id", eventIds);
  if (error) {
    console.warn("[client-rollout fetchLinksForEvents]", error.message);
    return out;
  }
  for (const row of (data ?? []) as EventTicketingLink[]) {
    const bucket = out.get(row.event_id) ?? [];
    bucket.push(row);
    out.set(row.event_id, bucket);
  }
  return out;
}

export interface RolloutShareRow {
  token: string;
  can_edit: boolean;
  enabled: boolean;
  scope: string | null;
  event_id: string | null;
}

async function fetchSharesForEvents(
  supabase: AnySupabase,
  eventIds: string[],
): Promise<Map<string, RolloutShareRow>> {
  const out = new Map<string, RolloutShareRow>();
  if (eventIds.length === 0) return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb
    .from("report_shares")
    .select("token, event_id, can_edit, enabled, scope")
    .in("event_id", eventIds);
  if (error) {
    console.warn("[client-rollout fetchSharesForEvents]", error.message);
    return out;
  }
  for (const row of (data ?? []) as RolloutShareRow[]) {
    if (row.event_id) out.set(row.event_id, row);
  }
  return out;
}
