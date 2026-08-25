import { getTikTokDraft } from "../../db/tiktok-drafts.ts";
import type { TikTokCampaignDraft } from "../../types/tiktok-draft.ts";
import { suggestTikTokAdGroups } from "../../tiktok-wizard/review.ts";
import { TikTokApiError } from "../client.ts";
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
  now?: Date;
  onProgress?: (progress: TikTokLaunchProgress) => void;
}

export interface LaunchTikTokDraftResult {
  campaign_id: string;
  adgroup_ids: string[];
  ad_ids: string[];
  entities: TikTokLaunchEntity[];
}

export type { TikTokLaunchEntity } from "./types.ts";

/**
 * Official SDK has no `/campaign/delete/`. Delete is a status update:
 * `POST /open_api/v1.3/campaign/status/update/`
 * (CampaignCreationApi.campaign_status_update, body CampaignStatusUpdateBody:
 * advertiser_id, campaign_ids, operation_status).
 * https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/CampaignCreationApi.md
 */
export const TIKTOK_CAMPAIGN_STATUS_UPDATE_PATH = "/campaign/status/update/";
export const TIKTOK_CAMPAIGN_DELETE_STATUS = "DELETE";

export function tikTokOrphanCampaignMessage(campaignId: string): string {
  return `An orphan campaign was left behind (id ${campaignId}). Delete it in Ads Manager before retrying.`;
}

export function withTikTokOrphanCampaign(
  err: unknown,
  campaignId: string,
): Error {
  const extra = tikTokOrphanCampaignMessage(campaignId);
  if (err instanceof TikTokApiError) {
    return new TikTokApiError(
      `${err.message}. ${extra}`,
      err.code,
      err.requestId,
      err.httpStatus,
    );
  }
  const base = err instanceof Error ? err.message : String(err);
  return new Error(`${base}. ${extra}`);
}

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
    now: args.now,
    advertiserTimezone: draft.accountSetup.timezone,
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
    const deleted = await cleanupTikTokCampaign(
      context,
      createdCampaign.campaign_id,
    );
    throw deleted
      ? err
      : withTikTokOrphanCampaign(err, createdCampaign.campaign_id);
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
): Promise<boolean> {
  let deleted = false;
  try {
    await postTikTokWrite({
      path: TIKTOK_CAMPAIGN_STATUS_UPDATE_PATH,
      body: {
        advertiser_id: context.advertiserId,
        campaign_ids: [campaignId],
        operation_status: TIKTOK_CAMPAIGN_DELETE_STATUS,
      },
      token: context.token,
      request: context.request,
      sleep: context.sleep,
    });
    deleted = true;
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
  return deleted;
}
