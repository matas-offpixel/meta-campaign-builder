/**
 * Read-only: `/campaign/get/` and `/adgroup/get/` for the attach pickers
 * and for launch-time re-validation. Never writes.
 */

import type { TikTokCampaignDraft } from "../../types/tiktok-draft.ts";
import { tiktokGet } from "../client.ts";
import { pageRows } from "../import/readers.ts";
import {
  TIKTOK_ATTACH_ADGROUP_FIELDS,
  TIKTOK_ATTACH_CAMPAIGN_FIELDS,
  isLiveTikTokStatus,
  normalizeTikTokAttachAdGroup,
  normalizeTikTokAttachCampaign,
  tikTokAttachTargetsFromSnapshots,
  type TikTokAttachAdGroup,
  type TikTokAttachCampaign,
  type TikTokAttachLiveTargets,
} from "./targets.ts";

type TikTokGet = typeof tiktokGet;

const PAGE_SIZE = 1000;
/** `filtering.campaign_ids` accepts at most 100 ids per request. */
export const TIKTOK_CAMPAIGN_IDS_FILTER_MAX = 100;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function listTikTokAttachCampaigns(input: {
  advertiserId: string;
  token: string;
  campaignIds?: readonly string[];
  request?: TikTokGet;
}): Promise<TikTokAttachCampaign[]> {
  const request = input.request ?? tiktokGet;
  const filters = input.campaignIds
    ? chunk([...new Set(input.campaignIds)], TIKTOK_CAMPAIGN_IDS_FILTER_MAX).map(
        (ids) => ({ campaign_ids: ids }),
      )
    : [undefined];
  const out: TikTokAttachCampaign[] = [];
  for (const filtering of filters) {
    const rows = await pageRows<Record<string, unknown>>({
      path: "/campaign/get/",
      advertiserId: input.advertiserId,
      token: input.token,
      request,
      fields: TIKTOK_ATTACH_CAMPAIGN_FIELDS,
      ...(filtering ? { filtering } : {}),
      pageSize: PAGE_SIZE,
    });
    for (const row of rows) {
      const campaign = normalizeTikTokAttachCampaign(row);
      if (campaign && isLiveTikTokStatus(campaign)) out.push(campaign);
    }
  }
  return out;
}

export async function listTikTokAttachAdGroups(input: {
  advertiserId: string;
  token: string;
  campaignIds: readonly string[];
  request?: TikTokGet;
}): Promise<TikTokAttachAdGroup[]> {
  const request = input.request ?? tiktokGet;
  const out: TikTokAttachAdGroup[] = [];
  for (const ids of chunk([...new Set(input.campaignIds)], TIKTOK_CAMPAIGN_IDS_FILTER_MAX)) {
    const rows = await pageRows<Record<string, unknown>>({
      path: "/adgroup/get/",
      advertiserId: input.advertiserId,
      token: input.token,
      request,
      fields: TIKTOK_ATTACH_ADGROUP_FIELDS,
      filtering: { campaign_ids: ids },
      pageSize: PAGE_SIZE,
    });
    for (const row of rows) {
      const adGroup = normalizeTikTokAttachAdGroup(row);
      if (adGroup && isLiveTikTokStatus(adGroup)) out.push(adGroup);
    }
  }
  return out;
}

export function tikTokAttachCampaignIds(draft: TikTokCampaignDraft): string[] {
  const ids =
    draft.launchMode === "attach_adgroup"
      ? (draft.attachAdGroups ?? []).map((group) => group.campaignId)
      : (draft.attachCampaigns ?? []).map((campaign) => campaign.id);
  return [...new Set(ids.filter(Boolean))];
}

/**
 * Launch-time re-read of the targets. A failed read is logged and the
 * selection-time snapshot stands in — the plan refuses only on what a
 * successful read proves (#1013/#1014 doctrine).
 */
export async function readTikTokAttachTargets(input: {
  draft: TikTokCampaignDraft;
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokAttachLiveTargets> {
  const snapshot = tikTokAttachTargetsFromSnapshots(input.draft);
  const campaignIds = tikTokAttachCampaignIds(input.draft);
  if (campaignIds.length === 0) return snapshot;

  let campaigns: TikTokAttachCampaign[] = snapshot.campaigns;
  let source: TikTokAttachLiveTargets["source"] = "live";
  try {
    campaigns = await listTikTokAttachCampaigns({
      advertiserId: input.advertiserId,
      token: input.token,
      campaignIds,
      request: input.request,
    });
  } catch (err) {
    source = "snapshot";
    console.error(
      `[tiktok/attach] campaign read failed advertiser=${input.advertiserId} campaigns=${campaignIds.join(",")}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    if (input.draft.launchMode === "attach_adgroup" && campaigns.length === 0) {
      campaigns = snapshotParents(input.draft);
    }
  }

  try {
    const adGroups = await listTikTokAttachAdGroups({
      advertiserId: input.advertiserId,
      token: input.token,
      campaignIds,
      request: input.request,
    });
    return { source, campaigns, adGroups, adGroupReadFailed: [] };
  } catch (err) {
    console.error(
      `[tiktok/attach] ad group read failed advertiser=${input.advertiserId} campaigns=${campaignIds.join(",")}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return {
      source: "snapshot",
      campaigns,
      adGroups: snapshot.adGroups,
      adGroupReadFailed: campaignIds,
    };
  }
}

/** `attach_adgroup` may store only ad groups; their parents come from them. */
function snapshotParents(draft: TikTokCampaignDraft): TikTokAttachCampaign[] {
  const seen = new Map<string, TikTokAttachCampaign>();
  for (const group of draft.attachAdGroups ?? []) {
    if (seen.has(group.campaignId)) continue;
    seen.set(group.campaignId, {
      id: group.campaignId,
      name: group.campaignName,
      operationStatus: null,
      secondaryStatus: null,
      objectiveType: null,
      salesDestination: null,
      budgetMode: null,
      budgetOptimizeOn: false,
      automationType: null,
      isSmartPerformanceCampaign: false,
    });
  }
  return [...seen.values()];
}
