import { NextResponse, type NextRequest } from "next/server";

import {
  listAllocationsForEvents,
  listChannelsForClient,
  listSalesForEvents,
} from "@/lib/db/tier-channels";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/events/[id]/tier-channels
 *
 * Cookie-auth read of the channel set + allocations + sales for events
 * sharing the given event's (client_id, event_code) — i.e. the venue
 * group the event belongs to. Returns the same shape as the share-
 * token version so MultiChannelTicketEntryCard can hit either endpoint
 * without forking its render path.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorised" },
      { status: 401 },
    );
  }

  const { data: anchor } = await supabase
    .from("events")
    .select("id, client_id, event_code, user_id")
    .eq("id", eventId)
    .maybeSingle();
  if (
    !anchor ||
    (anchor as { user_id?: string | null }).user_id !== user.id
  ) {
    return NextResponse.json(
      { ok: false, error: "Not found" },
      { status: 404 },
    );
  }

  const clientId = (anchor as { client_id: string }).client_id;
  const eventCode = (anchor as { event_code: string | null }).event_code;
  if (!clientId || !eventCode) {
    return NextResponse.json({
      ok: true,
      channels: [],
      allocations: [],
      sales: [],
      can_edit: true,
    });
  }

  const { data: events } = await supabase
    .from("events")
    .select("id")
    .eq("client_id", clientId)
    .eq("event_code", eventCode)
    .eq("user_id", user.id);
  const eventIds = (events ?? []).map((row) => row.id);

  const [channels, allocations, sales] = await Promise.all([
    listChannelsForClient(supabase, clientId),
    listAllocationsForEvents(supabase, eventIds),
    listSalesForEvents(supabase, eventIds),
  ]);

  return NextResponse.json({
    ok: true,
    channels,
    allocations,
    sales,
    can_edit: true,
  });
}
