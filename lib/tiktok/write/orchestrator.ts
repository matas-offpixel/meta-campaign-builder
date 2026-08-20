import { getTikTokDraft } from "../../db/tiktok-drafts.ts";
import type { TikTokCampaignDraft } from "../../types/tiktok-draft.ts";
import { suggestTikTokAdGroups } from "../../tiktok-wizard/review.ts";
import { createTikTokAd } from "./ad.ts";
import { createTikTokAdGroup } from "./adgroup.ts";
import { createTikTokCampaign } from "./campaign.ts";
import { assertTikTokWritesEnabled } from "./feature-flag.ts";
import {
  clearTikTokWriteIdempotency,
  type TikTokWriteContext,
} from "./idempotency.ts";
import { collectTikTokLaunchPreflight } from "./preflight.ts";
import {
  plannedTikTokLaunchCounts,
  type TikTokLaunchProgress,
} from "./progress.ts";
import { postTikTokWrite } from "./request.ts";
import type { TikTokLaunchEntity } from "./types.ts";

export interface LaunchTikTokDraftArgs
  extends Omit<TikTokWriteContext, "draftId" | "advertiserId"> {
  draftId: string;
  existingCampaignNames?: string[];
  onProgress?: (progress: TikTokLaunchProgress) => void;
}

export interface LaunchTikTokDraftResult {
  campaign_id: string;
  adgroup_ids: string[];
  ad_ids: string[];
  entities: TikTokLaunchEntity[];
}

export type { TikTokLaunchEntity } from "./types.ts";

export class TikTokLaunchPreflightError extends Error {
  readonly issues: ReturnType<typeof collectTikTokLaunchPreflight>["issues"];

  constructor(issues: ReturnType<typeof collectTikTokLaunchPreflight>["issues"]) {
    super(issues.map((issue) => issue.message).join("; ") || "TikTok launch preflight failed");
    this.name = "TikTokLaunchPreflightError";
    this.issues = issues;
  }
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
  const preflight = collectTikTokLaunchPreflight(draft, {
    existingCampaignNames: args.existingCampaignNames,
  });
  if (!preflight.ok) {
    throw new TikTokLaunchPreflightError(preflight.issues);
  }

  const advertiserId = draft.accountSetup.advertiserId;
  if (!advertiserId) throw new Error("TikTok advertiser is missing");

  const context: TikTokWriteContext = {
    ...args,
    advertiserId,
  };

  const planned = plannedTikTokLaunchCounts(draft);
  const report = (progress: TikTokLaunchProgress) => {
    args.onProgress?.(progress);
  };

  const createdCampaign = await createTikTokCampaign({
    ...context,
    draft,
  });
  const entities: TikTokLaunchEntity[] = [
    {
      kind: "campaign",
      id: createdCampaign.campaign_id,
      name: draft.campaignSetup.campaignName,
      status: "created",
    },
  ];
  report({
    phase: "campaign",
    campaignId: createdCampaign.campaign_id,
    adGroupsDone: 0,
    adGroupsTotal: planned.adGroupsTotal,
    adsDone: 0,
    adsTotal: planned.adsTotal,
  });

  const adgroupIds: string[] = [];
  const adIds: string[] = [];

  try {
    for (const adGroup of suggestTikTokAdGroups(draft)) {
      const createdAdGroup = await createTikTokAdGroup({
        ...context,
        campaignId: createdCampaign.campaign_id,
        draft,
        adGroup,
      });
      adgroupIds.push(createdAdGroup.adgroup_id);
      entities.push({
        kind: "adgroup",
        id: createdAdGroup.adgroup_id,
        name: adGroup.name,
        status: "created",
      });
      report({
        phase: "adgroup",
        campaignId: createdCampaign.campaign_id,
        adGroupsDone: adgroupIds.length,
        adGroupsTotal: planned.adGroupsTotal,
        adsDone: adIds.length,
        adsTotal: planned.adsTotal,
      });

      const creativeIds = draft.creativeAssignments.byAdGroupId[adGroup.id] ?? [];
      for (const creativeId of creativeIds) {
        const creative = draft.creatives.items.find((item) => item.id === creativeId);
        if (!creative?.videoId) continue;
        const createdAd = await createTikTokAd({
          ...context,
          adGroupId: createdAdGroup.adgroup_id,
          draft,
          creative,
        });
        adIds.push(createdAd.ad_id);
        entities.push({
          kind: "ad",
          id: createdAd.ad_id,
          name: creative.name,
          status: "created",
        });
        report({
          phase: "ad",
          campaignId: createdCampaign.campaign_id,
          adGroupsDone: adgroupIds.length,
          adGroupsTotal: planned.adGroupsTotal,
          adsDone: adIds.length,
          adsTotal: planned.adsTotal,
        });
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
    entities,
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
    console.error(
      `[tiktok-write] campaign cleanup campaign_id=${campaignId} outcome=deleted`,
    );
  } catch (err) {
    console.error(
      `[tiktok-write] campaign cleanup campaign_id=${campaignId} outcome=failed error=${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  try {
    await clearTikTokWriteIdempotency(context);
  } catch (err) {
    console.warn(
      `[tiktok-write] failed to clear idempotency for draft ${context.draftId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
