import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getEventTicketingSummary } from "@/lib/db/event-ticketing-summary";

/**
 * GET /api/ticketing/eventbrite-stats?eventId=X
 *
 * Re-fetches the same summary the event-detail page builds on the
 * server, so the client-side "Refresh" button on the live Eventbrite
 * block can reload latest snapshot + link state without a full
 * router.refresh() (which would re-run every other server component
 * fetch on the page — heavier than we need).
 *
 * Auth: cookie-bound session. The summary helper goes through the
 * same RLS-scoped queries as the page-load, so a user who can't see
 * the event gets `link: null` + `availableConnections: []` rather
 * than a 403.
 *
 * Performance: this route does NOT trigger a sync — for that the
 * client calls POST /api/ticketing/sync?eventId=X first and then
 * polls this endpoint. Splitting the two keeps refresh idempotent
 * and lets the UI render a "syncing…" state without waiting on
 * Eventbrite's API.
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

  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json(
      { ok: false, error: "eventId is required" },
      { status: 400 },
    );
  }

  // Cheap ownership check first so we surface a clean 404 / 403 instead
  // of relying on the empty-summary degradation path.
  const { data: event, error } = await supabase
    .from("events")
    .select("id, user_id, client_id")
    .eq("id", eventId)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
  if (!event) {
    return NextResponse.json(
      { ok: false, error: "Event not found" },
      { status: 404 },
    );
  }
  if (event.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  const summary = await getEventTicketingSummary(eventId, event.client_id);
  return NextResponse.json({ ok: true, summary });
}
