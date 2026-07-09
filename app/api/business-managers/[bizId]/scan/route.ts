import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireOperator } from "@/lib/bm/route-auth";
import { getBusinessManagerByBizId } from "@/lib/db/business-managers";
import { scanBusinessManager } from "@/lib/bm/sync";

/**
 * POST /api/business-managers/[bizId]/scan
 *
 * On-demand "Sync now" for one BM — re-enumerates owned + client pages and
 * refreshes the access flags / new-page detections. Same detection-only logic
 * as the daily cron; never grants.
 */

export const dynamic = "force-dynamic";
// Bumped 120 -> 800 (Vercel Pro ceiling, same pattern as grant-all and the
// other slow BM/backfill routes below): a scan on a ~1000+ page BM (e.g.
// Columbo Group, 527693220707294) hit the 120s default and 504'd even
// though the scan itself made real progress (see scanBusinessManager's
// per-chunk checkpointing in lib/bm/sync.ts for the other half of this fix).
export const maxDuration = 800;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ bizId: string }> },
) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { bizId } = await params;
  const bm = await getBusinessManagerByBizId(auth.supabase, bizId);
  if (!bm) {
    return NextResponse.json({ ok: false, error: "Business Manager not found" }, { status: 404 });
  }

  let service: ReturnType<typeof createServiceRoleClient>;
  try {
    service = createServiceRoleClient();
  } catch {
    return NextResponse.json({ ok: false, error: "Service client unavailable" }, { status: 500 });
  }

  const result = await scanBusinessManager(service, bm, { actorUserId: user.id });
  return NextResponse.json({ ok: result.ok, result });
}
