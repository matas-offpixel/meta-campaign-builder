import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { graphGetWithToken } from "@/lib/meta/client";
import { isAdDailyInsightsEnabled, runAdDailyInsights } from "@/lib/ad-daily-insights/runner";

/**
 * GET /api/cron/ad-daily-insights
 *
 * Learning loop A — nightly (02:30 UTC, `vercel.json`) per-ad per-day
 * Meta insights into `ad_daily_insights` (migration 185) for every
 * client ad account. Read-only against Meta. Logic lives in
 * `lib/ad-daily-insights/runner.ts`; this route is auth → killswitch →
 * wire the runner to the service-role client and Meta token.
 *
 * Killswitch: `ENABLE_AD_DAILY_INSIGHTS` must be exactly `"1"`. Unset
 * responds 200 with `skippedReason: "killswitch"`.
 *
 * Auth: bearer header `Authorization: Bearer <CRON_SECRET>`.
 */

export const maxDuration = 300;
export const dynamic = "force-dynamic";

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
  if (!isAdDailyInsightsEnabled(process.env)) {
    return NextResponse.json({ ok: true, skippedReason: "killswitch" }, { status: 200 });
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: "META_ACCESS_TOKEN is not configured" }, { status: 500 });
  }

  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Service-role client unavailable" },
      { status: 500 },
    );
  }

  try {
    const result = await runAdDailyInsights({
      env: process.env,
      db: supabase,
      // One attempt per call: a retry would hide its cost from metaCalls.
      graphGet: (path, params) => graphGetWithToken(path, params, token, { maxAttempts: 1 }),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[ad-daily-insights] unhandled error: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
