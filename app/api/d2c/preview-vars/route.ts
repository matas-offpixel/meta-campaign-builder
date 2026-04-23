import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { listEventArtists } from "@/lib/db/event-artists";
import { getEventByIdServer } from "@/lib/db/events-server";
import { resolveEventVariables } from "@/lib/d2c/event-variables";

/**
 * GET ?eventId= — resolved known template variables for an event (auth required).
 */
export async function GET(req: NextRequest) {
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

  const eventId = req.nextUrl.searchParams.get("eventId")?.trim() ?? "";
  if (!eventId) {
    return NextResponse.json(
      { ok: false, error: "eventId is required" },
      { status: 400 },
    );
  }

  const event = await getEventByIdServer(eventId);
  if (!event || event.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Event not found" },
      { status: 404 },
    );
  }

  const artists = await listEventArtists(eventId);
  const headliners = artists
    .filter((a) => a.is_headliner)
    .map((a) => a.artist_name);

  const resolved = resolveEventVariables(
    {
      name: event.name,
      event_date: event.event_date,
      event_start_at: event.event_start_at,
      event_timezone: event.event_timezone,
      ticket_url: event.ticket_url,
      presale_at: event.presale_at,
      general_sale_at: event.general_sale_at,
      venue_name: event.venue_name,
      venue_city: event.venue_city,
    },
    { artistHeadliners: headliners.length ? headliners : undefined },
  );

  return NextResponse.json({
    ok: true,
    variables: resolved as Record<string, string>,
  });
}
