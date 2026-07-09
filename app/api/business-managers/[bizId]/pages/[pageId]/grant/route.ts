import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireOperator } from "@/lib/bm/route-auth";
import { getBusinessManagerByBizId } from "@/lib/db/business-managers";
import { grantPagesForBusinessManager } from "@/lib/bm/grant";

/**
 * POST /api/business-managers/[bizId]/pages/[pageId]/grant
 *
 * Single-page ADVERTISER grant for the operator (the per-card "Grant me access"
 * button). Writes a `granted` audit event on success.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ bizId: string; pageId: string }> },
) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { bizId, pageId } = await params;
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
    pageIds: [pageId],
    actorUserId: user.id,
  });

  return NextResponse.json({ ok: result.granted > 0 && !result.tokenExpired, result });
}
