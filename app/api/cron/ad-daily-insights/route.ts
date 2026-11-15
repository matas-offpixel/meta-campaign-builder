import { NextResponse, type NextRequest } from "next/server";

import { withCronRunLog } from "@/lib/reporting/with-cron-run-log";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { graphGetWithToken } from "@/lib/meta/client";
import { graphMultiGetByIds } from "@/lib/meta/graph-multi-get";
import { isAdDailyInsightsEnabled, runAdDailyInsights } from "@/lib/ad-daily-insights/runner";
import { isAudienceBreakdownsEnabled, runAudienceBreakdowns } from "@/lib/audience-breakdowns/runner";
import type { TikTokRequest } from "@/lib/audience-breakdowns/tiktok";
import { tiktokGet } from "@/lib/tiktok/client";
import { getTikTokCredentials } from "@/lib/tiktok/credentials";

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
 * Audience breakdowns (dashboard v2 HE1, migration 245) run after it, in
 * the same request, behind their own killswitch:
 * `ENABLE_AUDIENCE_BREAKDOWNS` must be exactly `"1"` (default off). With it
 * off this route does exactly what it did before. With it on, Meta
 * age+gender and region per campaign-day, and TikTok age+gender and UK
 * nation, are read for the same three days and stored per show; the result
 * is under `audienceBreakdowns`. Logic: `lib/audience-breakdowns/runner.ts`.
 *
 * Auth: bearer header `Authorization: Bearer <CRON_SECRET>`.
 */

export const maxDuration = 800;

/** Breakdowns start no new account after this long into the request. */
const BREAKDOWNS_BUDGET_MS = 600_000;
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

async function handleGET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();
  const breakdownsOn = isAudienceBreakdownsEnabled(process.env);
  if (!isAdDailyInsightsEnabled(process.env) && !breakdownsOn) {
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
    // One attempt per call: a retry would hide its cost from metaCalls.
    const graphGet = (path: string, params: Record<string, string>) => graphGetWithToken(path, params, token, { maxAttempts: 1 });
    const result = await runAdDailyInsights({
      env: process.env,
      db: supabase,
      graphGet,
      multiGet: (path, params) => graphMultiGetByIds(path, params, token),
    });
    if (!breakdownsOn) return NextResponse.json(result, { status: result.ok ? 200 : 207 });

    const db = supabase;
    const audienceBreakdowns = await runAudienceBreakdowns({
      env: process.env,
      db,
      graphGet,
      tiktok: {
        request: tiktokGet as TikTokRequest,
        getToken: async (accountId) => (await getTikTokCredentials(db, accountId))?.access_token ?? null,
      },
      deadline: startedAt + BREAKDOWNS_BUDGET_MS,
    });
    return NextResponse.json({ ...result, audienceBreakdowns }, { status: result.ok && audienceBreakdowns.ok ? 200 : 207 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[ad-daily-insights] unhandled error: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = withCronRunLog(
  {
    cronName: "ad-daily-insights",
    getDb: () => {
      try {
        return createServiceRoleClient();
      } catch {
        return null;
      }
    },
    rows: (b) =>
      Number(b.rowsWritten ?? 0) + Number((b.audienceBreakdowns as { rowsWritten?: number } | undefined)?.rowsWritten ?? 0),
  considered: (b) => Number(b.accounts ?? 0),
  },
  handleGET,
);
