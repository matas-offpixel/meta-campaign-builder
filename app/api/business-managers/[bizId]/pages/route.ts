import { NextResponse, type NextRequest } from "next/server";

import { requireOperator } from "@/lib/bm/route-auth";
import { getBusinessManagerByBizId, getBMPages } from "@/lib/db/business-managers";

/**
 * GET /api/business-managers/[bizId]/pages
 *
 * Full page list for one BM with per-page access status (user_has_access flag).
 */

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ bizId: string }> },
) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;

  const { bizId } = await params;
  const bm = await getBusinessManagerByBizId(auth.supabase, bizId);
  if (!bm) {
    return NextResponse.json({ ok: false, error: "Business Manager not found" }, { status: 404 });
  }

  const pages = await getBMPages(auth.supabase, bizId);
  return NextResponse.json({
    ok: true,
    businessManager: bm,
    pages,
    missingAccessCount: pages.filter((p) => !p.user_has_access).length,
  });
}
