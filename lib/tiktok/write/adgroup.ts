import type { BodyValue } from "../client.ts";
import type {
  TikTokAdGroupDraft,
  TikTokCampaignDraft,
} from "../../types/tiktok-draft.ts";
import { assertTikTokWritesEnabled } from "./feature-flag.ts";
import {
  withTikTokWriteIdempotency,
  type TikTokWriteContext,
} from "./idempotency.ts";
import { buildTikTokAdGroupPayload } from "./mapping.ts";
import { postTikTokWrite } from "./request.ts";

export interface CreateTikTokAdGroupArgs extends TikTokWriteContext {
  campaignId: string;
  draft: TikTokCampaignDraft;
  adGroup: TikTokAdGroupDraft;
}

interface CreateAdGroupResponse {
  adgroup_id?: string;
}

export function buildTikTokAdGroupWritePayload(args: {
  advertiserId: string;
  campaignId: string;
  draft: TikTokCampaignDraft;
  adGroup: TikTokAdGroupDraft;
}): Record<string, BodyValue> {
  const built = buildTikTokAdGroupPayload(args);
  if (!built.ok) {
    throw new Error(`${built.error.field}: ${built.error.message}`);
  }
  return built.value;
}

export function tikTokAdGroupCreateActionsLog(body: Record<string, BodyValue>): {
  advertiser_id: unknown;
  campaign_id: unknown;
  adgroup_name: unknown;
  actions: unknown;
} {
  return {
    advertiser_id: body.advertiser_id ?? null,
    campaign_id: body.campaign_id ?? null,
    adgroup_name: body.adgroup_name ?? null,
    actions: body.actions ?? null,
  };
}

function logTikTokAdGroupCreateActions(body: Record<string, BodyValue>): void {
  console.error(
    `[tiktok/adgroup-create] outgoing actions ${JSON.stringify(tikTokAdGroupCreateActionsLog(body))}`,
  );
}

export async function createTikTokAdGroup(
  args: CreateTikTokAdGroupArgs,
): Promise<{ adgroup_id: string }> {
  assertTikTokWritesEnabled();

  const payload = buildTikTokAdGroupWritePayload(args);

  const adgroupId = await withTikTokWriteIdempotency(
    args,
    "adgroup_create",
    payload,
    async () => {
      logTikTokAdGroupCreateActions(payload);
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
