/**
 * Launch into existing TikTok campaigns / ad groups.
 *
 * Never creates a campaign, and never modifies or deletes a campaign or
 * ad group that existed before the run. On failure it deletes only what
 * this run created and clears only those idempotency rows. Targets are
 * excluded from every status-update body by construction and by
 * `assertNotTarget`.
 */

import { TikTokApiError, type BodyValue } from "../client.ts";
import type { TikTokAttachPlan } from "../attach/plan.ts";
import { buildTikTokAdWritePayload, postTikTokAdCreate } from "./ad.ts";
import { postTikTokAdGroupCreate } from "./adgroup.ts";
import { assertTikTokWritesEnabled } from "./feature-flag.ts";
import {
  clearTikTokWriteIdempotencyForResults,
  type TikTokWriteContext,
} from "./idempotency.ts";
import type { TikTokLaunchProgress } from "./progress.ts";
import { postTikTokWrite } from "./request.ts";
import type { TikTokLaunchEntity } from "./types.ts";

/**
 * Official SDK: AdgroupApi.adgroup_status_update →
 * `POST /open_api/v1.3/adgroup/status/update/` (AdgroupStatusUpdateBody:
 * advertiser_id, adgroup_ids, operation_status) and AdApi.ad_status_update →
 * `POST /open_api/v1.3/ad/status/update/` (AdStatusUpdateBody:
 * advertiser_id, ad_ids, operation_status).
 * https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/AdgroupApi.md
 * https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/AdApi.md
 */
export const TIKTOK_ADGROUP_STATUS_UPDATE_PATH = "/adgroup/status/update/";
export const TIKTOK_AD_STATUS_UPDATE_PATH = "/ad/status/update/";
const DELETE_STATUS = "DELETE";
/** Not documented in the SDK; kept at the `filtering.campaign_ids` cap. */
const STATUS_UPDATE_BATCH = 100;

export interface LaunchTikTokAttachArgs extends TikTokWriteContext {
  onProgress?: (progress: TikTokLaunchProgress) => void;
}

export interface LaunchTikTokAttachResult {
  mode: TikTokAttachPlan["mode"];
  /** Every campaign written into (none created). */
  campaign_ids: string[];
  /** Ad groups this run created. Empty for the ads-only modes. */
  adgroup_ids: string[];
  ad_ids: string[];
  entities: TikTokLaunchEntity[];
}

export function tikTokAttachLeftBehindMessage(left: {
  adgroupIds: string[];
  adIds: string[];
}): string {
  const parts: string[] = [];
  if (left.adgroupIds.length) parts.push(`ad groups ${left.adgroupIds.join(", ")}`);
  if (left.adIds.length) parts.push(`ads ${left.adIds.join(", ")}`);
  return `This launch created ${parts.join(" and ")} and could not remove them. Delete them in Ads Manager before retrying. The existing campaigns and ad groups were not changed.`;
}

function withLeftBehind(err: unknown, left: { adgroupIds: string[]; adIds: string[] }): Error {
  const extra = tikTokAttachLeftBehindMessage(left);
  if (err instanceof TikTokApiError) {
    return new TikTokApiError(`${err.message}. ${extra}`, err.code, err.requestId, err.httpStatus);
  }
  return new Error(`${err instanceof Error ? err.message : String(err)}. ${extra}`);
}

export function tikTokAttachTargetIds(plan: TikTokAttachPlan): {
  campaignIds: Set<string>;
  adGroupIds: Set<string>;
} {
  return {
    campaignIds: new Set([
      ...plan.campaigns.map((c) => c.campaignId),
      ...plan.adGroups.map((g) => g.campaignId),
    ]),
    adGroupIds: new Set(plan.adGroups.map((g) => g.adGroupId)),
  };
}

