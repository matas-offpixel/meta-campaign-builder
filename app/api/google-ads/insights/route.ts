import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { GoogleAdsInsightsResult } from "@/lib/types/google-ads";

/**
 * GET /api/google-ads/insights?planId=…
 *
 * Returns Google Ads insights for the given plan. STUB. Will fan out
 * to the Google Ads API once OAuth credentials are wired.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const planId = req.nextUrl.searchParams.get("planId");
  if (!planId) {
    return NextResponse.json(
      { ok: false, error: "Missing planId query param" },
      { status: 400 },
    );
  }

  const result: GoogleAdsInsightsResult = {
    ok: false,
    error: {
      reason: "not_configured",
      message: "Google Ads not configured",
    },
  };
  return NextResponse.json(result, { status: 200 });
}
