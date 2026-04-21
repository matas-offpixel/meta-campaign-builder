import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getConnectionById } from "@/lib/db/ticketing";
import { getProvider } from "@/lib/ticketing/registry";
import { TicketingProviderDisabledError } from "@/lib/ticketing/types";

/**
 * GET /api/ticketing/events?connectionId=X
 *
 * Lists external events visible to the connection, used by the linking
 * UI ("which Eventbrite event corresponds to this internal event?").
 *
 * Bounded server-side by the provider implementation (Eventbrite caps
 * at 5 pages = 250 events). The dashboard further filters client-side.
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

  const connectionId = req.nextUrl.searchParams.get("connectionId");
  if (!connectionId) {
    return NextResponse.json(
      { ok: false, error: "connectionId is required" },
      { status: 400 },
    );
  }

  const connection = await getConnectionById(supabase, connectionId);
  if (!connection || connection.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Connection not found" },
      { status: 404 },
    );
  }
  if (connection.status === "paused") {
    return NextResponse.json(
      { ok: false, error: "Connection is paused. Re-enable it to list events." },
      { status: 400 },
    );
  }

  try {
    const provider = getProvider(connection.provider);
    const events = await provider.listEvents(connection);
    return NextResponse.json({ ok: true, events });
  } catch (err) {
    if (err instanceof TicketingProviderDisabledError) {
      return NextResponse.json(
        { ok: false, error: err.message, disabled: true },
        { status: 503 },
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[ticketing GET /events]", message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 },
    );
  }
}
