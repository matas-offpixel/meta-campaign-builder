import { NextResponse, type NextRequest } from "next/server";

import { respondActivity } from "@/lib/enrichment/activity-respond";

/**
 * GET /api/events/[id]/activity
 *
 * Returns three live signals for the event detail "Activity" tab:
 *   - news        : Google News mentions (RSS, no key)
 *   - releases    : per-artist Spotify releases (recent + upcoming)
 *   - weather     : Open-Meteo forecast at venue lat/lng
 *
 * Each source is independently TTL'd via event_activity_snapshots
 * (news 6h, releases 24h, weather 1h) and fetched in parallel. A
 * failure in one source never 500s the whole request — we always
 * return whatever we have plus an `errors` map.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return await respondActivity(id, { force: false });
}

export async function POST() {
  return NextResponse.json(
    { ok: false, error: "Use POST /api/events/[id]/activity/refresh" },
    { status: 405 },
  );
}
