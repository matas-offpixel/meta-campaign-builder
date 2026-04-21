import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  getConnectionById,
  upsertEventLink,
} from "@/lib/db/ticketing";

/**
 * POST /api/ticketing/links
 *
 * Body:
 *   {
 *     eventId:           string,  // internal events.id
 *     connectionId:      string,
 *     externalEventId:   string,  // provider's event id
 *     externalEventUrl?: string,
 *   }
 *
 * Upserts the pivot row. The unique (event_id, connection_id) index
 * makes this idempotent — re-linking the same event/connection pair
 * just refreshes the external_event_id / url.
 */

interface PostBody {
  eventId?: unknown;
  connectionId?: unknown;
  externalEventId?: unknown;
  externalEventUrl?: unknown;
}

export async function POST(req: NextRequest) {
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

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const eventId =
    typeof body.eventId === "string" ? body.eventId.trim() : "";
  const connectionId =
    typeof body.connectionId === "string" ? body.connectionId.trim() : "";
  const externalEventId =
    typeof body.externalEventId === "string"
      ? body.externalEventId.trim()
      : "";
  const externalEventUrl =
    typeof body.externalEventUrl === "string" && body.externalEventUrl.trim()
      ? body.externalEventUrl.trim()
      : null;

  if (!eventId || !connectionId || !externalEventId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "eventId, connectionId, and externalEventId are all required.",
      },
      { status: 400 },
    );
  }

  // Defensive ownership checks (RLS catches both, but we want explicit
  // 403/404 surfaces for the dashboard error toast).
  const [{ data: event, error: eventErr }, connection] = await Promise.all([
    supabase
      .from("events")
      .select("id, user_id, client_id")
      .eq("id", eventId)
      .maybeSingle(),
    getConnectionById(supabase, connectionId),
  ]);

  if (eventErr) {
    return NextResponse.json(
      { ok: false, error: eventErr.message },
      { status: 500 },
    );
  }
  if (!event) {
    return NextResponse.json(
      { ok: false, error: "Event not found" },
      { status: 404 },
    );
  }
  if (!connection) {
    return NextResponse.json(
      { ok: false, error: "Connection not found" },
      { status: 404 },
    );
  }
  if (event.user_id !== user.id || connection.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 },
    );
  }
  if (event.client_id !== connection.client_id) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Connection belongs to a different client than the event. Connect ticketing on the event's own client first.",
      },
      { status: 400 },
    );
  }

  const link = await upsertEventLink(supabase, {
    userId: user.id,
    eventId,
    connectionId,
    externalEventId,
    externalEventUrl,
  });

  if (!link) {
    return NextResponse.json(
      { ok: false, error: "Failed to persist the link." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, link }, { status: 201 });
}
