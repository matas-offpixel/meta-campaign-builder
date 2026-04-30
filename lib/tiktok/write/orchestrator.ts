import { getTikTokDraft } from "../../db/tiktok-drafts.ts";
import type { TikTokCampaignDraft } from "../../types/tiktok-draft.ts";
import { createTikTokAd } from "./ad.ts";
import { createTikTokAdGroup } from "./adgroup.ts";
import { createTikTokCampaign } from "./campaign.ts";
import { assertTikTokWritesEnabled } from "./feature-flag.ts";
import type { TikTokWriteContext } from "./idempotency.ts";
import { postTikTokWrite } from "./request.ts";

export interface LaunchTikTokDraftArgs
  extends Omit<TikTokWriteContext, "draftId" | "advertiserId"> {
  draftId: string;
}

export interface LaunchTikTokDraftResult {
  campaign_id: string;
  adgroup_ids: string[];
  ad_ids: string[];
}

export async function launchTikTokDraft(
  args: LaunchTikTokDraftArgs,
): Promise<LaunchTikTokDraftResult> {
  assertTikTokWritesEnabled();
  const draft = await getTikTokDraft(
    args.supabase as Parameters<typeof getTikTokDraft>[0],
    args.draftId,
  );
  if (!draft) throw new Error("TikTok draft not found");
  return launchTikTokDraftState(args, draft);
}

export async function launchTikTokDraftState(
  args: LaunchTikTokDraftArgs,
  draft: TikTokCampaignDraft,
): Promise<LaunchTikTokDraftResult> {
  assertTikTokWritesEnabled();
  const advertiserId = draft.accountSetup.advertiserId;
  if (!advertiserId) throw new Error("TikTok advertiser is missing");

  const context: TikTokWriteContext = {
    ...args,
    advertiserId,
  };

  const createdCampaign = await createTikTokCampaign({
    ...context,
    campaignName: draft.campaignSetup.campaignName,
    objective: draft.campaignSetup.objective ?? "TRAFFIC",
    budgetMode: draft.budgetSchedule.budgetMode,
  });

  const adgroupIds: string[] = [];
  const adIds: string[] = [];

  try {
    for (const adGroup of draft.budgetSchedule.adGroups) {
      const createdAdGroup = await createTikTokAdGroup({
        ...context,
        campaignId: createdCampaign.campaign_id,
        adGroupName: adGroup.name,
        budget: adGroup.budget ?? draft.budgetSchedule.budgetAmount,
        scheduleStartAt: adGroup.startAt ?? draft.budgetSchedule.scheduleStartAt,
        scheduleEndAt: adGroup.endAt ?? draft.budgetSchedule.scheduleEndAt,
        optimisationGoal: draft.campaignSetup.optimisationGoal,
      });
      adgroupIds.push(createdAdGroup.adgroup_id);

      const creativeIds =
        draft.creativeAssignments.byAdGroupId[adGroup.id] ?? [];
      for (const creativeId of creativeIds) {
        const creative = draft.creatives.items.find(
          (item) => item.id === creativeId,
        );
        if (!creative?.videoId) continue;
        const createdAd = await createTikTokAd({
          ...context,
          adGroupId: createdAdGroup.adgroup_id,
          adName: creative.name,
          videoId: creative.videoId,
          adText: creative.adText,
          displayName: creative.displayName,
          landingPageUrl: creative.landingPageUrl,
          cta: creative.cta,
          identityId: draft.accountSetup.identityId,
        });
        adIds.push(createdAd.ad_id);
      }
    }
  } catch (err) {
    await cleanupTikTokCampaign(context, createdCampaign.campaign_id);
    throw err;
  }

  return {
    campaign_id: createdCampaign.campaign_id,
    adgroup_ids: adgroupIds,
    ad_ids: adIds,
  };
}

async function cleanupTikTokCampaign(
  context: TikTokWriteContext,
  campaignId: string,
): Promise<void> {
  try {
    await postTikTokWrite({
      path: "/campaign/delete/",
      body: {
        advertiser_id: context.advertiserId,
        campaign_ids: [campaignId],
      },
      token: context.token,
      request: context.request,
      sleep: context.sleep,
    });
  } catch (err) {
    console.warn(
      `[tiktok-write] failed to clean up campaign ${campaignId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
