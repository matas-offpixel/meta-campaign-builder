/**
 * GET /api/clients/[id]/asset-queue
 *
 * Returns paginated asset queue rows for a client, optionally filtered by
 * status. Supports two pagination styles (both return the same shape):
 *
 *   Offset-based (preferred):
 *     ?offset=0&limit=25
 *
 *   Page-based (backward compat):
 *     ?page=0&pageSize=25
 *
 * Query params:
 *   status   — one of pending|matched|confirmed|launched|skipped|error
 *   offset   — 0-based row offset (default 0)
 *   limit    — rows per page (default 25, max 100)
 *   page     — 0-based page index (ignored when offset is present)
 *   pageSize — alias for limit when using page-based pagination
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listAssetQueue, type AssetQueueStatus } from "@/lib/db/asset-queue";

const VALID_STATUSES = new Set<AssetQueueStatus>([
  "pending", "matched", "matched_umbrella", "confirmed", "launched", "skipped", "error",
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

  // Offset-based pagination (preferred).
  const rawOffset = sp.get("offset");
  const rawLimit = sp.get("limit");
  const rawPage = sp.get("page");
  const rawPageSize = sp.get("pageSize");

  const limit = Math.min(100, Math.max(1, parseInt(rawLimit ?? rawPageSize ?? "25", 10)));

  let offset: number | undefined;
  let page: number | undefined;

  if (rawOffset !== null) {
    offset = Math.max(0, parseInt(rawOffset, 10));
  } else {
    page = Math.max(0, parseInt(rawPage ?? "0", 10));
  }

  const { rows, total } = await listAssetQueue(clientId, {
    status,
    offset,
    limit,
    page,
    pageSize: limit,
  });

  const resolvedOffset = offset ?? (page ?? 0) * limit;

  return NextResponse.json({
    rows,
    total,
    offset: resolvedOffset,
    limit,
    hasMore: resolvedOffset + rows.length < total,
    // Legacy fields (backward compat for any existing callers)
    page: page ?? Math.floor(resolvedOffset / limit),
    pageSize: limit,
  });
}
