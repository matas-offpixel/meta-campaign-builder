import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { readTikTokAccountCredentials } from "@/lib/tiktok/api-account";
import { fetchTikTokVideoInfo } from "@/lib/tiktok/creative";

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

  const advertiserId = req.nextUrl.searchParams.get("advertiser_id");
  const videoIds = req.nextUrl.searchParams.getAll("video_id").filter(Boolean);
  if (!advertiserId || videoIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Missing advertiser_id or video_id query param" },
      { status: 400 },
    );
  }

  const credentials = await readTikTokAccountCredentials(supabase, {
    userId: user.id,
    advertiserId,
  });
  if (!credentials) {
    return NextResponse.json(
      { ok: false, error: "TikTok credentials missing" },
      { status: 400 },
    );
  }

  try {
    const videos = await fetchTikTokVideoInfo({
      advertiserId,
      token: credentials.accessToken,
      videoIds,
    });
    return NextResponse.json({ ok: true, videos }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[tiktok/creative/video-info] read failed:", message);
    return NextResponse.json(
      { ok: false, error: message, videos: [] },
      { status: 200 },
    );
  }
}
