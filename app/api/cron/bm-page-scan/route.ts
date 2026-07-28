import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { listBusinessManagers } from "@/lib/db/business-managers";
import { scanBusinessManager } from "@/lib/bm/sync";
import { scanBusinessManagerAllAssets, type AssetScanResult } from "@/lib/bm/sync-assets";

/**
 * GET /api/cron/bm-page-scan  (Vercel Cron — daily 08:00 UTC)
 *
 * For every connected Business Manager, re-enumerate every asset type — pages
 * (migration 145) plus ad accounts, pixels and Instagram accounts (migration
 * 147) — upsert them, and write a `detected_new` event for anything seen for the
 * first time. DETECTION ONLY — never auto-grants (grants require an explicit UI
 * click so they stay on a separate, reviewed action path).
 *
 * The route keeps its `bm-page-scan` name so the existing Vercel Cron entry and
 * the log filters built around the `[bm-page-scan]` prefix keep working; the
 * asset phase logs under `[bm-asset-scan]`.
 *
 * Cost: the asset phase adds 6 paginated Graph reads per BM regardless of asset
 * count, because assignments are inlined into the list calls rather than read
 * per asset — see lib/meta/business-manager-assets.ts.
 *
 * Auth: Bearer CRON_SECRET (same pattern as the other crons).
 */

export const dynamic = "force-dynamic";
// Bumped 300 -> 800 (Vercel Pro ceiling): this loop calls the same
// scanBusinessManager helper as the "Sync now" route, sequentially, across
// every connected BM. A single ~1000+ page BM (e.g. Columbo Group,
// 527693220707294) alone can approach the old 300s budget, so with 10+ BMs
// in the sequential loop 300s was no longer generous headroom.
export const maxDuration = 800;

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch {
    return NextResponse.json({ ok: false, error: "Service client unavailable" }, { status: 500 });
  }

  const startedAt = Date.now();
  const bms = await listBusinessManagers(supabase);
  console.error(`[bm-page-scan] starting scan of ${bms.length} business manager(s)`);

  const results = [];
  const assetResults: AssetScanResult[] = [];
  for (const bm of bms) {
    // Sequential — keeps concurrent Meta reads low so we never trip the
    // per-token rate-limit budget across many BMs in one run. The asset phase
    // follows the page phase for the same BM (rather than running as a second
    // pass over all BMs) so one decrypted token and one resolved
    // business-scoped user id cover both.
    const r = await scanBusinessManager(supabase, bm, { actorUserId: bm.added_by_user_id });
    results.push(r);
    assetResults.push(
      ...(await scanBusinessManagerAllAssets(supabase, bm, {
        actorUserId: bm.added_by_user_id,
      })),
    );
  }

  const elapsedMs = Date.now() - startedAt;
  const totals = results.reduce(
    (acc, r) => {
      acc.pages += r.scannedPages;
      acc.newPages += r.newPages;
      acc.missing += r.missingAccess;
      acc.missingAudience += r.missingAudienceAccess;
      if (!r.ok) acc.errors += 1;
      return acc;
    },
    { pages: 0, newPages: 0, missing: 0, missingAudience: 0, errors: 0 },
  );
  const assetTotals = assetResults.reduce(
    (acc, r) => {
      acc.assets += r.scanned;
      acc.newAssets += r.newAssets;
      acc.missing += r.missingAccess;
      if (!r.ok) acc.errors += 1;
      return acc;
    },
    { assets: 0, newAssets: 0, missing: 0, errors: 0 },
  );

  console.error(
    `[bm-page-scan] done in ${elapsedMs}ms — bms=${bms.length} pages=${totals.pages} new=${totals.newPages} ` +
      `missing_access=${totals.missing} missing_audience_access=${totals.missingAudience} errors=${totals.errors} | ` +
      `assets=${assetTotals.assets} new=${assetTotals.newAssets} missing_access=${assetTotals.missing} errors=${assetTotals.errors}`,
  );

  return NextResponse.json({
    ok: true,
    elapsedMs,
    businessManagers: bms.length,
    totals,
    assetTotals,
    results,
    assetResults,
  });
}
