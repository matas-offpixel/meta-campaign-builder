import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { listBusinessManagers } from "@/lib/db/business-managers";
import { scanBusinessManager } from "@/lib/bm/sync";

/**
 * GET /api/cron/bm-page-scan  (Vercel Cron — daily 08:00 UTC)
 *
 * For every connected Business Manager: re-enumerate owned + client pages, upsert
 * into bm_pages, and write a `detected_new` event for any page seen for the first
 * time. DETECTION ONLY — never auto-grants (grants require an explicit UI click
 * so they stay on a separate, reviewed action path).
 *
 * Auth: Bearer CRON_SECRET (same pattern as the other crons).
 * Logs with the "[bm-page-scan]" prefix for Vercel log filtering.
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
  for (const bm of bms) {
    // Sequential — keeps concurrent Meta reads low so we never trip the
    // per-token rate-limit budget across many BMs in one run.
    const r = await scanBusinessManager(supabase, bm, { actorUserId: bm.added_by_user_id });
    results.push(r);
  }

  const elapsedMs = Date.now() - startedAt;
  const totals = results.reduce(
    (acc, r) => {
      acc.pages += r.scannedPages;
      acc.newPages += r.newPages;
      acc.missing += r.missingAccess;
      if (!r.ok) acc.errors += 1;
      return acc;
    },
    { pages: 0, newPages: 0, missing: 0, errors: 0 },
  );

  console.error(
    `[bm-page-scan] done in ${elapsedMs}ms — bms=${bms.length} pages=${totals.pages} new=${totals.newPages} missing_access=${totals.missing} errors=${totals.errors}`,
  );

  return NextResponse.json({
    ok: true,
    elapsedMs,
    businessManagers: bms.length,
    totals,
    results,
  });
}
