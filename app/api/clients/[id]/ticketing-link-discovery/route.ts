import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  getConnectionWithDecryptedCredentials,
  listConnectionsForUser,
} from "@/lib/db/ticketing";
import { getProvider } from "@/lib/ticketing/registry";
import { TicketingProviderDisabledError } from "@/lib/ticketing/types";
import type { ExternalEventSummary } from "@/lib/ticketing/types";
import {
  discoverMatches,
  type ExternalEventForMatching,
  type InternalEventForMatching,
  type MatchResult,
} from "@/lib/ticketing/link-discovery";
import type { SearchableTicketingEvent } from "@/lib/ticketing/event-search";

/**
 * GET /api/clients/[id]/ticketing-link-discovery
 *
 * Read-only "sweep" endpoint backing the internal
 * `/clients/[id]/ticketing-link-discovery` tool. For every event
 * under the client that has NO `event_ticketing_links` row yet, ranks
 * every external event exposed by the client's active Eventbrite
 * (and other) ticketing connections by fuzzy name/venue + date
 * similarity. The operator reviews the candidates and submits the
 * confirmed links via `POST .../bulk-link`.
 *
 * Why a dedicated route instead of reusing `/api/ticketing/events`:
 *   - This route walks *every* connection under the client in one
 *     round trip, rather than per-connection. Saves the UI from
 *     orchestrating N parallel fetches and handling partial failures
 *     at the render layer.
 *   - It pairs the external candidates with the unlinked internal
 *     events server-side, so the browser receives a ready-to-render
 *     table instead of having to join two lists client-side.
 *
 * Shape:
 *   {
 *     ok: true,
 *     events: Array<{
 *       eventId, eventName, eventDate, venueName,
 *       candidates: MatchCandidate[]     // already sorted, top 5
 *     }>,
 *     connections: Array<{
 *       id, provider, external_account_id, status,
 *       externalEventCount: number,
 *       error: string | null             // per-connection soft-fail
 *     }>,
 *   }
 *
 * A per-connection error (e.g. 401 from Eventbrite because the token
 * was rotated) is reported in `connections[].error` without aborting
 * the whole sweep — other connections may still yield candidates.
 */

interface ConnectionDiagnostic {
  id: string;
  provider: string;
  external_account_id: string | null;
  status: string;
  externalEventCount: number;
  error: string | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  // Ownership guard. RLS also enforces this, but we want a clean 404
  // for the dashboard rather than an empty page when the client id
  // is off or belongs to another user.
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (clientErr) {
    return NextResponse.json(
      { ok: false, error: clientErr.message },
      { status: 500 },
    );
  }
  if (!client) {
    return NextResponse.json(
      { ok: false, error: "Client not found" },
      { status: 404 },
    );
  }

  // Every event under the client. We filter unlinked status below via
  // a LEFT join on `event_ticketing_links` — Supabase doesn't expose a
  // WHERE-NULL on join, so we grab all events + links and partition in
  // app code. Roster sizes are small (<< 1000) so one round-trip is
  // cheaper than a second filtered query.
  const { data: events, error: eventsErr } = await supabase
    .from("events")
    .select("id, name, event_date, venue_name, venue_city, capacity")
    .eq("client_id", id)
    .eq("user_id", user.id)
    .order("event_date", { ascending: true });
  if (eventsErr) {
    return NextResponse.json(
      { ok: false, error: eventsErr.message },
      { status: 500 },
    );
  }

  const eventRows = (events ?? []) as InternalEventForMatching[];
  const eventIds = eventRows.map((e) => e.id);

  let linkedEventIds: Set<string> = new Set();
  const linkedExternalKeys = new Set<string>();
  if (eventIds.length > 0) {
    const { data: links, error: linksErr } = await supabase
      .from("event_ticketing_links")
      .select("event_id, connection_id, external_event_id")
      .in("event_id", eventIds);
    if (linksErr) {
      return NextResponse.json(
        { ok: false, error: linksErr.message },
        { status: 500 },
      );
    }
    linkedEventIds = new Set(
      (links ?? []).map((r) => (r as { event_id: string }).event_id),
    );
    for (const link of links ?? []) {
      const row = link as {
        connection_id: string | null;
        external_event_id: string | null;
      };
      if (row.connection_id && row.external_event_id) {
        linkedExternalKeys.add(
          `${row.connection_id}:${row.external_event_id}`,
        );
      }
    }
  }

  const unlinkedEvents = eventRows.filter((e) => !linkedEventIds.has(e.id));

  // Walk every active connection under the client, collecting a flat
  // list of `ExternalEventForMatching` annotated with its source
  // connection so the bulk-link endpoint can round-trip back to the
  // same `connectionId`. A paused or erroring connection still
  // appears in the diagnostics so the operator sees why its events
  // aren't on the list.
  const connections = await listConnectionsForUser(supabase, {
    clientId: id,
  });
  const diagnostics: ConnectionDiagnostic[] = [];
  // externalEventId is NOT globally unique across providers, so the
  // tuple is (connectionId, externalEventId).
  const externalsByConnection = new Map<
    string,
    ExternalEventForMatching[]
  >();
  const searchableExternalEvents: SearchableTicketingEvent[] = [];

