import { NextResponse, type NextRequest } from "next/server";

import { assertVenueShareTokenWritable } from "@/lib/db/share-token-venue-write-scope";
import {
  listAllocationsForEvents,
  listChannelsForClient,
  listSalesForEvents,
} from "@/lib/db/tier-channels";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/share/venue/[token]/tier-channels
 *
 * Token-scoped read of the channel set + per-event allocations + per-
 * event sales for the events under the venue share. Used by the
 * MultiChannelTicketEntryCard to populate its initial state. View-only
 * tokens succeed (requireCanEdit=false).
 *
 * Response shape mirrors the server-side payload — `channels` is the
 * channel lookup for the client, `allocations` and `sales` are flat
 * arrays the client filters by event_id.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  const scope = await assertVenueShareTokenWritable(token, supabase, {
    requireCanEdit: false,
    eventId: req.nextUrl.searchParams.get("event_id") ?? undefined,
  });
  if (!scope.ok) {
    return NextResponse.json(scope.body, { status: scope.status });
  }

  const { data: events } = await supabase
    .from("events")
    .select("id")
    .eq("client_id", scope.clientId)
    .eq("event_code", scope.eventCode);
  const eventIds = (events ?? []).map((row) => row.id);

  const [channels, allocations, sales] = await Promise.all([
    listChannelsForClient(supabase, scope.clientId),
    listAllocationsForEvents(supabase, eventIds),
    listSalesForEvents(supabase, eventIds),
  ]);

  return NextResponse.json({
    ok: true,
    channels,
    allocations,
    sales,
    can_edit: scope.canEdit,
  });
}
