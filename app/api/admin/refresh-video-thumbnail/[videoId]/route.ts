/**
 * POST /api/admin/refresh-video-thumbnail/[videoId]
 *
 * Utility endpoint for backfilling thumbnail URLs on video assets that were
 * uploaded before the post-upload polling fix landed. Those assets have
 * thumbnailUrl="" in their draft state because Meta's POST /advideos never
 * included the `picture` field in the upload response.
 *
 * Usage:
 *   POST /api/admin/refresh-video-thumbnail/{metaVideoId}
 *   Body: { "adAccountId": "act_1234567890" }   (used only for token lookup)
 *   Response: { "videoId": "...", "picture": "https://..." | null }
 *
 * The caller is responsible for updating the draft/asset state with the
 * returned picture URL. This route does not write to any database.
 *
 * Authentication: requires an active session (same as all API routes).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { fetchVideoThumbnailWithRetry } from "@/lib/meta/video-thumbnail-poll";

interface RouteContext {
  params: Promise<{ videoId: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { videoId } = await ctx.params;
  if (!videoId?.trim()) {
    return NextResponse.json({ error: "videoId path parameter is required" }, { status: 400 });
  }

  // Resolve the user's Meta token
  let token: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
  } catch (err) {
    return NextResponse.json(
      { error: `No Meta token available: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 502 },
    );
  }

  console.log(`[refresh-video-thumbnail] fetching picture for videoId=${videoId} userId=${user.id}`);

  // Use the same polling helper as uploadVideoAsset.
  // Production delay (3000ms) — this is an admin route, latency is acceptable.
  const picture = await fetchVideoThumbnailWithRetry(videoId, token);

  console.log(`[refresh-video-thumbnail] videoId=${videoId} picture=${picture || "(none)"}`);

  return NextResponse.json({
    videoId,
    picture: picture || null,
  });
}
