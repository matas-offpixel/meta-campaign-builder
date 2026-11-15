import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { GoogleAdsClient } from "@/lib/google-ads/client";
import { getGoogleAdsCredentials } from "@/lib/google-ads/credentials";
import {
  isGoogleAdsDailyInsightsEnabled,
  runGoogleAdsDailyInsights,
} from "@/lib/google-ads/campaign-insights/runner";

/**
 * GET /api/cron/google-ads-daily-insights
 *
 * Nightly (04:00 UTC, `vercel.json`) Google Ads campaign, search-term and
 * location facts per day into the migration 192 tables, for every client
 * Google Ads account. Read-only against Google Ads (GAQL search only).
 * Logic lives in `lib/google-ads/campaign-insights/runner.ts`; this route
 * is auth → killswitch → wire the runner to the service-role client and
 * the Google Ads client. 207 when any account failed, including one whose
 * event rollup shows Google spend on a day with no campaign rows.
 *
 * Killswitch: `ENABLE_GOOGLE_ADS_DAILY_INSIGHTS` must be exactly `"1"`.
 * Unset responds 200 with `skippedReason: "killswitch"`.
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
  if (!isGoogleAdsDailyInsightsEnabled(process.env)) {
    return NextResponse.json({ ok: true, skippedReason: "killswitch" }, { status: 200 });
  }

  let supabase: ReturnType<typeof createServiceRoleClient>;
  let client: GoogleAdsClient;
  try {
    supabase = createServiceRoleClient();
    client = new GoogleAdsClient();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Google Ads or service-role client unavailable" },
      { status: 500 },
    );
  }

  try {
    const result = await runGoogleAdsDailyInsights({
      env: process.env,
      db: supabase,
      query: (credentials, gaql) =>
        client.query<unknown[]>(
          {
            customerId: credentials.customer_id,
            refreshToken: credentials.refresh_token,
            loginCustomerId: credentials.login_customer_id,
          },
          gaql,
        ),
      loadCredentials: (accountId) => getGoogleAdsCredentials(supabase as never, accountId),
      recordRun: true,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[google-ads-daily-insights] unhandled error: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
