import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireOperator } from "@/lib/bm/route-auth";
import { getBusinessManagerByBizId } from "@/lib/db/business-managers";
import { grantAssetsForBusinessManager } from "@/lib/bm/grant-assets";
import { describeAssetKind, KIND_BY_SLUG } from "@/lib/bm/asset-kinds";
import { describeGrantResult, isFullGrantSuccess } from "@/lib/bm/types";

/**
 * POST /api/business-managers/[bizId]/assets/[kind]/[assetId]/grant
 *
 * Grants the operator ADVERTISER access on ONE asset. Verification is on by
 * default here (unlike the bulk route) — a single extra read-back is cheap, and
 * it's what turns "Meta accepted the call" into "the operator actually has
 * access", which are not the same thing.
 *
 * `assetId` must be the id Meta's grant edge addresses: the act_-prefixed id for
 * ad accounts, and the Instagram BUSINESS ASSET id (not ig_user_id) for IG.
 */

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ bizId: string; kind: string; assetId: string }> },
) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { bizId, kind: kindSlug, assetId } = await params;
  const kind = KIND_BY_SLUG[kindSlug];
  if (!kind) {
    return NextResponse.json(
      { ok: false, error: `Unknown asset kind "${kindSlug}"` },
      { status: 400 },
    );
  }
  if (kind === "page") {
    return NextResponse.json(
      { ok: false, error: "Use /pages/[pageId]/grant for pages" },
      { status: 400 },
    );
  }
  if (!assetId) {
    return NextResponse.json({ ok: false, error: "assetId is required" }, { status: 400 });
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

  const result = await grantAssetsForBusinessManager(service, bm, kind, {
    assetIds: [decodeURIComponent(assetId)],
    actorUserId: user.id,
    verify: true,
  });

  const ok = isFullGrantSuccess(result);
  return NextResponse.json({
    ok,
    error: ok ? undefined : describeGrantResult(result, describeAssetKind(kind).label.toLowerCase()),
    result,
  });
}
