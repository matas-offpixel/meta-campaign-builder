import { NextResponse } from "next/server";

import { getEventByIdServer } from "@/lib/db/events-server";
import { loadEventFunnelView } from "@/lib/db/event-funnel-load";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/events/[id]/funnel
 *
 * Lifetime funnel for the event report (Phase A.1). Session auth +
 * event ownership via getEventByIdServer.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const event = await getEventByIdServer(id);
  if (!event) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  try {
    const funnel = await loadEventFunnelView(supabase, id);
    return NextResponse.json({ ok: true, funnel });
  } catch (err) {
    const message = err instanceof Error ? err.message : "funnel load failed";
    console.warn("[api/events/funnel]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
