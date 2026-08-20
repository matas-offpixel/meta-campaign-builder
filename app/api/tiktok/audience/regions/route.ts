import { NextResponse, type NextRequest } from "next/server";

import { requireTikTokAudienceContext } from "@/lib/tiktok/audience-route";
import { fetchTikTokRegions } from "@/lib/tiktok/audience";

export async function GET(req: NextRequest) {
  const context = await requireTikTokAudienceContext(req);
  if (!context.ok) return context.response;

  try {
    const regions = await fetchTikTokRegions({
      advertiserId: context.advertiserId,
      token: context.accessToken,
    });
    return NextResponse.json({ ok: true, failed: false, regions }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tiktok/audience/regions] failed:", message);
    return NextResponse.json(
      { ok: true, failed: true, error: message, regions: [] },
      { status: 200 },
    );
  }
}
