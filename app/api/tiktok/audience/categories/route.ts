import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { readTikTokAccountCredentials } from "@/lib/tiktok/api-account";
import {
  fetchTikTokAudienceSize,
  fetchTikTokBehaviourCategories,
  fetchTikTokCustomAudiences,
  fetchTikTokInterestCategories,
  fetchTikTokSavedAudiences,
} from "@/lib/tiktok/audience";

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
    const selectedIds = req.nextUrl.searchParams.getAll("selected_id");
    const [interests, behaviours, customAudiences, savedAudiences, estimatedReach] =
      await Promise.all([
        fetchTikTokInterestCategories({
          advertiserId,
          token: credentials.accessToken,
        }),
        fetchTikTokBehaviourCategories({
          advertiserId,
          token: credentials.accessToken,
        }).catch(() => []),
        fetchTikTokCustomAudiences({
          advertiserId,
          token: credentials.accessToken,
        }).catch(() => []),
        fetchTikTokSavedAudiences({
          advertiserId,
          token: credentials.accessToken,
        }).catch(() => []),
        fetchTikTokAudienceSize({
          advertiserId,
          token: credentials.accessToken,
          selectedIds,
        }).catch(() => null),
      ]);

    return NextResponse.json(
      {
        ok: true,
        interests,
        behaviours,
        customAudiences,
        savedAudiences,
        estimatedReach,
      },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[tiktok/audience/categories] read failed:", message);
    return NextResponse.json(
      {
        ok: false,
        error: message,
        interests: [],
        behaviours: [],
        customAudiences: [],
        savedAudiences: [],
        estimatedReach: null,
      },
      { status: 200 },
    );
  }
}
