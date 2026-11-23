import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { runBmCronScan } from "@/lib/bm/cron-scan";
import { withCronRunLog } from "@/lib/reporting/with-cron-run-log";

/**
 * GET /api/cron/bm-page-scan  (Vercel Cron — 21:15, 01:15 and 04:15 UTC)
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
 * Breaker, budget, rotation (18 Nov 2026 — the run had hit the 800 s kill
 * every day since about 29 Jul): BMs go least-recently-scanned first; the first
 * Meta rate-limit error stops the run and the rest are skipped, not errored;
 * no BM starts after 650 s. The token-wide reads (`/me/accounts`, the
 * business-scoped user ids) happen once per run, not once per BM. Each run
 * writes a `cron_runs` row (`bm-page-scan`), alarmed in CRON_ALARMS
 * (lib/reporting/cron-alarm-config.ts, rule `night_all_zero`). BMs whose client is
 * archived are skipped, like every other cron; a BM with no client is
 * scanned. See lib/bm/scan-run.ts and lib/bm/cron-scan.ts.
 *
 * Schedule (three runs a night since 23 Nov; 04:15 alone before, 08:00
 * before 18 Nov): Meta's app request limit is a rolling hour shared by every
 * cron on this app, and each run stops at the first rate limit, which on
 * the first 04:15 run came 193 s in after 18 BMs. Three runs at least 3 h
 * apart each start on a fresh hour, and the least-recently-scanned-first
 * order makes each pick up where the last stopped.
 *
 * The times keep an hour clear after each run for the night's heavy Meta
 * readers, which would otherwise inherit a spent hour:
 *   21:15  after scan-enhancement-flags 18:45; next Meta job optimisation-tick 00:00
 *   01:15  after scan-enhancement-flags 00:45 (≤ 800 s); ad-daily-insights 02:30
 *   04:15  after optimisation-tick 04:00 (≤ 300 s); IG clip discovery runs 03:45
 * budget-pacing-check runs every hour at :00 (≤ 120 s) and can't be avoided.
 * 00:15 and 02:15 were the first proposal; they sit 30 and 15 minutes before
 * scan-enhancement-flags and ad-daily-insights.
 *
 * Each run logs `meta_calls` (every Graph attempt, retries included) and the
 * X-App-Usage readings `app_usage_last` / `app_usage_at_limit` in its
 * cron_runs detail (lib/meta/call-meter.ts).
 *
 * Auth: Bearer CRON_SECRET (same pattern as the other crons).
 */

export const dynamic = "force-dynamic";
// Bumped 300 -> 800 (Vercel Pro ceiling): this loop calls the same
// scanBusinessManager helper as the "Sync now" route, sequentially, across
// every connected BM. A single ~1000+ page BM (e.g. Columbo Group,
// 527693220707294) alone can approach the old 300s budget, so with 10+ BMs
// in the sequential loop 300s was no longer generous headroom.
// The loop stops starting BMs at BM_SCAN_TIME_BUDGET_MS (650 s) so it always
// returns, and writes its cron_runs row, inside this ceiling.
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

async function handleGET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch {
    return NextResponse.json({ ok: false, error: "Service client unavailable" }, { status: 500 });
  }

  // 200 even when the breaker tripped: stopping on a rate limit is the
  // designed outcome, and the skipped BMs go first tomorrow.
  return NextResponse.json(await runBmCronScan(supabase));
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export const GET = withCronRunLog(
  {
    cronName: "bm-page-scan",
    getDb: () => {
      try {
        return createServiceRoleClient();
      } catch {
        return null;
      }
    },
    // A BM counts as written when its page scan succeeded.
    rows: (body) => num(body.scannedOk),
    considered: (body) => num(body.businessManagers),
    detail: (body) => ({
      elapsed_ms: num(body.elapsedMs),
      bms_total: num(body.businessManagers),
      bms_skipped_archived_client: num(body.skippedArchivedClients),
      bms_scanned: num(body.scanned),
      bms_ok: num(body.scannedOk),
      bms_failed: num(body.failed),
      bms_skipped_rate_limited: num(body.skippedRateLimited),
      bms_skipped_time_budget: num(body.skippedTimeBudget),
      stopped_by: typeof body.stoppedBy === "string" ? body.stoppedBy : null,
      rate_limited_at: typeof body.rateLimitedAt === "string" ? body.rateLimitedAt : null,
      token_context_reads: num(body.tokenContextReads),
      meta_calls: num(body.metaCalls),
      app_usage_last: body.appUsageLast ?? null,
      app_usage_at_limit: body.appUsageAtLimit ?? null,
      totals: body.totals ?? null,
      asset_totals: body.assetTotals ?? null,
    }),
  },
  handleGET,
);
