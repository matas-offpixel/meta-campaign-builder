import type { BodyValue } from "../client.ts";
import type { TikTokCampaignDraft, TikTokCreativeDraft } from "../../types/tiktok-draft.ts";
import { assertTikTokWritesEnabled } from "./feature-flag.ts";
import {
  withTikTokWriteIdempotency,
  type TikTokWriteContext,
} from "./idempotency.ts";
import { buildTikTokAdPayload } from "./mapping.ts";
import { postTikTokWrite } from "./request.ts";

export interface CreateTikTokAdArgs extends TikTokWriteContext {
  adGroupId: string;
  draft: TikTokCampaignDraft;
  creative: TikTokCreativeDraft;
}

interface CreateAdResponse {
  ad_id?: string;
  ad_ids?: string[];
}

export function buildTikTokAdWritePayload(args: {
  advertiserId: string;
  adGroupId: string;
  draft: TikTokCampaignDraft;
  creative: TikTokCreativeDraft;
}): Record<string, BodyValue> {
  const built = buildTikTokAdPayload(args);
  if (!built.ok) {
    throw new Error(`${built.error.field}: ${built.error.message}`);
  }
  return built.value;
}

export async function createTikTokAd(
  args: CreateTikTokAdArgs,
): Promise<{ ad_id: string }> {
  assertTikTokWritesEnabled();

  const payload = buildTikTokAdWritePayload(args);

  const adId = await withTikTokWriteIdempotency(args, "ad_create", payload, async () => {
    const res = await postTikTokWrite<CreateAdResponse>({
      path: "/ad/create/",
      body: payload,
      token: args.token,
      request: args.request,
      sleep: args.sleep,
    });
    const id = res.ad_id ?? res.ad_ids?.[0];
    if (!id) {
      throw new Error("TikTok ad create returned no ad_id");
    }
    return id;
  });

  return { ad_id: adId };
}
