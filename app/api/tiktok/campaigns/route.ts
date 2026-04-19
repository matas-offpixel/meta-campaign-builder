import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { TikTokCampaignRow } from "@/lib/types/tiktok";

/**
 * GET /api/tiktok/campaigns?advertiserId=…
 *
 * Lists campaigns under a given TikTok advertiser. STUB. Will be used
 * by the campaign-builder UI to pre-populate "duplicate from" pickers
 * once the OAuth flow is wired.
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

  return NextResponse.json(
    {
      ok: false,
      error: { reason: "not_configured", message: "TikTok not configured" },
      campaigns: [] as TikTokCampaignRow[],
    },
    { status: 200 },
  );
}
