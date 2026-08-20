import type { BodyValue } from "../client.ts";
import type { TikTokCampaignDraft } from "../../types/tiktok-draft.ts";
import { assertTikTokWritesEnabled } from "./feature-flag.ts";
import {
  withTikTokWriteIdempotency,
  type TikTokWriteContext,
} from "./idempotency.ts";
import { buildTikTokCampaignPayload } from "./mapping.ts";
import { postTikTokWrite } from "./request.ts";

export interface CreateTikTokCampaignArgs extends TikTokWriteContext {
  draft: TikTokCampaignDraft;
}

interface CreateCampaignResponse {
  campaign_id?: string;
}

export function buildTikTokCampaignWritePayload(args: {
  advertiserId: string;
  draft: TikTokCampaignDraft;
}): Record<string, BodyValue> {
  const built = buildTikTokCampaignPayload(args);
  if (!built.ok) {
    throw new Error(`${built.error.field}: ${built.error.message}`);
  }
  return built.value;
}

export async function createTikTokCampaign(
  args: CreateTikTokCampaignArgs,
): Promise<{ campaign_id: string }> {
  assertTikTokWritesEnabled();

  const payload = buildTikTokCampaignWritePayload(args);

  const campaignId = await withTikTokWriteIdempotency(
    args,
    "campaign_create",
    payload,
    async () => {
      const res = await postTikTokWrite<CreateCampaignResponse>({
        path: "/campaign/create/",
        body: payload,
        token: args.token,
        request: args.request,
        sleep: args.sleep,
      });
      if (!res.campaign_id) {
        throw new Error("TikTok campaign create returned no campaign_id");
      }
      return res.campaign_id;
    },
  );

  return { campaign_id: campaignId };
}
