import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireOperator } from "@/lib/bm/route-auth";
import { getBusinessManagerByBizId } from "@/lib/db/business-managers";
import { grantPagesForBusinessManager } from "@/lib/bm/grant";

/**
 * POST /api/business-managers/[bizId]/pages/grant-all
 *
 * Bulk-grants the operator ADVERTISER access on every page in this BM where they
 * currently lack it. Batched 50-per-batch with a 2s pause between batches.
 * Writes a `granted` audit event per page.
 */

export const dynamic = "force-dynamic";
// Bulk grants can span many batches (50 pages + 2s pause). Vercel Pro allows
// long durations; this stays well under the 800s cron ceiling.
export const maxDuration = 300;

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

  return NextResponse.json({ ok: !result.tokenExpired, result });
}
