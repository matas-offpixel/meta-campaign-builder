import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { readTikTokAccountCredentials } from "@/lib/tiktok/api-account";
import { fetchTikTokVideoLibrary } from "@/lib/tiktok/creative";

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
  if (!advertiserId) {
    return NextResponse.json(
      { ok: false, error: "Missing advertiser_id query param" },
      { status: 400 },
    );
  }

  const page = Number(req.nextUrl.searchParams.get("page") ?? "1");
  const pageSize = Number(req.nextUrl.searchParams.get("page_size") ?? "20");

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
    const result = await fetchTikTokVideoLibrary({
      advertiserId,
      token: credentials.accessToken,
      page,
      pageSize,
    });
    return NextResponse.json(
      {
        ok: true,
        videos: result.videos,
        page: result.page,
        page_size: result.pageSize,
        total_number: result.totalNumber,
        total_page: result.totalPage,
      },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[tiktok/creative/videos] read failed:", message);
    return NextResponse.json(
      { ok: false, error: message, videos: [] },
      { status: 200 },
    );
  }
}
