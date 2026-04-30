import { assertTikTokWritesEnabled } from "./feature-flag.ts";
import {
  withTikTokWriteIdempotency,
  type TikTokWriteContext,
} from "./idempotency.ts";
import { postTikTokWrite } from "./request.ts";

export interface CreateTikTokAdArgs extends TikTokWriteContext {
  adGroupId: string;
  adName: string;
  videoId: string;
  adText: string;
  displayName: string;
  landingPageUrl: string;
  cta: string | null;
  identityId: string | null;
}

interface CreateAdResponse {
  ad_id?: string;
}

export async function createTikTokAd(
  args: CreateTikTokAdArgs,
): Promise<{ ad_id: string }> {
  assertTikTokWritesEnabled();

  const payload = {
    advertiser_id: args.advertiserId,
    adgroup_id: args.adGroupId,
    ad_name: args.adName,
    video_id: args.videoId,
    ad_text: args.adText,
    display_name: args.displayName,
    landing_page_url: args.landingPageUrl,
    call_to_action: args.cta ?? undefined,
    identity_id: args.identityId ?? undefined,
  };

  const adId = await withTikTokWriteIdempotency(args, "ad_create", payload, async () => {
    const res = await postTikTokWrite<CreateAdResponse>({
      path: "/ad/create/",
      body: payload,
      token: args.token,
      request: args.request,
      sleep: args.sleep,
    });
    if (!res.ad_id) {
      throw new Error("TikTok ad create returned no ad_id");
    }
    return res.ad_id;
  });

  return { ad_id: adId };
}
