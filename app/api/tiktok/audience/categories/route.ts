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
      await Promise.allSettled([
        fetchTikTokInterestCategories({
          advertiserId,
          token: credentials.accessToken,
        }),
        fetchTikTokBehaviourCategories({
          advertiserId,
          token: credentials.accessToken,
        }),
        fetchTikTokCustomAudiences({
          advertiserId,
          token: credentials.accessToken,
        }),
        fetchTikTokSavedAudiences({
          advertiserId,
          token: credentials.accessToken,
        }),
        fetchTikTokAudienceSize({
          advertiserId,
          token: credentials.accessToken,
          selectedIds,
        }),
      ]);

    if (interests.status === "rejected") throw interests.reason;

    return NextResponse.json(
      {
        ok: true,
        interests: interests.value,
        behaviours: behaviours.status === "fulfilled" ? behaviours.value : [],
        customAudiences:
          customAudiences.status === "fulfilled" ? customAudiences.value : [],
        savedAudiences: savedAudiences.status === "fulfilled" ? savedAudiences.value : [],
        estimatedReach:
          estimatedReach.status === "fulfilled" ? estimatedReach.value : null,
        behaviourError:
          behaviours.status === "rejected" ? errorMessage(behaviours.reason) : null,
        customAudiencesError:
          customAudiences.status === "rejected"
            ? errorMessage(customAudiences.reason)
            : null,
        savedAudiencesError:
          savedAudiences.status === "rejected"
            ? errorMessage(savedAudiences.reason)
            : null,
        reachError:
          estimatedReach.status === "rejected"
            ? errorMessage(estimatedReach.reason)
            : null,
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
