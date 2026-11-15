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
 * Launch-time re-read of the targets. A failed read is logged and
 * returned as `read_failed`, which the plan refuses: a snapshot can't
 * rule out Smart+.
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
  const failed = { ...snapshot, source: "read_failed" as const };

  let campaigns: TikTokAttachCampaign[];
  try {
    campaigns = await listTikTokAttachCampaigns({
      advertiserId: input.advertiserId,
      token: input.token,
      campaignIds,
      request: input.request,
    });
  } catch (err) {
    console.error(
      `[tiktok/attach] campaign read failed advertiser=${input.advertiserId} campaigns=${campaignIds.join(",")}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return failed;
  }

  try {
    const adGroups = await listTikTokAttachAdGroups({
      advertiserId: input.advertiserId,
      token: input.token,
      campaignIds,
      request: input.request,
    });
    return { source: "live", campaigns, adGroups };
  } catch (err) {
    console.error(
      `[tiktok/attach] ad group read failed advertiser=${input.advertiserId} campaigns=${campaignIds.join(",")}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return failed;
  }
}
