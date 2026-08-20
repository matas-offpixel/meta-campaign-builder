import { NextResponse, type NextRequest } from "next/server";

import {
  requireTikTokAudienceContext,
  settleAudienceDimension,
} from "@/lib/tiktok/audience-route";
import {
  fetchTikTokBehaviourCategories,
  fetchTikTokCustomAudiences,
  fetchTikTokInterestCategories,
  fetchTikTokSavedAudiences,
} from "@/lib/tiktok/audience";

export async function GET(req: NextRequest) {
  const context = await requireTikTokAudienceContext(req);
  if (!context.ok) return context.response;

  const [interests, behaviours, customAudiences, savedAudiences] =
    await Promise.all([
      settleAudienceDimension(
        () =>
          fetchTikTokInterestCategories({
            advertiserId: context.advertiserId,
            token: context.accessToken,
          }),
        [],
      ),
      settleAudienceDimension(
        () =>
          fetchTikTokBehaviourCategories({
            advertiserId: context.advertiserId,
            token: context.accessToken,
          }),
        [],
      ),
      settleAudienceDimension(
        () =>
          fetchTikTokCustomAudiences({
            advertiserId: context.advertiserId,
            token: context.accessToken,
          }),
        [],
      ),
      settleAudienceDimension(
        () =>
          fetchTikTokSavedAudiences({
            advertiserId: context.advertiserId,
            token: context.accessToken,
          }),
        [],
      ),
    ]);

  return NextResponse.json(
    {
      ok: true,
      interests: interests.value,
      behaviours: behaviours.value,
      customAudiences: customAudiences.value,
      savedAudiences: savedAudiences.value,
      failed: {
        interests: interests.failed,
        behaviours: behaviours.failed,
        customAudiences: customAudiences.failed,
        savedAudiences: savedAudiences.failed,
      },
      errors: {
        interests: interests.error,
        behaviours: behaviours.error,
        customAudiences: customAudiences.error,
        savedAudiences: savedAudiences.error,
      },
    },
    { status: 200 },
  );
}
