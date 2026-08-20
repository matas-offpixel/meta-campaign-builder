import { NextResponse, type NextRequest } from "next/server";

import { requireTikTokAudienceContext } from "@/lib/tiktok/audience-route";
import {
  fetchTikTokInterestKeywordRecommendations,
  type TikTokInterestAudienceType,
  type TikTokInterestKeywordMode,
} from "@/lib/tiktok/audience";

const MODES = new Set<TikTokInterestKeywordMode>([
  "FUZZ_MATCH",
  "SEMANTIC_RECOMMEND",
]);
const AUDIENCE_TYPES = new Set<TikTokInterestAudienceType>([
  "GENERAL_INTEREST",
  "PURCHASE_INTENTION",
]);

export async function GET(req: NextRequest) {
  const context = await requireTikTokAudienceContext(req);
  if (!context.ok) return context.response;

  const keyword = req.nextUrl.searchParams.get("keyword")?.trim() ?? "";
  if (!keyword) {
    return NextResponse.json(
      { ok: false, error: "Missing keyword query param", keywords: [] },
      { status: 400 },
    );
  }

  const modeRaw = req.nextUrl.searchParams.get("mode");
  const audienceTypeRaw = req.nextUrl.searchParams.get("audience_type");
  const limitRaw = req.nextUrl.searchParams.get("limit");
  const mode = MODES.has(modeRaw as TikTokInterestKeywordMode)
    ? (modeRaw as TikTokInterestKeywordMode)
    : "FUZZ_MATCH";
  const audienceType = AUDIENCE_TYPES.has(
    audienceTypeRaw as TikTokInterestAudienceType,
  )
    ? (audienceTypeRaw as TikTokInterestAudienceType)
    : "GENERAL_INTEREST";
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 50;

  try {
    const keywords = await fetchTikTokInterestKeywordRecommendations({
      advertiserId: context.advertiserId,
      token: context.accessToken,
      keyword,
      mode,
      audienceType,
      limit,
    });
    return NextResponse.json({ ok: true, failed: false, keywords }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tiktok/audience/keywords] failed:", message);
    return NextResponse.json(
      {
        ok: true,
        failed: true,
        error: message,
        keywords: [],
      },
      { status: 200 },
    );
  }
}
