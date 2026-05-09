import { NextResponse, type NextRequest } from "next/server";

import { upsertDailyHistory } from "@/lib/db/tier-channel-daily-history";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/snapshot-tier-channel-sales
 *
 * Manually capture today's (or a specified date's) tier_channel_sales
 * SUM for one event. source_kind = 'manual_backfill'.
 *
 * Body: { eventId: string, snapshotDate?: string (YYYY-MM-DD) }
 *
 * Useful for:
 *   - New client onboarding: capture the current total before the
 *     nightly cron starts running.
 *   - Testing: force a snapshot for a past date.
 *   - Quick one-off corrections without a smoothing run.
 *
 * Requires the caller to be signed in as the event owner (cookie auth).
 */

function todayInLondon(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

interface RequestBody {
  eventId?: unknown;
  snapshotDate?: unknown;
}

export async function POST(req: NextRequest) {
  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const eventId =
    typeof body.eventId === "string" && body.eventId.trim()
      ? body.eventId.trim()
      : null;
  if (!eventId) {
    return NextResponse.json({ ok: false, error: "eventId is required" }, { status: 400 });
  }

  const snapshotDate =
    typeof body.snapshotDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.snapshotDate)
      ? body.snapshotDate
      : todayInLondon();

  // Auth: signed-in user must own the event.
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const { data: event, error: eventErr } = await userClient
    .from("events")
    .select("id, user_id")
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr || !event) {
    return NextResponse.json(
      { ok: false, error: eventErr?.message ?? "Event not found" },
      { status: eventErr ? 500 : 404 },
    );
  }

  const supabase = await createServiceRoleClient();

  // Read the full tier_channel_sales SUM for this event.
  const { data: salesRows, error: salesErr } = await supabase
    .from("tier_channel_sales")
    .select("tickets_sold, revenue_amount")
    .eq("event_id", eventId);
  if (salesErr) {
    return NextResponse.json({ ok: false, error: salesErr.message }, { status: 500 });
  }

  const totalTickets = (salesRows ?? []).reduce(
    (s, r) => s + Number(r.tickets_sold ?? 0),
    0,
  );
  const totalRevenue = (salesRows ?? []).reduce(
    (s, r) => s + Number(r.revenue_amount ?? 0),
    0,
  );

  const row = await upsertDailyHistory(supabase, {
    event_id: eventId,
    snapshot_date: snapshotDate,
    tickets_sold_total: totalTickets,
    revenue_total: totalRevenue,
    source_kind: "manual_backfill",
  });

  return NextResponse.json({
    ok: true,
    row,
    totalTickets,
    totalRevenue,
    snapshotDate,
  });
}
