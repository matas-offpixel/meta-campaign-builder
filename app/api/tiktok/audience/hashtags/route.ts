import { NextResponse, type NextRequest } from "next/server";

import { requireTikTokAudienceContext } from "@/lib/tiktok/audience-route";
import {
  fetchTikTokHashtagRecommendations,
  type TikTokHashtagOperator,
} from "@/lib/tiktok/audience";

/**
 * GET /api/tiktok/audience/hashtags
 *
 * Query:
 *   advertiser_id  required
 *   keyword        required, repeatable, max 10 after trim.
 *                  Repeat the param (`?keyword=techno&keyword=house`) or
 *                  comma-separate (`?keyword=techno,house`). The plural
 *                  `keywords=` form is ignored — `?keywords=techno` is
 *                  a 400 because no `keyword` values were collected.
 *   operator       optional, AND | OR (default AND)
 */
export async function GET(req: NextRequest) {
  const context = await requireTikTokAudienceContext(req);
  if (!context.ok) return context.response;

  const keywords = req.nextUrl.searchParams
    .getAll("keyword")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 10);
  if (keywords.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Missing keyword query params", hashtags: [] },
      { status: 400 },
    );
  }

  const operatorRaw = req.nextUrl.searchParams.get("operator");
  const operator: TikTokHashtagOperator =
    operatorRaw === "OR" ? "OR" : "AND";

  try {
    const hashtags = await fetchTikTokHashtagRecommendations({
      advertiserId: context.advertiserId,
      token: context.accessToken,
      keywords,
      operator,
    });
    return NextResponse.json({ ok: true, failed: false, hashtags }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tiktok/audience/hashtags] failed:", message);
    return NextResponse.json(
      {
        ok: true,
        failed: true,
        error: message,
        hashtags: [],
      },
      { status: 200 },
    );
  }
}
