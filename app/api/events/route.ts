import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { listEventsServer } from "@/lib/db/events-server";

/**
 * GET /api/events
 *
 * Lightweight list endpoint for client-side pickers (audience builder etc.).
 * Returns the event row plus a flat client_name field — the audience UI
 * needs both. Filters: clientId, status, fromDate, toDate, q (substring).
 *
 * Mirrors lib/db/events-server.ts which is the only consumer's existing
 * server-side equivalent. RLS bounds the read; we still gate on the
 * cookie session so anonymous traffic doesn't reach Supabase.
 */

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const events = await listEventsServer(user.id, {
    clientId: sp.get("clientId") ?? undefined,
    status: (sp.get("status") as never) ?? undefined,
    fromDate: sp.get("fromDate") ?? undefined,
    toDate: sp.get("toDate") ?? undefined,
    q: sp.get("q"),
  });

  return NextResponse.json({
    ok: true,
    events: events.map((e) => ({
      id: e.id,
      name: e.name,
      slug: e.slug,
      event_date: e.event_date,
      status: e.status,
      capacity: e.capacity,
      genres: e.genres,
      venue_name: e.venue_name,
      venue_city: e.venue_city,
      client_id: e.client_id,
      client_name: e.client?.name ?? null,
    })),
  });
}
