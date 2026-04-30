import { assertTikTokWritesEnabled } from "./feature-flag.ts";
import {
  withTikTokWriteIdempotency,
  type TikTokWriteContext,
} from "./idempotency.ts";
import { postTikTokWrite } from "./request.ts";

export interface CreateTikTokAdGroupArgs extends TikTokWriteContext {
  campaignId: string;
  adGroupName: string;
  budget: number | null;
  scheduleStartAt: string | null;
  scheduleEndAt: string | null;
  optimisationGoal: string | null;
}

interface CreateAdGroupResponse {
  adgroup_id?: string;
}

export async function createTikTokAdGroup(
  args: CreateTikTokAdGroupArgs,
): Promise<{ adgroup_id: string }> {
  assertTikTokWritesEnabled();

  const payload = {
    advertiser_id: args.advertiserId,
    campaign_id: args.campaignId,
    adgroup_name: args.adGroupName,
    budget: args.budget ?? undefined,
    schedule_start_time: args.scheduleStartAt ?? undefined,
    schedule_end_time: args.scheduleEndAt ?? undefined,
    optimization_goal: args.optimisationGoal ?? undefined,
  };

  const adgroupId = await withTikTokWriteIdempotency(
    args,
    "adgroup_create",
    payload,
    async () => {
      const res = await postTikTokWrite<CreateAdGroupResponse>({
        path: "/adgroup/create/",
        body: payload,
        token: args.token,
        request: args.request,
        sleep: args.sleep,
      });
      if (!res.adgroup_id) {
        throw new Error("TikTok ad group create returned no adgroup_id");
      }
      return res.adgroup_id;
    },
  );

  return { adgroup_id: adgroupId };
}
