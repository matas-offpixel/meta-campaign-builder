import { NextResponse, type NextRequest } from "next/server";

import { backfillFourthefansHistory } from "@/lib/db/event-history-backfill";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RequestBody {
  eventId?: unknown;
  from?: unknown;
  to?: unknown;
  force?: unknown;
}

/**
 * POST /api/admin/event-history-backfill
 *
 * Backfills `ticket_sales_snapshots` (source=fourthefans) from the 4TheFans
 * GET /events/{id}/sales daily history endpoint. Requires a signed-in owner
 * of the event. Uses the service-role client for writes so `--force` updates
 * can succeed (snapshots table has no RLS UPDATE policy).
 */
export async function POST(req: NextRequest) {
  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const eventId =
    typeof body.eventId === "string" && body.eventId.trim()
      ? body.eventId.trim()
      : null;
  if (!eventId) {
    return NextResponse.json(
      { ok: false, error: "eventId is required" },
      { status: 400 },
    );
  }

  const from =
    typeof body.from === "string" && body.from.trim() ? body.from.trim() : undefined;
  const to =
    typeof body.to === "string" && body.to.trim() ? body.to.trim() : undefined;
  const force = body.force === true;

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const { data: event, error: eventErr } = await userClient
    .from("events")
    .select("id, user_id")
    .eq("id", eventId)
    .maybeSingle();

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
  if ((event as { user_id: string }).user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
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

  try {
    const result = await backfillFourthefansHistory(
      eventId,
      { from, to, force },
      { supabase: admin },
    );
    return NextResponse.json({
      ok: true,
      eventId,
      inserted: result.inserted,
      skipped: result.skipped,
      window: result.window,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
