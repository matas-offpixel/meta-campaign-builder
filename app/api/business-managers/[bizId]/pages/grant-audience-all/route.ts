import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireOperator } from "@/lib/bm/route-auth";
import { getBusinessManagerByBizId } from "@/lib/db/business-managers";
import { grantPageAudienceAccessForBusinessManager } from "@/lib/bm/grant-page-audience";
import { describeAudienceGrantResult, isAudienceGrantSuccess } from "@/lib/bm/types";

/**
 * POST /api/business-managers/[bizId]/pages/grant-audience-all
 *
 * Grants the AUDIENCE task on every page in this BM that lacks it, then
 * verifies by read-back. Separate from `pages/grant-all` (which grants
 * ADVERTISE) because the two capabilities are independent: a page can need this
 * while already being fully advertisable.
 */

export const dynamic = "force-dynamic";
// Same budget as pages/grant-all — 50-page batches with a 2s inter-batch pause
// and a 500ms per-request throttle, so a large BM can legitimately run long.
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

  const result = await grantPageAudienceAccessForBusinessManager(service, bm, {
    actorUserId: user.id,
  });

  const ok = isAudienceGrantSuccess(result);
  return NextResponse.json({
    ok,
    error: ok ? undefined : describeAudienceGrantResult(result),
    result,
  });
}
