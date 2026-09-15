import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { handleTikTokImportRaw } from "@/lib/tiktok/import/raw";

/**
 * GET /api/tiktok/campaigns/import/raw?advertiserId=…&campaignId=…
 *
 * Runs exactly the reads `POST /api/tiktok/campaigns/import` runs, with
 * a recording `request` injected, and returns each call's path, the
 * params that went on the wire, and TikTok's verbatim `data`. It saves
 * nothing, maps nothing, and is linked from no UI.
 *
 * It exists because `__fixtures__/doc-derived-v1.3.ts` passed every test
 * in #944 and was wrong in the two places that mattered: a fixture
 * cannot reject a field name, and a hand-written `creative_list[]` row
 * cannot disagree with the mapper that wrote it. Drive this route once
 * and the fixture stops being a guess.
 *
 * Read-only: no POST to TikTok, no write to Supabase, and no dependency
 * on the launcher killswitch (this path cannot write). Operator
 * allowlist because the response is an advertiser's full campaign
 * structure.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const result = await handleTikTokImportRaw({
    advertiserId: req.nextUrl.searchParams.get("advertiserId"),
    campaignId: req.nextUrl.searchParams.get("campaignId"),
    userId: user?.id ?? null,
    supabase,
  });
  return NextResponse.json(result.body, { status: result.status });
}
