import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { readTikTokAccountCredentials } from "@/lib/tiktok/api-account";
import { uploadCoverForCreative } from "@/lib/tiktok/write/cover-image";
import type { TikTokCreativeDraft } from "@/lib/types/tiktok-draft";

/**
 * POST /api/tiktok/creative/cover
 *
 * Resolves one video creative's cover when it is added, so a failure
 * is on the row in Creatives rather than only at launch.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    advertiserId?: unknown;
    creative?: Partial<TikTokCreativeDraft>;
  };
  const advertiserId = typeof body.advertiserId === "string" ? body.advertiserId.trim() : "";
  const creative = body.creative;
  if (!advertiserId || !creative || typeof creative !== "object") {
    return NextResponse.json(
      { ok: false, error: "advertiserId and creative are required" },
      { status: 400 },
    );
  }

  const credentials = await readTikTokAccountCredentials(supabase, {
    userId: user.id,
    advertiserId,
  });
  if (!credentials?.accessToken) {
    return NextResponse.json(
      { ok: false, error: "TikTok credentials missing" },
      { status: 400 },
    );
  }

  const outcome = await uploadCoverForCreative({
    creative: {
      id: typeof creative.id === "string" ? creative.id : "creative",
      name: typeof creative.name === "string" ? creative.name : "Creative",
      mode: "VIDEO_REFERENCE",
      baseName: "",
      videoId: typeof creative.videoId === "string" ? creative.videoId : null,
      videoUrl: null,
      thumbnailUrl: typeof creative.thumbnailUrl === "string" ? creative.thumbnailUrl : null,
      durationSeconds: null,
      title: null,
      sparkPostId: null,
      caption: "",
      adText: "",
      displayName: "",
      landingPageUrl: "",
      cta: null,
      musicId: null,
    },
    advertiserId,
    token: credentials.accessToken,
  });

  if (outcome.imageId) {
    return NextResponse.json({ ok: true, coverImageId: outcome.imageId, error: null });
  }
  return NextResponse.json({ ok: false, coverImageId: null, error: outcome.error });
}
