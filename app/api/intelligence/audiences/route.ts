import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type {
  AudienceEventSummary,
  AudienceQueryResponse,
} from "@/lib/types/intelligence";

/**
 * GET /api/intelligence/audiences?eventIds=&artistIds=&venueIds=&genres=&dateFrom=&dateTo=
 *
 * Cross-event query: starts from events filtered by the provided params,
 * then joins event_artists → artists for the artist roster on each row.
 * Returns:
 *   {
 *     events: AudienceEventSummary[],
 *     totalCapacity: number,
 *     genreBreakdown: { [genre]: count },
 *     geoBreakdown:   { [city]:  count },
 *   }
 *
 * All filters are optional. RLS scopes everything to the signed-in user.
 */

function csv(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const eventIds = csv(sp.get("eventIds"));
  const artistIds = csv(sp.get("artistIds"));
  const venueIds = csv(sp.get("venueIds"));
  const genres = csv(sp.get("genres"));
  const dateFrom = sp.get("dateFrom") ?? null;
  const dateTo = sp.get("dateTo") ?? null;

  // Base events query — RLS bound. We pull the embedded client name for
  // the table column. Status, capacity, venue text + venue_id all flow
  // through so the right panel can render without a follow-up fetch.
  let query = supabase
    .from("events")
    .select(
      "id, name, client_id, event_date, capacity, venue_name, venue_city, venue_id, genres, status, client:clients ( name )",
    )
    .eq("user_id", user.id)
    .order("event_date", { ascending: false, nullsFirst: false });

  if (eventIds.length > 0) query = query.in("id", eventIds);
  if (venueIds.length > 0) query = query.in("venue_id", venueIds);
  if (genres.length > 0) query = query.overlaps("genres", genres);
  if (dateFrom) query = query.gte("event_date", dateFrom);
  if (dateTo) query = query.lte("event_date", dateTo);

  const { data: eventRows, error } = await query;
  if (error) {
    console.warn("[/api/intelligence/audiences] events query error:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  type EventRow = {
    id: string;
    name: string;
    client_id: string | null;
    event_date: string | null;
    capacity: number | null;
    venue_name: string | null;
    venue_city: string | null;
    venue_id: string | null;
    genres: string[];
    status: string;
    client: { name: string | null } | null;
  };

  const events = (eventRows as unknown as EventRow[]) ?? [];

  // Artist join — fetch event_artists for the candidate event ids, then
  // hydrate artist names. When artistIds filter is provided we further
  // restrict the event set to those that include any of the named artists.
  let eventIdsForArtistLookup = events.map((e) => e.id);

  type EARow = {
    event_id: string;
    artist_id: string;
    is_headliner: boolean;
    artist: { name: string | null } | null;
  };

  let eaRows: EARow[] = [];
  if (eventIdsForArtistLookup.length > 0) {
    const { data: ea, error: eaErr } = await supabase
      .from("event_artists" as never)
      .select("event_id, artist_id, is_headliner, artist:artists ( name )")
      .in("event_id", eventIdsForArtistLookup);
    if (eaErr) {
      console.warn(
        "[/api/intelligence/audiences] event_artists query error:",
        eaErr.message,
      );
    } else {
      eaRows = (ea as unknown as EARow[]) ?? [];
    }
  }

  // Artist filter is post-fetch because PostgREST can't do "events whose
  // event_artists.artist_id is in (...)" in one query without RPC. The
  // candidate set is small (RLS bounded) so this is cheap.
  let filteredEvents = events;
  if (artistIds.length > 0) {
    const matchingEventIds = new Set(
      eaRows.filter((r) => artistIds.includes(r.artist_id)).map((r) => r.event_id),
    );
    filteredEvents = events.filter((e) => matchingEventIds.has(e.id));
    eventIdsForArtistLookup = filteredEvents.map((e) => e.id);
  }

  // Build per-event artist arrays (after the artist filter so the response
  // stays consistent with the filtered event set).
  const artistsByEvent = new Map<string, AudienceEventSummary["artists"]>();
  for (const row of eaRows) {
    if (!eventIdsForArtistLookup.includes(row.event_id)) continue;
    const arr = artistsByEvent.get(row.event_id) ?? [];
    arr.push({
      name: row.artist?.name ?? "(unknown)",
      isHeadliner: row.is_headliner,
    });
    artistsByEvent.set(row.event_id, arr);
  }

  const summaries: AudienceEventSummary[] = filteredEvents.map((e) => ({
    id: e.id,
    name: e.name,
    client_id: e.client_id,
    client_name: e.client?.name ?? null,
    event_date: e.event_date,
    capacity: e.capacity,
    venue_name: e.venue_name,
    venue_city: e.venue_city,
    genres: e.genres ?? [],
    artists: artistsByEvent.get(e.id) ?? [],
    status: e.status,
  }));

  let totalCapacity = 0;
  const genreBreakdown: Record<string, number> = {};
  const geoBreakdown: Record<string, number> = {};
  for (const e of summaries) {
    if (typeof e.capacity === "number") totalCapacity += e.capacity;
    for (const g of e.genres) {
      genreBreakdown[g] = (genreBreakdown[g] ?? 0) + 1;
    }
    if (e.venue_city) {
      geoBreakdown[e.venue_city] = (geoBreakdown[e.venue_city] ?? 0) + 1;
    }
  }

  const body: AudienceQueryResponse & { ok: true } = {
    ok: true,
    events: summaries,
    totalCapacity,
    genreBreakdown,
    geoBreakdown,
  };

  return NextResponse.json(body);
}
