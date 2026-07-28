import { NextResponse, type NextRequest } from "next/server";

import { requireOperator } from "@/lib/bm/route-auth";
import { getBusinessManagerByBizId } from "@/lib/db/business-managers";
import { getBMAssets } from "@/lib/db/bm-assets";
import { describeAssetKind, KIND_BY_SLUG } from "@/lib/bm/asset-kinds";

/**
 * GET /api/business-managers/[bizId]/assets/[kind]
 *
 * Asset list for one BM and one asset kind, with per-asset access status.
 * `kind` is a URL slug: ad-accounts | pixels | ig-accounts | pages.
 *
 * Mirrors the v1 pages route; the kind lookup is allow-listed via KIND_BY_SLUG
 * so an unknown slug 400s instead of reaching a table name built from user input.
 */

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ bizId: string; kind: string }> },
) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;

  const { bizId, kind: kindSlug } = await params;
  const kind = KIND_BY_SLUG[kindSlug];
  if (!kind) {
    return NextResponse.json(
      { ok: false, error: `Unknown asset kind "${kindSlug}"` },
      { status: 400 },
    );
  }

  const bm = await getBusinessManagerByBizId(auth.supabase, bizId);
  if (!bm) {
    return NextResponse.json({ ok: false, error: "Business Manager not found" }, { status: 404 });
  }

  const assets = await getBMAssets(auth.supabase, kind, bizId);
  return NextResponse.json({
    ok: true,
    businessManager: bm,
    kind,
    label: describeAssetKind(kind).labelPlural,
    assets,
    missingAccessCount: assets.filter((a) => !a.user_has_access).length,
  });
}
