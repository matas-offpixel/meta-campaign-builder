import { NextResponse } from "next/server";

/**
 * GET /api/reporting/event-campaigns/tiktok
 *
 * Stub. The event-detail Campaign Performance panel hits this when
 * the user clicks the TikTok platform tab. There is no TikTok Ads
 * insights adapter wired up yet (manual report uploads cover the
 * reporting tab today), so the route returns a structured "not
 * implemented" response and the UI renders the disabled "Coming
 * soon" state. When the adapter lands this becomes a real handler
 * with no UI changes required.
 */
export function GET() {
  return NextResponse.json({
    ok: false,
    reason: "platform_pending",
    error: "TikTok campaign reporting adapter is not implemented yet.",
  });
}
