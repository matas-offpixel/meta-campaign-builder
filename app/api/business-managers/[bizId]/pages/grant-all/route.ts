import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireOperator } from "@/lib/bm/route-auth";
import { getBusinessManagerByBizId } from "@/lib/db/business-managers";
import { grantPagesForBusinessManager } from "@/lib/bm/grant";
import { describeGrantResult, isFullGrantSuccess } from "@/lib/bm/types";

/**
 * POST /api/business-managers/[bizId]/pages/grant-all
 *
 * Bulk-grants the operator ADVERTISER access on every page in this BM where they
 * currently lack it. Batched 50-per-batch with a 2s pause between batches.
 * Writes a `granted` audit event per page.
 */

export const dynamic = "force-dynamic";
// Bulk grants can span many batches (50 pages + 2s pause + a 500ms
// per-request throttle — see lib/bm/grant.ts). A large BM (Columbo Group:
// ~1000+ missing-access pages) can approach this budget before a rate
// limit halts it; 800s matches the Vercel Pro ceiling used by the scan
// route (see PR #711) rather than risk another silent 504.
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

  const result = await grantPagesForBusinessManager(service, bm, {
    actorUserId: user.id,
  });

  // ok must require zero failures — not just "token still valid" — or a
  // batch where every grant failed reports false success (2026-07-09 bug).
  const ok = isFullGrantSuccess(result);
  return NextResponse.json({ ok, error: ok ? undefined : describeGrantResult(result), result });
}
