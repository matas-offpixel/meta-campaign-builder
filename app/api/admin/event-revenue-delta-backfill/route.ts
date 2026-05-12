/**
 * POST /api/admin/event-revenue-delta-backfill
 *
 * Re-computes event_daily_rollups.revenue as a daily DELTA (not cumulative) for
 * events using 4thefans or foursomething_internal ticketing. Idempotent: always
 * overwrites the revenue column from snapshot history; never touches tickets_sold
 * or any Meta spend column.
 *
 * Body: { event_id?: string, dry_run?: boolean }
 *   event_id omitted → backfills all events for the authenticated user
 */
import { NextResponse, type NextRequest } from "next/server";

import {
  reconstructFourthefansRollupDeltas,
  type FourthefansSnapshotForBackfill,
} from "@/lib/ticketing/fourthefans-rollup-backfill";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RequestBody {
  event_id?: unknown;
  dry_run?: unknown;
}

interface EventResult {
  event_id: string;
  snapshots_read: number;
  rows_computed: number;
  rows_written: number;
  first_date: string | null;
  last_date: string | null;
  total_revenue: number;
  error?: string;
}

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
    typeof body.event_id === "string" && body.event_id.trim()
      ? body.event_id.trim()
      : null;
  const dryRun = body.dry_run === true;

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

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  if (eventId) {
    const { data: event, error: eventErr } = await admin
      .from("events")
      .select("id, user_id")
      .eq("id", eventId)
      .maybeSingle();
    if (eventErr) {
      return NextResponse.json({ ok: false, error: eventErr.message }, { status: 500 });
    }
    if (!event) {
      return NextResponse.json({ ok: false, error: "Event not found" }, { status: 404 });
    }
    if ((event.user_id as string | null) !== user.id) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
  }

  const snapshotsResult = await loadSnapshots(admin, { userId: user.id, eventId });
  if (!snapshotsResult.ok) {
    return NextResponse.json({ ok: false, error: snapshotsResult.error }, { status: 500 });
  }

  const byEvent = groupByEvent(snapshotsResult.rows);
  const results: EventResult[] = [];

  for (const [evtId, eventSnapshots] of byEvent) {
    try {
      // Pass empty existingRollups — no date protection; always recompute revenue.
      const computed = reconstructFourthefansRollupDeltas(eventSnapshots, []);
      if (!dryRun && computed.length > 0) {
        await upsertRevenue(admin, evtId, computed);
      }
      results.push({
        event_id: evtId,
        snapshots_read: eventSnapshots.length,
        rows_computed: computed.length,
        rows_written: dryRun ? 0 : computed.length,
        first_date: computed[0]?.date ?? null,
        last_date: computed[computed.length - 1]?.date ?? null,
        total_revenue: round2(computed.reduce((s, r) => s + (r.revenue ?? 0), 0)),
      });
    } catch (err) {
      results.push({
        event_id: evtId,
        snapshots_read: eventSnapshots.length,
        rows_computed: 0,
        rows_written: 0,
        first_date: null,
        last_date: null,
        total_revenue: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const failed = results.filter((r) => r.error);
  return NextResponse.json(
    {
      ok: failed.length === 0,
      dry_run: dryRun,
      events_processed: results.length,
      rows_written: results.reduce((s, r) => s + r.rows_written, 0),
      results,
    },
    { status: failed.length === 0 ? 200 : 207 },
  );
}

async function loadSnapshots(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  args: { userId: string; eventId: string | null },
): Promise<{ ok: true; rows: FourthefansSnapshotForBackfill[] } | { ok: false; error: string }> {
  let query = admin
    .from("ticket_sales_snapshots")
    .select("event_id, user_id, snapshot_at, tickets_sold, gross_revenue_cents")
    .eq("user_id", args.userId)
    .in("source", ["fourthefans", "foursomething"])
    .order("event_id", { ascending: true })
    .order("snapshot_at", { ascending: true });
  if (args.eventId) {
    query = query.eq("event_id", args.eventId);
  }
  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []) as FourthefansSnapshotForBackfill[] };
}

async function upsertRevenue(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  eventId: string,
  rows: Array<{ user_id: string; event_id: string; date: string; revenue: number | null }>,
): Promise<void> {
  const { error } = await admin.from("event_daily_rollups").upsert(
    rows.map((row) => ({
      user_id: row.user_id,
      event_id: row.event_id,
      date: row.date,
      revenue: row.revenue,
    })),
    { onConflict: "event_id,date" },
  );
  if (error) throw new Error(`event_id=${eventId}: ${error.message}`);
}

function groupByEvent(
  snapshots: FourthefansSnapshotForBackfill[],
): Map<string, FourthefansSnapshotForBackfill[]> {
  const byEvent = new Map<string, FourthefansSnapshotForBackfill[]>();
  for (const snap of snapshots) {
    const rows = byEvent.get(snap.event_id) ?? [];
    rows.push(snap);
    byEvent.set(snap.event_id, rows);
  }
  return byEvent;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
