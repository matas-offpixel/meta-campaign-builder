import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  getConnectionById,
  listLinksForConnection,
} from "@/lib/db/ticketing";

/**
 * GET /api/ticketing/connections/[id]/health
 *
 * Returns a small health summary for one connection: link count, recent
 * snapshot count (last 24h / 7d), most recent snapshot timestamp, and
 * the connection's `last_synced_at` + `last_error`. Used by the
 * dashboard health panel and surfaced in the cron monitoring UI.
 *
 * RLS gates the connection lookup. We additionally return 404 (not 403)
 * when the row isn't visible to the caller — preserving the existing
 * pattern in the other ticketing routes.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Connection id is required" },
      { status: 400 },
    );
  }

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

  const connection = await getConnectionById(supabase, id);
  if (!connection || connection.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Connection not found" },
      { status: 404 },
    );
  }

  const links = await listLinksForConnection(supabase, id);
  const linkedEventIds = links.map((l) => l.event_id);

  const now = Date.now();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(
    now - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const baseQuery = supabase
    .from("ticket_sales_snapshots")
    .select("snapshot_at", { count: "exact", head: true })
    .eq("connection_id", id);

  const [last24hResult, last7dResult, latestSnapshotResult] = await Promise.all(
    [
      baseQuery.gte("snapshot_at", oneDayAgo),
      supabase
        .from("ticket_sales_snapshots")
        .select("snapshot_at", { count: "exact", head: true })
        .eq("connection_id", id)
        .gte("snapshot_at", sevenDaysAgo),
      supabase
        .from("ticket_sales_snapshots")
        .select("snapshot_at")
        .eq("connection_id", id)
        .order("snapshot_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ],
  );

  const snapshotsLast24h = last24hResult.count ?? 0;
  const snapshotsLast7d = last7dResult.count ?? 0;
  const latestSnapshotAt =
    (latestSnapshotResult.data as { snapshot_at?: string } | null)
      ?.snapshot_at ?? null;

  return NextResponse.json({
    ok: true,
    health: {
      connectionId: id,
      provider: connection.provider,
      status: connection.status,
      lastSyncedAt: connection.last_synced_at,
      lastError: connection.last_error,
      linkCount: links.length,
      linkedEventIds,
      snapshotsLast24h,
      snapshotsLast7d,
      latestSnapshotAt,
    },
  });
}
