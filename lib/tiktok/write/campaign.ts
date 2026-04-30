import { assertTikTokWritesEnabled } from "./feature-flag.ts";
import {
  withTikTokWriteIdempotency,
  type TikTokWriteContext,
} from "./idempotency.ts";
import { postTikTokWrite } from "./request.ts";

export interface CreateTikTokCampaignArgs extends TikTokWriteContext {
  campaignName: string;
  objective: string;
  budgetMode?: string | null;
}

interface CreateCampaignResponse {
  campaign_id?: string;
}

export async function createTikTokCampaign(
  args: CreateTikTokCampaignArgs,
): Promise<{ campaign_id: string }> {
  assertTikTokWritesEnabled();

  const payload = {
    advertiser_id: args.advertiserId,
    campaign_name: args.campaignName,
    objective_type: args.objective,
    budget_mode: args.budgetMode ?? undefined,
  };

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
