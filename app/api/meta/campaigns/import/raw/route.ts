import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { handleMetaImportRaw } from "@/lib/meta/import/raw";

/**
 * GET /api/meta/campaigns/import/raw?adAccountId=…&campaignId=…
 *
 * Runs the intended Meta import reads with a recording `request`
 * injected, and returns each call's path, the params that went on
 * the wire, and Meta's verbatim `data`. It saves nothing, maps
 * nothing, and is linked from no UI.
 *
 * It exists because a hand-written fixture cannot reject a field
 * name — the TikTok importer shipped green in #944 and was wrong
 * about nesting. Drive this route once and the fixture stops being
 * a guess. The two answers PR B needs: `geo_locations.cities[]`
 * (does `key` come back?) and `flexible_spec[]`.
 *
 * Read-only against live campaigns: Graph GET plus the Batch API
 * POST `/` that replaced `GET /?ids=` in v26.0. No write to the
 * source campaign, no draft save. Operator allowlist because the
 * response is an ad account's full campaign structure.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const result = await handleMetaImportRaw({
    adAccountId: req.nextUrl.searchParams.get("adAccountId"),
    campaignId: req.nextUrl.searchParams.get("campaignId"),
    userId: user?.id ?? null,
    supabase,
  });
  return NextResponse.json(result.body, { status: result.status });
}
