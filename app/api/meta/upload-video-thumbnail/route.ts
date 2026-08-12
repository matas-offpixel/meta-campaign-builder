/**
 * POST /api/meta/upload-video-thumbnail
 *
 * FIX 2 (fallback for edge cases, task #90 follow-up) — lets an operator
 * override a video's auto-picked thumbnail (from `uploadVideoAsset`'s
 * `thumb_offset`, the primary fix) with an exact frame they picked
 * client-side. See `lib/meta/client.ts`'s `uploadVideoThumbnail` doc
 * comment for why this is the fallback, not the primary fix: `POST
 * /{videoId}/thumbnails` is a video-OBJECT write, unconfirmed against this
 * app's live App Review status (unlike `/adimages`, which IS confirmed
 * blocked — code=3 — regardless of token, PR #766).
 *
 * Accepts multipart/form-data: `videoId` + `frame` (image blob, typically
 * JPEG from client-side canvas extraction — lib/meta/video-frame-extract.ts).
 *
 * A failure here is never fatal to the wizard — callers should surface it
 * as a soft "couldn't set custom thumbnail" notice, not block creative
 * launch. The thumb_offset-derived thumbnail from FIX 1 already renders
 * correctly either way.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadVideoThumbnail, MetaApiError } from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";

export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (parseErr) {
    return NextResponse.json(
      { error: "Failed to parse multipart form data", detail: String(parseErr) },
      { status: 400 },
    );
  }

  const videoId = formData.get("videoId") as string | null;
  const frame = formData.get("frame") as File | null;

  if (!videoId) return NextResponse.json({ error: "Missing required field: 'videoId'" }, { status: 400 });
  if (!frame) return NextResponse.json({ error: "Missing required field: 'frame'" }, { status: 400 });
  if (frame.size === 0) return NextResponse.json({ error: "'frame' is empty (0 bytes)" }, { status: 400 });

  let token: string | undefined;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
  } catch {
    token = undefined; // uploadVideoThumbnail falls back to META_ACCESS_TOKEN
  }

  console.log("[upload-video-thumbnail] override attempt:", {
    videoId,
    frameSizeBytes: frame.size,
    tokenSource: token ? "resolved" : "META_ACCESS_TOKEN (env)",
  });

  try {
    const result = await uploadVideoThumbnail(videoId, frame, token);
    console.log("[upload-video-thumbnail] ✓ override applied:", { videoId, ...result });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof MetaApiError) {
      const payload = err.toJSON();
      console.error("[upload-video-thumbnail] Meta API error:", JSON.stringify(payload, null, 2));
      return NextResponse.json(
        { error: payload.error ?? "Meta API error", code: payload.code, metaError: payload },
        { status: 502 },
      );
    }
    console.error("[upload-video-thumbnail] Unexpected error:", err);
    return NextResponse.json({ error: `Unexpected error: ${String(err)}` }, { status: 500 });
  }
}