  for (const connection of connections) {
    const diag: ConnectionDiagnostic = {
      id: connection.id,
      provider: connection.provider,
      external_account_id: connection.external_account_id,
      status: connection.status,
      externalEventCount: 0,
      error: null,
    };
    diagnostics.push(diag);

    if (connection.status === "paused") {
      diag.error = "Connection is paused — resume it in client settings.";
      continue;
    }

    try {
      const decrypted = await getConnectionWithDecryptedCredentials(
        supabase,
        connection.id,
      );
      if (!decrypted) {
        diag.error = "Connection no longer loadable (credentials missing).";
        continue;
      }
      const provider = getProvider(decrypted.provider);
      const externalEvents: ExternalEventSummary[] = await provider.listEvents(
        decrypted,
      );
      const mapped: ExternalEventForMatching[] = externalEvents.map((ev) => ({
        externalEventId: ev.externalEventId,
        name: ev.name,
        startsAt: ev.startsAt,
        url: ev.url,
        venue: ev.venue ?? null,
        capacity: ev.capacity ?? null,
        status: ev.status,
      }));
      externalsByConnection.set(connection.id, mapped);
      for (const ev of mapped) {
        const key = `${connection.id}:${ev.externalEventId}`;
        if (linkedExternalKeys.has(key)) continue;
        searchableExternalEvents.push({
          externalEventId: ev.externalEventId,
          externalEventName: ev.name,
          externalEventStartsAt: ev.startsAt,
          externalEventUrl: ev.url,
          externalVenue: ev.venue ?? null,
          externalCapacity: ev.capacity ?? null,
          connectionId: connection.id,
          connectionProvider: connection.provider,
        });
      }
      diag.externalEventCount = mapped.length;
    } catch (err) {
      if (err instanceof TicketingProviderDisabledError) {
        diag.error = err.message;
      } else {
        diag.error = err instanceof Error ? err.message : "Unknown error";
      }
    }
  }

  // Produce one match result per unlinked event. When a client has
  // multiple connections (rare but legal — e.g. one Eventbrite + one
  // fourthefans), we score against each pool separately and tag
  // candidates with their source connection so the UI can ladder
  // them side-by-side.
  const byEvent = new Map<string, MatchResult & { candidatesByConnection: Array<{ connectionId: string; connectionProvider: string; candidates: MatchResult["candidates"] }> }>();
  for (const event of unlinkedEvents) {
    byEvent.set(event.id, {
      eventId: event.id,
      eventName: event.name,
      eventDate: event.event_date,
      venueName: event.venue_name,
      skipReason: null,
      candidates: [],
      candidatesByConnection: [],
    });
  }
  for (const [connectionId, externals] of externalsByConnection.entries()) {
    const provider = connections.find((c) => c.id === connectionId)?.provider ?? "unknown";
    const results = discoverMatches(unlinkedEvents, externals);
    for (const r of results) {
      const existing = byEvent.get(r.eventId);
      if (!existing) continue;
      if (r.candidates.length > 0) {
        existing.candidatesByConnection.push({
          connectionId,
          connectionProvider: provider,
          candidates: r.candidates,
        });
      }
    }
  }

  // Flatten across connections for convenience (UI mostly shows the
  // top-N regardless of source). `candidatesByConnection` stays
  // available for tools that want a per-source view later.
  const events_out = Array.from(byEvent.values()).map((r) => {
    const flat = r.candidatesByConnection
      .flatMap((c) =>
        c.candidates.map((cand) => ({
          externalEventId: cand.externalEventId,
          externalEventName: cand.externalName,
          externalEventStartsAt: cand.externalStartsAt,
          externalEventUrl: cand.externalUrl,
          externalVenue: cand.externalVenue,
          externalCapacity: cand.externalCapacity,
          confidence: cand.confidence,
          venueScore: cand.venueScore,
          opponentScore: cand.opponentScore,
          dateScore: cand.dateScore,
          nameScore: cand.nameScore,
          dateMatch: cand.dateMatch,
          capacityMatch: cand.capacityMatch,
          autoSelect: cand.autoSelect,
          autoConfirm: cand.autoConfirm,
          manualDisambiguationRequired: cand.manualDisambiguationRequired,
          connectionId: c.connectionId,
          connectionProvider: c.connectionProvider,
        })),
      )
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
    return {
      eventId: r.eventId,
      eventName: r.eventName,
      eventDate: r.eventDate,
      venueName: r.venueName,
      skipReason: r.skipReason,
      candidates: flat,
      candidatesByConnection: r.candidatesByConnection,
    };
  });

  return NextResponse.json({
    ok: true,
    clientId: id,
    clientName: client.name,
    events: events_out,
    externalEvents: searchableExternalEvents,
    connections: diagnostics,
    unlinkedEventCount: unlinkedEvents.length,
    totalEventCount: eventRows.length,
  });
}
