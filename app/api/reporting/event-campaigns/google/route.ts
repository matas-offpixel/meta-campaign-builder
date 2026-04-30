import { NextRequest, type NextRequest as NextRequestType } from "next/server";

import { GET as getSharedEventCampaigns } from "../route";

/**
 * GET /api/reporting/event-campaigns/google
 *
 * Compatibility shim for clients that call the platform-specific Google Ads
 * endpoint. The canonical implementation lives on the shared route and is
 * selected with `?platform=google`.
 */
export function GET(req: NextRequestType) {
  const url = new URL(req.url);
  url.searchParams.set("platform", "google");
  return getSharedEventCampaigns(new NextRequest(url, req));
}
