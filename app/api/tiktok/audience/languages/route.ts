import { NextResponse, type NextRequest } from "next/server";

import { requireTikTokAudienceContext } from "@/lib/tiktok/audience-route";
import { fetchTikTokLanguages } from "@/lib/tiktok/audience";

export async function GET(req: NextRequest) {
  const context = await requireTikTokAudienceContext(req);
  if (!context.ok) return context.response;

  try {
    const languages = await fetchTikTokLanguages({
      advertiserId: context.advertiserId,
      token: context.accessToken,
    });
    return NextResponse.json(
      { ok: true, failed: false, languages },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tiktok/audience/languages] failed:", message);
    return NextResponse.json(
      { ok: true, failed: true, error: message, languages: [] },
      { status: 200 },
    );
  }
}
