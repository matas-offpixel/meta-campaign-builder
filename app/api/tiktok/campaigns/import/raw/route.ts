import { NextResponse, type NextRequest } from "next/server";

import { isOperator } from "@/lib/auth/operator-allowlist";
import { createClient } from "@/lib/supabase/server";
import { credentialsForImportAdvertiser } from "@/lib/tiktok/import/account";
import { readTikTokLiveCampaign } from "@/lib/tiktok/import/readers";
import { recordingTikTokGet } from "@/lib/tiktok/import/record";

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
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }
  if (!isOperator(user.id)) {
    return NextResponse.json({ ok: false, error: "Not permitted" }, { status: 403 });
  }

  const advertiserId = req.nextUrl.searchParams.get("advertiserId")?.trim();
  const campaignId = req.nextUrl.searchParams.get("campaignId")?.trim();
  if (!advertiserId || !campaignId) {
    return NextResponse.json(
      { ok: false, error: "advertiserId and campaignId are required" },
      { status: 400 },
    );
  }

  const credentials = await credentialsForImportAdvertiser(supabase, {
    userId: user.id,
    advertiserId,
  });
  if ("error" in credentials) {
    return NextResponse.json(
      { ok: false, error: credentials.error },
      { status: credentials.status },
    );
  }

  const { request, calls } = recordingTikTokGet();
  let readError: string | null = null;
  try {
    await readTikTokLiveCampaign({
      advertiserId,
      campaignId,
      token: credentials.token,
      request,
    });
  } catch (err) {
    // A throw is a capture too — the `/adgroup/get/` accepted-field list
    // only exists because one request was rejected. Return everything
    // recorded up to the throw.
    readError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(
    {
      ok: readError == null,
      advertiserId,
      campaignId,
      capturedAt: new Date().toISOString(),
      note: "`data` is verbatim. The outer envelope (code, message, request_id) is only present on `error` because lib/tiktok/client.ts unwraps a code-0 response before this recorder sees it.",
      readError,
      calls,
    },
    { status: 200 },
  );
}
