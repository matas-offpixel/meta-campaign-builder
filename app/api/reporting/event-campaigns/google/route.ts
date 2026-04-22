import { NextResponse } from "next/server";

/**
 * GET /api/reporting/event-campaigns/google
 *
 * Stub. Mirror of the TikTok stub at the sibling path — see that
 * file for rationale. Returns `platform_pending` so the UI can
 * render the disabled "Coming soon" tab without special-casing the
 * client component per platform.
 */
export function GET() {
  return NextResponse.json({
    ok: false,
    reason: "platform_pending",
    error: "Google Ads campaign reporting adapter is not implemented yet.",
  });
}
