/**
 * GET /api/clients/[id]/asset-queue
 *
 * Returns paginated asset queue rows for a client, optionally filtered by status.
 *
 * Query params:
 *   status  — one of pending | matched | confirmed | launched | skipped | error
 *   page    — 0-based page index (default 0)
 *   pageSize — rows per page (default 50, max 100)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listAssetQueue, type AssetQueueStatus } from "@/lib/db/asset-queue";

const VALID_STATUSES = new Set<AssetQueueStatus>([
  "pending", "matched", "confirmed", "launched", "skipped", "error",
]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: clientId } = await params;

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Ownership check
  const { data: client } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (client.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const rawStatus = sp.get("status");
  const status = rawStatus && VALID_STATUSES.has(rawStatus as AssetQueueStatus)
    ? (rawStatus as AssetQueueStatus)
    : undefined;
  const page = Math.max(0, parseInt(sp.get("page") ?? "0", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") ?? "50", 10)));

  const { rows, total } = await listAssetQueue(clientId, { status, page, pageSize });

  return NextResponse.json({ rows, total, page, pageSize });
}
