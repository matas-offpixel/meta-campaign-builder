import { NextResponse, type NextRequest } from "next/server";

import { getConnectionWithDecryptedCredentials } from "@/lib/db/ticketing";
import { createClient } from "@/lib/supabase/server";
import { eventbriteGet } from "@/lib/ticketing/eventbrite/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RequestBody {
  client_id?: unknown;
  connection_id?: unknown;
  dry_run?: unknown;
}

interface EventbriteTicketClass {
  quantity_total?: number | null;
  quantity_sold?: number | null;
}

interface EventbriteListEvent {
  id: string;
  name?: { text?: string | null } | null;
  url?: string | null;
  start?: { utc?: string | null } | null;
  status?: string | null;
  capacity?: number | null;
  venue?: {
    name?: string | null;
    address?: {
      city?: string | null;
      localized_address_display?: string | null;
    } | null;
  } | null;
  ticket_classes?: EventbriteTicketClass[] | null;
}

interface EventbriteEventListResponse {
  pagination?: {
    page_number?: number;
    page_count?: number;
    has_more_items?: boolean;
  };
  events?: EventbriteListEvent[];
}

function readPersonalToken(connection: { credentials?: Record<string, unknown> }): string {
  const raw = connection.credentials?.["personal_token"];
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("Eventbrite connection is missing personal_token.");
  }
  return raw.trim();
}

function venueName(event: EventbriteListEvent): string | null {
  return (
    event.venue?.name ??
    event.venue?.address?.localized_address_display ??
    event.venue?.address?.city ??
    null
  );
}

function ticketTotals(event: EventbriteListEvent): {
  capacity: number | null;
  ticketsSold: number | null;
} {
  const ticketClasses = event.ticket_classes ?? [];
  if (ticketClasses.length === 0) {
    return { capacity: event.capacity ?? null, ticketsSold: null };
  }
  let capacity = 0;
  let ticketsSold = 0;
  let hasCapacity = false;
  let hasSold = false;
  for (const ticketClass of ticketClasses) {
    if (typeof ticketClass.quantity_total === "number") {
      capacity += ticketClass.quantity_total;
      hasCapacity = true;
    }
    if (typeof ticketClass.quantity_sold === "number") {
      ticketsSold += ticketClass.quantity_sold;
      hasSold = true;
    }
  }
  return {
    capacity: hasCapacity ? capacity : event.capacity ?? null,
    ticketsSold: hasSold ? ticketsSold : null,
  };
}

function shouldSkipEvent(event: EventbriteListEvent, cutoffMs: number): boolean {
  if (!event.start?.utc) return false;
  const startsAt = Date.parse(event.start.utc);
  return Number.isFinite(startsAt) && startsAt < cutoffMs;
}

export async function POST(req: NextRequest) {
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const clientId =
    typeof body.client_id === "string" && body.client_id.trim()
      ? body.client_id.trim()
      : null;
  const connectionId =
    typeof body.connection_id === "string" && body.connection_id.trim()
      ? body.connection_id.trim()
      : null;
  const dryRun = body.dry_run === true;

  let query = userClient
    .from("client_ticketing_connections")
    .select("id, user_id, client_id, provider, status")
    .eq("user_id", user.id)
    .eq("provider", "eventbrite");
  if (clientId) query = query.eq("client_id", clientId);
  if (connectionId) query = query.eq("id", connectionId);

  const { data: connections, error: connErr } = await query;
  if (connErr) {
    return NextResponse.json(
      { ok: false, error: connErr.message },
      { status: 500 },
    );
  }
  if (!connections || connections.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No Eventbrite connection found." },
      { status: 404 },
    );
  }

  const cutoffMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const now = new Date().toISOString();
  const results = [];

  for (const connection of connections) {
    if (connection.status === "paused") {
      results.push({
        connection_id: connection.id,
        fetched: 0,
        skipped_old: 0,
        upserted: 0,
        error: "Connection is paused.",
      });
      continue;
    }

    try {
      const decrypted = await getConnectionWithDecryptedCredentials(
        userClient,
        connection.id,
      );
      if (!decrypted) throw new Error("Connection credentials not found.");
      const token = readPersonalToken(decrypted);

      const rows = [];
      let fetched = 0;
      let skippedOld = 0;
      for (let page = 1; page <= 20 && fetched < 1000; page++) {
        const response = await eventbriteGet<EventbriteEventListResponse>(
          token,
          "/users/me/events/",
          {
            query: {
              status: "live",
              order_by: "start_desc",
              expand: "venue,ticket_classes",
              page,
            },
            timeoutMs: 15000,
          },
        );
        const events = response.events ?? [];
        for (const event of events) {
          fetched += 1;
          if (shouldSkipEvent(event, cutoffMs)) {
            skippedOld += 1;
            continue;
          }
          const totals = ticketTotals(event);
          rows.push({
            user_id: user.id,
            client_id: connection.client_id,
            connection_id: connection.id,
            provider: "eventbrite",
            external_event_id: event.id,
            event_name: event.name?.text ?? "(untitled)",
            venue: venueName(event),
            start_date: event.start?.utc ?? null,
            url: event.url ?? null,
            capacity: totals.capacity,
            tickets_sold: totals.ticketsSold,
            status: event.status ?? null,
            raw_payload: event,
            last_synced_at: now,
            updated_at: now,
          });
        }
        if (!response.pagination?.has_more_items) break;
      }

      if (!dryRun && rows.length > 0) {
        const { error: upsertErr } = await userClient
          .from("external_event_candidates")
          .upsert(rows, { onConflict: "connection_id,external_event_id" });
        if (upsertErr) throw new Error(upsertErr.message);
      }

      results.push({
        connection_id: connection.id,
        fetched,
        skipped_old: skippedOld,
        upserted: dryRun ? 0 : rows.length,
        dry_run: dryRun,
        error: null,
      });
    } catch (err) {
      results.push({
        connection_id: connection.id,
        fetched: 0,
        skipped_old: 0,
        upserted: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    client_id: clientId,
    results,
    total_fetched: results.reduce((sum, result) => sum + result.fetched, 0),
    total_upserted: results.reduce((sum, result) => sum + result.upserted, 0),
  });
}
