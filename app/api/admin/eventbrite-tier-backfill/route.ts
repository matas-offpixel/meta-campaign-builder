import { NextResponse, type NextRequest } from "next/server";

import {
  replaceEventTicketTiers,
  updateEventCapacityFromTicketTiers,
} from "@/lib/db/ticketing";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { parseEventbriteTiers } from "@/lib/ticketing/eventbrite/parse";
import { ticketTierCapacity } from "@/lib/ticketing/tier-capacity";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RequestBody {
  event_id?: unknown;
  dry_run?: unknown;
}

interface SnapshotRow {
  event_id: string;
  user_id: string;
  snapshot_at: string;
  raw_payload: unknown;
}

interface EventResult {
  event_id: string;
  snapshot_at: string | null;
  tiers_found: number;
  tiers_written: number;
  computed_capacity: number;
  capacity_updated: boolean;
  capacity_skipped_reason: string | null;
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
    const { data: event, error } = await admin
      .from("events")
      .select("id, user_id")
      .eq("id", eventId)
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
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

  const snapshots = await loadLatestEventbriteSnapshots(admin, {
    userId: user.id,
    eventId,
  });
  if (!snapshots.ok) {
    return NextResponse.json(
      { ok: false, error: snapshots.error },
      { status: 500 },
    );
  }

  const results: EventResult[] = [];
  for (const snapshot of snapshots.rows) {
    try {
      const tiers = parseEventbriteTiers(snapshot.raw_payload);
      const tiersWritten = dryRun
        ? 0
        : await replaceEventTicketTiers(admin, {
            eventId: snapshot.event_id,
            tiers,
            snapshotAt: snapshot.snapshot_at,
          });
      const capacity = dryRun
        ? {
            computedCapacity: ticketTierCapacity(tiers),
            updated: false,
            skippedReason: "dry_run",
          }
        : await updateEventCapacityFromTicketTiers(admin, {
            eventId: snapshot.event_id,
            userId: snapshot.user_id,
            tiers,
            source: "eventbrite",
          });

      results.push({
        event_id: snapshot.event_id,
        snapshot_at: snapshot.snapshot_at,
        tiers_found: tiers.length,
        tiers_written: tiersWritten,
        computed_capacity: capacity.computedCapacity,
        capacity_updated: capacity.updated,
        capacity_skipped_reason: capacity.skippedReason,
      });
    } catch (err) {
      results.push({
        event_id: snapshot.event_id,
        snapshot_at: snapshot.snapshot_at,
        tiers_found: 0,
        tiers_written: 0,
        computed_capacity: 0,
        capacity_updated: false,
        capacity_skipped_reason: null,
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
      tiers_written: results.reduce(
        (sum, result) => sum + result.tiers_written,
        0,
      ),
      capacities_updated: results.filter((result) => result.capacity_updated)
        .length,
      failed: failed.length,
      results,
    },
    { status: failed.length === 0 ? 200 : 207 },
  );
}

async function loadLatestEventbriteSnapshots(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  args: { userId: string; eventId: string | null },
): Promise<
  | { ok: true; rows: SnapshotRow[] }
  | { ok: false; error: string }
> {
  const { data: connections, error: connectionsError } = await admin
    .from("client_ticketing_connections")
    .select("id")
    .eq("user_id", args.userId)
    .eq("provider", "eventbrite")
    .eq("status", "active");
  if (connectionsError) return { ok: false, error: connectionsError.message };

  const connectionIds = ((connections ?? []) as { id: string }[]).map(
    (connection) => connection.id,
  );
  if (connectionIds.length === 0) return { ok: true, rows: [] };

  let linkQuery = admin
    .from("event_ticketing_links")
    .select("event_id")
    .in("connection_id", connectionIds);
  if (args.eventId) {
    linkQuery = linkQuery.eq("event_id", args.eventId);
  }
  const { data: links, error: linksError } = await linkQuery;
  if (linksError) return { ok: false, error: linksError.message };

  const eventIds = Array.from(
    new Set(((links ?? []) as { event_id: string }[]).map((link) => link.event_id)),
  );
  if (eventIds.length === 0) return { ok: true, rows: [] };

  const query = admin
    .from("ticket_sales_snapshots")
    .select("event_id, user_id, snapshot_at, raw_payload")
    .eq("user_id", args.userId)
    .eq("source", "eventbrite")
    .in("event_id", eventIds)
    .not("raw_payload", "is", null)
    .order("event_id", { ascending: true })
    .order("snapshot_at", { ascending: false });

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };

  const latestByEvent = new Map<string, SnapshotRow>();
  for (const row of (data ?? []) as SnapshotRow[]) {
    if (!latestByEvent.has(row.event_id)) {
      latestByEvent.set(row.event_id, row);
    }
  }

  return { ok: true, rows: Array.from(latestByEvent.values()) };
}
