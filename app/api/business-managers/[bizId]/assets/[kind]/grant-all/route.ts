import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireOperator } from "@/lib/bm/route-auth";
import { getBusinessManagerByBizId } from "@/lib/db/business-managers";
import { grantAssetsForBusinessManager } from "@/lib/bm/grant-assets";
import { describeAssetKind, KIND_BY_SLUG } from "@/lib/bm/asset-kinds";
import { describeGrantResult, isFullGrantSuccess } from "@/lib/bm/types";

/**
 * POST /api/business-managers/[bizId]/assets/[kind]/grant-all
 *
 * Bulk-grants the operator ADVERTISER access on every asset of this kind in the
 * BM where they currently lack it. Same batching budget as the pages route (50
 * per batch, 2s between batches, 500ms per request) and the same halt-on-
 * rate-limit behaviour.
 *
 * Pages are deliberately NOT routable here — they keep their own v1 endpoint
 * (`/pages/grant-all`) so this PR cannot change page-grant behaviour.
 */

export const dynamic = "force-dynamic";
// Matches the pages grant-all ceiling (see PR #711) — a bulk run across a large
// BM can span many batches before a rate limit halts it.
export const maxDuration = 800;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bizId: string; kind: string }> },
) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { bizId, kind: kindSlug } = await params;
  const kind = KIND_BY_SLUG[kindSlug];
  if (!kind) {
    return NextResponse.json(
      { ok: false, error: `Unknown asset kind "${kindSlug}"` },
      { status: 400 },
    );
  }
  if (kind === "page") {
    return NextResponse.json(
      { ok: false, error: "Use /pages/grant-all for pages" },
      { status: 400 },
    );
  }

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

  // Read-back verification is opt-in on bulk runs because it doubles the
  // request count against the same Meta budget. Default off here, on for the
  // single-asset route where the cost is one extra call.
  const verify = new URL(req.url).searchParams.get("verify") === "1";

  const result = await grantAssetsForBusinessManager(service, bm, kind, {
    actorUserId: user.id,
    verify,
  });

  // ok must require zero failures, not just a still-valid token (2026-07-09 bug).
  const ok = isFullGrantSuccess(result);
  return NextResponse.json({
    ok,
    error: ok ? undefined : describeGrantResult(result, describeAssetKind(kind).label.toLowerCase()),
    result,
  });
}
