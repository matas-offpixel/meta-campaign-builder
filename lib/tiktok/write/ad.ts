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

export function tikTokAdCreateIdentityLog(body: Record<string, BodyValue>): {
  advertiser_id: unknown;
  adgroup_id: unknown;
  creatives: Array<{
    identity_id: unknown;
    identity_type: unknown;
    identity_authorized_bc_id: unknown;
    identity_bc_id: unknown;
    video_id: unknown;
    image_ids: unknown;
  }>;
} {
  const creatives = Array.isArray(body.creatives) ? body.creatives : [];
  return {
    advertiser_id: body.advertiser_id ?? null,
    adgroup_id: body.adgroup_id ?? null,
    creatives: creatives.map((item) => {
      const creative =
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : {};
      return {
        identity_id: creative.identity_id ?? null,
        identity_type: creative.identity_type ?? null,
        identity_authorized_bc_id: creative.identity_authorized_bc_id ?? null,
        identity_bc_id: creative.identity_bc_id ?? null,
        video_id: creative.video_id ?? null,
        image_ids: creative.image_ids ?? null,
      };
    }),
  };
}

function logTikTokAdCreateIdentityFields(body: Record<string, BodyValue>): void {
  console.error(
    `[tiktok/ad-create] outgoing identity fields ${JSON.stringify(tikTokAdCreateIdentityLog(body))}`,
  );
}

export async function createTikTokAd(
  args: CreateTikTokAdArgs,
): Promise<{ ad_id: string }> {
  assertTikTokWritesEnabled();

  const payload = buildTikTokAdWritePayload(args);

  const adId = await withTikTokWriteIdempotency(args, "ad_create", payload, async () => {
    logTikTokAdCreateIdentityFields(payload);
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
