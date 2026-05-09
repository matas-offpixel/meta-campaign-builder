import { NextResponse, type NextRequest } from "next/server";

import { bulkUpsertDailyHistory } from "@/lib/db/tier-channel-daily-history";
import {
  computeSmoothedHistory,
  type SmoothingEnvelopeStep,
} from "@/lib/dashboard/tier-channel-smoothing";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/smooth-historical-tier-channel-sales
 *
 * One-shot backfill that distributes the gap between the
 * `ticket_sales_snapshots` monotonic envelope and the current
 * `tier_channel_sales` SUM proportionally across a date window,
 * writing the result to `tier_channel_sales_daily_history` with
 * source_kind = 'smoothed_historical'.
 *
 * Run once per event after migration 089 lands to eliminate the
 * "all tickets land on today" spike visible before the nightly cron
 * started building history.
 *
 * Body:
 *   {
 *     eventId: string,           required
 *     fromDate: string,          required — YYYY-MM-DD
 *     toDate: string,            required — YYYY-MM-DD (typically yesterday)
 *   }
 *
 * The endpoint reads `tier_channel_sales` SUM and
 * `ticket_sales_snapshots` directly from the DB — no caller-supplied
 * totals, to avoid incorrect inputs.
 *
 * Idempotent: calling it twice produces the same rows (all upserted).
 * Requires the caller to be signed in as the event owner.
 */

interface RequestBody {
  eventId?: unknown;
  fromDate?: unknown;
  toDate?: unknown;
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
  const fromDate =
    typeof body.fromDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fromDate)
      ? body.fromDate
      : null;
  const toDate =
    typeof body.toDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.toDate)
      ? body.toDate
      : null;

  if (!eventId) {
    return NextResponse.json({ ok: false, error: "eventId is required" }, { status: 400 });
  }
  if (!fromDate || !toDate) {
    return NextResponse.json(
      { ok: false, error: "fromDate and toDate are required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }
  if (fromDate > toDate) {
    return NextResponse.json(
      { ok: false, error: "fromDate must be <= toDate" },
      { status: 400 },
    );
  }

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

  // 1. Current all-channel SUM from tier_channel_sales.
  const { data: salesRows, error: salesErr } = await supabase
    .from("tier_channel_sales")
    .select("tickets_sold, revenue_amount")
    .eq("event_id", eventId);
  if (salesErr) {
    return NextResponse.json({ ok: false, error: salesErr.message }, { status: 500 });
  }
  const currentTotalTickets = (salesRows ?? []).reduce(
    (s, r) => s + Number(r.tickets_sold ?? 0),
    0,
  );
  const currentTotalRevenue = (salesRows ?? []).reduce(
    (s, r) => s + Number(r.revenue_amount ?? 0),
    0,
  );

  if (currentTotalTickets === 0) {
    return NextResponse.json({
      ok: true,
      message: "No tier_channel_sales rows for this event — nothing to smooth",
      rowsWritten: 0,
    });
  }

  // 2. Fetch ticket_sales_snapshots for this event (all sources).
  //    We reconstruct the per-event monotonic envelope here without
  //    importing the full venue-trend-points module (keeps the
  //    route lean and avoids server-only boundary issues).
  const { data: snapshotRows, error: snapErr } = await supabase
    .from("ticket_sales_snapshots")
    .select("snapshot_at, tickets_sold")
    .eq("event_id", eventId)
    .order("snapshot_at", { ascending: true });
  if (snapErr) {
    return NextResponse.json({ ok: false, error: snapErr.message }, { status: 500 });
  }

  // Build the per-event monotonic envelope (same logic as
  // buildEventCumulativeTicketTimeline but inline to avoid the import).
  const maxByDate = new Map<string, number>();
  for (const row of snapshotRows ?? []) {
    const date = String(row.snapshot_at).slice(0, 10);
    const val = Number(row.tickets_sold ?? 0);
    const cur = maxByDate.get(date);
    if (cur === undefined || val > cur) maxByDate.set(date, val);
  }
  const sortedDates = [...maxByDate.keys()].sort();
  const envelopeSteps: SmoothingEnvelopeStep[] = [];
  let runningMax = 0;
  for (const date of sortedDates) {
    const val = maxByDate.get(date) ?? 0;
    if (val > runningMax) runningMax = val;
    envelopeSteps.push({ date, cumulative: runningMax });
  }

  // 3. Compute smoothed history for [fromDate..toDate].
  const smoothed = computeSmoothedHistory(
    fromDate,
    toDate,
    currentTotalTickets,
    currentTotalRevenue,
    envelopeSteps,
  );

  if (smoothed.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "Date window produced no rows",
      rowsWritten: 0,
    });
  }

  // 4. Bulk-upsert.
  const payload = smoothed.map((row) => ({
    event_id: eventId,
    snapshot_date: row.date,
    tickets_sold_total: row.tickets,
    revenue_total: row.revenue,
    source_kind: "smoothed_historical" as const,
  }));

  const { written, errors } = await bulkUpsertDailyHistory(supabase, payload);

  return NextResponse.json({
    ok: errors === 0,
    eventId,
    fromDate,
    toDate,
    currentTotalTickets,
    currentTotalRevenue,
    envelopeStepsUsed: envelopeSteps.length,
    rowsWritten: written,
    errors: errors > 0 ? errors : undefined,
    sample: smoothed.slice(0, 3).concat(smoothed.slice(-3)),
  });
}
