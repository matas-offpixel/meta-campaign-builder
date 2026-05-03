import { NextResponse, type NextRequest } from "next/server";

import {
  reconstructFourthefansRollupDeltas,
  type ExistingRollupForBackfill,
  type FourthefansBackfillRow,
  type FourthefansSnapshotForBackfill,
} from "@/lib/ticketing/fourthefans-rollup-backfill";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RequestBody {
  event_id?: unknown;
  dry_run?: unknown;
}

interface EventBackfillResult {
  event_id: string;
  snapshots_read: number;
  rows_reconstructed: number;
  rows_written: number;
  skipped_existing_positive: number;
  first_date: string | null;
  last_date: string | null;
  total_tickets: number;
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
        error:
          err instanceof Error
            ? err.message
            : "Service-role client unavailable",
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
    if ((event.user_id as string | null) !== user.id) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 },
      );
    }
  }

  const snapshots = await loadFourthefansSnapshots(admin, {
    userId: user.id,
    eventId,
  });
  if (!snapshots.ok) {
    return NextResponse.json(
      { ok: false, error: snapshots.error },
      { status: 500 },
    );
  }

  const snapshotsByEvent = groupSnapshotsByEvent(snapshots.rows);
  const results: EventBackfillResult[] = [];
  for (const [snapshotEventId, eventSnapshots] of snapshotsByEvent) {
    try {
      const existing = await loadExistingRollups(admin, snapshotEventId);
      if (!existing.ok) {
        results.push({
          event_id: snapshotEventId,
          snapshots_read: eventSnapshots.length,
          rows_reconstructed: 0,
          rows_written: 0,
          skipped_existing_positive: 0,
          first_date: null,
          last_date: null,
          total_tickets: 0,
          total_revenue: 0,
          error: existing.error,
        });
        continue;
      }

      const reconstructed = reconstructFourthefansRollupDeltas(
        eventSnapshots,
        existing.rows,
      );
      if (!dryRun && reconstructed.length > 0) {
        await upsertBackfillRows(admin, reconstructed);
      }
      const positiveExistingDates = new Set(
        existing.rows
          .filter((row) => row.tickets_sold != null && row.tickets_sold > 0)
          .map((row) => row.date),
      );
      results.push({
        event_id: snapshotEventId,
        snapshots_read: eventSnapshots.length,
        rows_reconstructed: reconstructed.length,
        rows_written: dryRun ? 0 : reconstructed.length,
        skipped_existing_positive: countSnapshotDates(
          eventSnapshots,
          positiveExistingDates,
        ),
        first_date: reconstructed[0]?.date ?? null,
        last_date: reconstructed[reconstructed.length - 1]?.date ?? null,
        total_tickets: reconstructed.reduce(
          (sum, row) => sum + row.tickets_sold,
          0,
        ),
        total_revenue: round2(
          reconstructed.reduce((sum, row) => sum + (row.revenue ?? 0), 0),
        ),
      });
    } catch (err) {
      results.push({
        event_id: snapshotEventId,
        snapshots_read: eventSnapshots.length,
        rows_reconstructed: 0,
        rows_written: 0,
        skipped_existing_positive: 0,
        first_date: null,
        last_date: null,
        total_tickets: 0,
        total_revenue: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const failed = results.filter((result) => result.error);
  return NextResponse.json(
    {
      ok: failed.length === 0,
      dry_run: dryRun,
      events_processed: results.length,
      rows_written: results.reduce((sum, result) => sum + result.rows_written, 0),
      results,
    },
    { status: failed.length === 0 ? 200 : 207 },
  );
}

async function loadFourthefansSnapshots(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  args: { userId: string; eventId: string | null },
): Promise<
  | { ok: true; rows: FourthefansSnapshotForBackfill[] }
  | { ok: false; error: string }
> {
  let query = admin
    .from("ticket_sales_snapshots")
    .select("event_id, user_id, snapshot_at, tickets_sold, gross_revenue_cents")
    .eq("user_id", args.userId)
    .eq("source", "fourthefans")
    .order("event_id", { ascending: true })
    .order("snapshot_at", { ascending: true });
  if (args.eventId) {
    query = query.eq("event_id", args.eventId);
  }
  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    rows: (data ?? []) as FourthefansSnapshotForBackfill[],
  };
}

async function loadExistingRollups(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  eventId: string,
): Promise<
  | { ok: true; rows: ExistingRollupForBackfill[] }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("event_daily_rollups")
    .select("date, tickets_sold")
    .eq("event_id", eventId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []) as ExistingRollupForBackfill[] };
}

async function upsertBackfillRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  rows: FourthefansBackfillRow[],
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin.from("event_daily_rollups").upsert(
    rows.map((row) => ({
      user_id: row.user_id,
      event_id: row.event_id,
      date: row.date,
      tickets_sold: row.tickets_sold,
      revenue: row.revenue,
      source_eventbrite_at: now,
    })),
    { onConflict: "event_id,date" },
  );
  if (error) throw new Error(error.message);
}

function groupSnapshotsByEvent(
  snapshots: FourthefansSnapshotForBackfill[],
): Map<string, FourthefansSnapshotForBackfill[]> {
  const byEvent = new Map<string, FourthefansSnapshotForBackfill[]>();
  for (const snapshot of snapshots) {
    const rows = byEvent.get(snapshot.event_id) ?? [];
    rows.push(snapshot);
    byEvent.set(snapshot.event_id, rows);
  }
  return byEvent;
}

function countSnapshotDates(
  snapshots: FourthefansSnapshotForBackfill[],
  dates: Set<string>,
): number {
  const snapshotDates = new Set(
    snapshots.map((snapshot) => snapshot.snapshot_at.slice(0, 10)),
  );
  let count = 0;
  for (const date of snapshotDates) {
    if (dates.has(date)) count += 1;
  }
  return count;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
