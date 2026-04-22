import { type NextRequest } from "next/server";

import { respondActivity } from "@/lib/enrichment/activity-respond";

/**
 * POST /api/events/[id]/activity/refresh
 *
 * Force a re-fetch of all three activity sources, bypassing the TTL
 * cache. Same response shape as GET /activity.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return await respondActivity(id, { force: true });
}
