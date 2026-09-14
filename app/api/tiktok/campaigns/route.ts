import { NextResponse, type NextRequest } from "next/server";

import { credentialsForImportAdvertiser } from "@/lib/tiktok/import/account";
import { listTikTokLiveCampaigns } from "@/lib/tiktok/import/readers";
import type { TikTokLiveCampaignRow } from "@/lib/tiktok/import/types";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/tiktok/campaigns?advertiserId=…
 *
 * Lists live campaigns for the Import from TikTok picker. Read-only.
 */
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

  const advertiserId = req.nextUrl.searchParams.get("advertiserId");
  if (!advertiserId) {
    return NextResponse.json(
      { ok: false, error: "Missing advertiserId query param" },
      { status: 400 },
    );
  }

  const credentials = await credentialsForImportAdvertiser(supabase, {
    userId: user.id,
    advertiserId,
  });
  if ("error" in credentials) {
    return NextResponse.json(
      { ok: false, error: credentials.error, campaigns: [] as TikTokLiveCampaignRow[] },
      { status: credentials.status },
    );
  }

  try {
    const campaigns = await listTikTokLiveCampaigns({
      advertiserId,
      token: credentials.token,
    });
    return NextResponse.json({ ok: true, campaigns }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tiktok/campaigns] list failed:", message);
    return NextResponse.json(
      {
        ok: false,
        error: message || "TikTok campaign list failed",
        campaigns: [] as TikTokLiveCampaignRow[],
      },
      { status: 200 },
    );
  }
}
