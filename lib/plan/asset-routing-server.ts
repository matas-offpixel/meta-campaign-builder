import { readTikTokAccountCredentials } from "../tiktok/api-account.ts";
import { createServiceRoleClient } from "../supabase/server.ts";
import type { CampaignDraft } from "../types.ts";
import type { TikTokCampaignDraft } from "../types/tiktok-draft.ts";
import {
  applyTikTokAssetRouting,
  liveTikTokRegistryUploader,
  persistRoutedTikTokDraft,
  tikTokLaunchIsLive,
  type ApplyTikTokAssetRoutingResult,
} from "./asset-routing-execute.ts";
import type { CampaignPlan } from "./types.ts";

export async function runPlanTikTokAssetFanout(input: {
  supabase: unknown;
  plan: CampaignPlan;
  metaDraft: CampaignDraft | null;
  tiktokDraft: TikTokCampaignDraft;
}): Promise<ApplyTikTokAssetRoutingResult> {
  const advertiserId = input.tiktokDraft.accountSetup.advertiserId;
  const credentials = advertiserId
    ? await readTikTokAccountCredentials(input.supabase as never, {
        userId: input.plan.userId,
        advertiserId,
      })
    : null;
  const storage = createServiceRoleClient();
  const applied = await applyTikTokAssetRouting({
    supabase: input.supabase,
    plan: input.plan,
    metaDraft: input.metaDraft,
    tiktokDraft: input.tiktokDraft,
    advertiserId,
    token: credentials?.accessToken ?? null,
    launched: tikTokLaunchIsLive({
      planStatus: input.plan.launches.tiktok.status,
      publishedIds: input.tiktokDraft.publishedIds,
    }),
    upload: liveTikTokRegistryUploader({
      token: credentials?.accessToken ?? "",
      storage: {
        createSignedUrl: async (bucket, path, expiresIn) => {
          const { data, error } = await storage.storage
            .from(bucket)
            .createSignedUrl(path, expiresIn);
          return { signedUrl: data?.signedUrl ?? null, error: error?.message ?? null };
        },
        remove: async () => undefined,
      },
    }),
  });
  await persistRoutedTikTokDraft(input.supabase, applied.draft, input.plan.userId);
  return applied;
}
