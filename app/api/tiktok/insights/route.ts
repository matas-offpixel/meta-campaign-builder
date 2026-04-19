import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { TikTokInsightsResult } from "@/lib/types/tiktok";

/**
 * GET /api/tiktok/insights?eventId=…
 *
 * Returns TikTok campaign insights for the given event. STUB.
 *
 * TODO when wiring up:
 *   1. Look up events.tiktok_account_id (fall back to
 *      clients.tiktok_account_id once migration 018 lands).
 *   2. Decrypt tiktok_accounts.access_token_encrypted with the same
 *      envelope KMS used for Meta long-lived tokens.
 *   3. Fan out to TikTok Business Insights API filtered by the event's
 *      naming convention (e.g. `[event_code]` prefix on campaign name).
 *   4. Aggregate into TikTokInsightsPayload — same shape the report tab
 *      already expects.
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

  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json(
      { ok: false, error: "Missing eventId query param" },
      { status: 400 },
    );
  }

  const result: TikTokInsightsResult = {
    ok: false,
    error: {
      reason: "not_configured",
      message: "TikTok not configured",
    },
  };
  return NextResponse.json(result, { status: 200 });
}