export async function launchTikTokAttachPlan(
  args: LaunchTikTokAttachArgs,
  plan: TikTokAttachPlan,
): Promise<LaunchTikTokAttachResult> {
  assertTikTokWritesEnabled();
  const context: TikTokWriteContext = args;
  const adGroupsTotal = plan.counts.adGroupsCreated;
  const adsTotal = plan.counts.ads;
  const createdAdGroups: string[] = [];
  /** Ads created inside an existing ad group (ads-only modes). */
  const createdLooseAds: string[] = [];
  /** Ads created inside an ad group this run created. */
  const createdNestedAds: string[] = [];
  const entities: TikTokLaunchEntity[] = [];
  const report = (phase: TikTokLaunchProgress["phase"], campaignId: string) =>
    args.onProgress?.({
      phase,
      campaignId,
      adGroupsDone: createdAdGroups.length,
      adGroupsTotal,
      adsDone: createdLooseAds.length + createdNestedAds.length,
      adsTotal,
    });

  try {
    for (const campaign of plan.campaigns) {
      for (const adGroup of campaign.adGroups) {
        const { adgroup_id } = await postTikTokAdGroupCreate(context, adGroup.payload);
        createdAdGroups.push(adgroup_id);
        entities.push({ kind: "adgroup", id: adgroup_id, name: adGroup.name, status: "created" });
        report("adgroup", campaign.campaignId);
        for (const ad of adGroup.ads) {
          const payload = buildTikTokAdWritePayload({
            advertiserId: context.advertiserId,
            adGroupId: adgroup_id,
            draft: ad.draft,
            creative: ad.creative,
          });
          const { ad_id } = await postTikTokAdCreate(context, payload);
          createdNestedAds.push(ad_id);
          entities.push({ kind: "ad", id: ad_id, name: ad.creative.name, status: "created" });
          report("ad", campaign.campaignId);
        }
      }
    }
    for (const target of plan.adGroups) {
      for (const ad of target.ads) {
        const { ad_id } = await postTikTokAdCreate(context, ad.payload);
        createdLooseAds.push(ad_id);
        entities.push({ kind: "ad", id: ad_id, name: ad.creative.name, status: "created" });
        report("ad", target.campaignId);
      }
    }
  } catch (err) {
    const left = await rollbackTikTokAttach(context, plan, {
      adgroupIds: createdAdGroups,
      nestedAdIds: createdNestedAds,
      looseAdIds: createdLooseAds,
    });
    throw left.adgroupIds.length || left.adIds.length ? withLeftBehind(err, left) : err;
  }

  const campaignIds = [
    ...new Set([
      ...plan.campaigns.map((c) => c.campaignId),
      ...plan.adGroups.map((g) => g.campaignId),
    ]),
  ];
  return {
    mode: plan.mode,
    campaign_ids: campaignIds,
    adgroup_ids: createdAdGroups,
    ad_ids: [...createdNestedAds, ...createdLooseAds],
    entities,
  };
}

function assertNotTarget(
  ids: readonly string[],
  targets: Set<string>,
  kind: string,
): string[] {
  const safe = ids.filter((id) => !targets.has(id));
  if (safe.length !== ids.length) {
    console.error(
      `[tiktok-write] attach rollback refused to delete pre-existing ${kind} ${ids.filter((id) => targets.has(id)).join(",")}`,
    );
  }
  return safe;
}

async function postStatusDelete(
  context: TikTokWriteContext,
  path: string,
  key: "adgroup_ids" | "ad_ids",
  ids: readonly string[],
): Promise<string[]> {
  const deleted: string[] = [];
  for (let i = 0; i < ids.length; i += STATUS_UPDATE_BATCH) {
    const batch = ids.slice(i, i + STATUS_UPDATE_BATCH);
    try {
      await postTikTokWrite({
        path,
        body: {
          advertiser_id: context.advertiserId,
          [key]: batch,
          operation_status: DELETE_STATUS,
        } as Record<string, BodyValue>,
        token: context.token,
        request: context.request,
        sleep: context.sleep,
      });
      deleted.push(...batch);
      console.error(`[tiktok-write] attach rollback ${key}=${batch.join(",")} outcome=deleted`);
    } catch (err) {
      console.error(
        `[tiktok-write] attach rollback ${key}=${batch.join(",")} outcome=failed error=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return deleted;
}

/**
 * Deletes what this run created. Ads inside a created ad group go with
 * it; ads inside an existing ad group are deleted one by one. Returns
 * what could not be removed.
 */
export async function rollbackTikTokAttach(
  context: TikTokWriteContext,
  plan: TikTokAttachPlan,
  created: { adgroupIds: string[]; nestedAdIds: string[]; looseAdIds: string[] },
): Promise<{ adgroupIds: string[]; adIds: string[] }> {
  const targets = tikTokAttachTargetIds(plan);
  const adgroupIds = assertNotTarget(
    assertNotTarget(created.adgroupIds, targets.adGroupIds, "ad group"),
    targets.campaignIds,
    "campaign",
  );
  const looseAdIds = created.looseAdIds;

  const deletedGroups = adgroupIds.length
    ? await postStatusDelete(context, TIKTOK_ADGROUP_STATUS_UPDATE_PATH, "adgroup_ids", adgroupIds)
    : [];
  const deletedAds = looseAdIds.length
    ? await postStatusDelete(context, TIKTOK_AD_STATUS_UPDATE_PATH, "ad_ids", looseAdIds)
    : [];

  const groupsGone = deletedGroups.length === adgroupIds.length;
  const removed = [
    ...deletedGroups,
    ...(groupsGone ? created.nestedAdIds : []),
    ...deletedAds,
  ];
  try {
    await clearTikTokWriteIdempotencyForResults(context, removed);
  } catch (err) {
    console.warn(
      `[tiktok-write] failed to clear attach idempotency for draft ${context.draftId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return {
    adgroupIds: adgroupIds.filter((id) => !deletedGroups.includes(id)),
    adIds: [
      ...looseAdIds.filter((id) => !deletedAds.includes(id)),
      ...(groupsGone ? [] : created.nestedAdIds),
    ],
  };
}
