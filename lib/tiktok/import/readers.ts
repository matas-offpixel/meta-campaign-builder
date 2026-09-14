import { tiktokGet } from "../client.ts";
import {
  TIKTOK_IMPORT_ENVELOPE_LIST_KEYS,
  requireArrayFromCandidates,
} from "./envelope.ts";
import {
  classifyTikTokCampaign,
  type TikTokLiveCampaignKind,
  type TikTokLiveCampaignRow,
} from "./types.ts";

type TikTokGet = typeof tiktokGet;

const LIST_PAGE_SIZE = 1000;
const SMART_PLUS_PAGE_SIZE = 100;
const MAX_PAGES = 20;

export type TikTokListEnvelope<T> = {
  list?: T[];
  page_info?: { total_page?: number; page?: number };
};

export type TikTokCampaignGetRow = {
  campaign_id?: string;
  campaign_name?: string;
  objective_type?: string | null;
  virtual_objective_type?: string | null;
  sales_destination?: string | null;
  budget?: number | string | null;
  budget_mode?: string | null;
  operation_status?: string | null;
  secondary_status?: string | null;
  campaign_automation_type?: string | null;
  is_smart_performance_campaign?: boolean | null;
};

export type TikTokAdGroupGetRow = Record<string, unknown> & {
  adgroup_id?: string;
  adgroup_name?: string;
  campaign_id?: string;
  budget?: number | string;
  budget_mode?: string;
  optimization_goal?: string;
  optimization_event?: string;
  bid_type?: string;
  conversion_bid_price?: number | string;
  bid_price?: number | string;
  pixel_id?: string;
  location_ids?: Array<string | number>;
  age_groups?: string[];
  gender?: string;
  languages?: string[];
  interest_category_ids?: Array<string | number>;
  interest_keyword_ids?: Array<string | number>;
  purchase_intention_keyword_ids?: Array<string | number>;
  audience_ids?: Array<string | number>;
  excluded_audience_ids?: Array<string | number>;
  saved_audience_id?: string;
  actions?: Array<{ action_category_ids?: Array<string | number> }>;
  schedule_start_time?: string;
  schedule_end_time?: string;
  schedule_type?: string;
  pacing?: string;
  placements?: string[];
  placement_type?: string;
  targeting_spec?: Record<string, unknown>;
  operating_systems?: string[];
  min_android_version?: string;
  min_ios_version?: string;
  device_model_ids?: Array<string | number>;
  connection_type?: string;
  carrier_ids?: Array<string | number>;
  isp_ids?: Array<string | number>;
  network_types?: string[];
};

export type TikTokAdGetRow = Record<string, unknown> & {
  ad_id?: string;
  ad_name?: string;
  campaign_id?: string;
  adgroup_id?: string;
  video_id?: string | null;
  image_ids?: string[] | null;
  tiktok_item_id?: string | null;
  identity_id?: string;
  identity_type?: string;
  identity_authorized_bc_id?: string;
  identity_bc_id?: string;
  landing_page_url?: string;
  ad_text?: string;
  call_to_action?: string;
  is_aco?: boolean;
  creative_authorized?: boolean;
  campaign_automation_type?: string;
  creative_list?: TikTokSmartPlusCreativeRow[];
};

export type TikTokSmartPlusCreativeRow = {
  creative_id?: string;
  video_id?: string;
  image_ids?: string[];
  ad_text?: string;
  identity_id?: string;
  identity_type?: string;
  identity_authorized_bc_id?: string;
  landing_page_url?: string;
  call_to_action?: string;
  tiktok_item_id?: string;
};

export type TikTokSpcGetRow = Record<string, unknown> & {
  campaign_id?: string;
  campaign_name?: string;
  objective_type?: string;
  virtual_objective_type?: string;
  sales_destination?: string;
  budget?: number | string;
  budget_mode?: string;
  operation_status?: string;
  pixel_id?: string;
  optimization_event?: string;
  optimization_goal?: string;
  location_ids?: Array<string | number>;
  age_groups?: string[];
  gender?: string;
  languages?: string[];
  identity_id?: string;
  identity_type?: string;
  landing_page_url?: string;
  media_info_list?: Array<{
    media_info?: { video_info?: { video_id?: string } };
  }>;
  title_list?: Array<{ title?: string }>;
};

export const CAMPAIGN_GET_FIELDS = [
  "campaign_id",
  "campaign_name",
  "objective_type",
  "virtual_objective_type",
  "sales_destination",
  "budget",
  "budget_mode",
  "operation_status",
  "secondary_status",
  "campaign_automation_type",
  "is_smart_performance_campaign",
] as const;

export const ADGROUP_GET_FIELDS = [
  "adgroup_id",
  "adgroup_name",
  "campaign_id",
  "budget",
  "budget_mode",
  "optimization_goal",
  "optimization_event",
  "bid_type",
  "conversion_bid_price",
  "bid_price",
  "pixel_id",
  "location_ids",
  "age_groups",
  "gender",
  "languages",
  "interest_category_ids",
  "interest_keyword_ids",
  "purchase_intention_keyword_ids",
  "audience_ids",
  "excluded_audience_ids",
  "saved_audience_id",
  "actions",
  "schedule_start_time",
  "schedule_end_time",
  "schedule_type",
  "pacing",
  "placements",
  "placement_type",
  "operating_systems",
  "min_android_version",
  "min_ios_version",
  "device_model_ids",
  "connection_type",
  "carrier_ids",
  "isp_ids",
  "network_types",
] as const;

export const AD_GET_FIELDS = [
  "ad_id",
  "ad_name",
  "campaign_id",
  "adgroup_id",
  "video_id",
  "image_ids",
  "tiktok_item_id",
  "identity_id",
  "identity_type",
  "identity_authorized_bc_id",
  "landing_page_url",
  "ad_text",
  "call_to_action",
  "is_aco",
  "creative_authorized",
  "campaign_automation_type",
] as const;

async function pageRows<T>(input: {
  path: string;
  advertiserId: string;
  token: string;
  request: TikTokGet;
  fields?: readonly string[];
  filtering?: Record<string, unknown>;
  pageSize: number;
}): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const params: {
      advertiser_id: string;
      page: number;
      page_size: number;
      fields?: string[];
      filtering?: Record<string, unknown>;
    } = {
      advertiser_id: input.advertiserId,
      page,
      page_size: input.pageSize,
    };
    if (input.fields) params.fields = [...input.fields];
    if (input.filtering) params.filtering = input.filtering;
    const res = await input.request<TikTokListEnvelope<T>>(
      input.path,
      params,
      input.token,
    );
    const rows = requireArrayFromCandidates<T>(
      res,
      TIKTOK_IMPORT_ENVELOPE_LIST_KEYS,
      `${input.path} envelope`,
    );
    out.push(...rows);
    const totalPage = res.page_info?.total_page;
    if (!totalPage || page >= totalPage) break;
  }
  return out;
}

export async function listTikTokLiveCampaigns(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokLiveCampaignRow[]> {
  const request = input.request ?? tiktokGet;
  const rows = await pageRows<TikTokCampaignGetRow>({
    path: "/campaign/get/",
    advertiserId: input.advertiserId,
    token: input.token,
    request,
    fields: CAMPAIGN_GET_FIELDS,
    pageSize: LIST_PAGE_SIZE,
  });
  return rows
    .filter((row): row is TikTokCampaignGetRow & { campaign_id: string } =>
      Boolean(row.campaign_id),
    )
    .map((row) => ({
      id: row.campaign_id,
      name: typeof row.campaign_name === "string" ? row.campaign_name : row.campaign_id,
      objective: row.objective_type ?? null,
      status: row.operation_status ?? row.secondary_status ?? null,
      kind: classifyTikTokCampaign(row),
    }));
}

export async function fetchTikTokCampaignRow(input: {
  advertiserId: string;
  campaignId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokCampaignGetRow | null> {
  const request = input.request ?? tiktokGet;
  const rows = await pageRows<TikTokCampaignGetRow>({
    path: "/campaign/get/",
    advertiserId: input.advertiserId,
    token: input.token,
    request,
    fields: CAMPAIGN_GET_FIELDS,
    filtering: { campaign_ids: [input.campaignId] },
    pageSize: LIST_PAGE_SIZE,
  });
  return rows.find((row) => row.campaign_id === input.campaignId) ?? rows[0] ?? null;
}

export async function fetchTikTokAdGroups(input: {
  advertiserId: string;
  campaignId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokAdGroupGetRow[]> {
  const request = input.request ?? tiktokGet;
  return pageRows<TikTokAdGroupGetRow>({
    path: "/adgroup/get/",
    advertiserId: input.advertiserId,
    token: input.token,
    request,
    fields: ADGROUP_GET_FIELDS,
    filtering: { campaign_ids: [input.campaignId] },
    pageSize: LIST_PAGE_SIZE,
  });
}

export async function fetchTikTokAds(input: {
  advertiserId: string;
  campaignId: string;
  token: string;
  request?: TikTokGet;
  filtering?: Record<string, unknown>;
}): Promise<TikTokAdGetRow[]> {
  const request = input.request ?? tiktokGet;
  return pageRows<TikTokAdGetRow>({
    path: "/ad/get/",
    advertiserId: input.advertiserId,
    token: input.token,
    request,
    fields: AD_GET_FIELDS,
    filtering: {
      campaign_ids: [input.campaignId],
      ...(input.filtering ?? {}),
    },
    pageSize: LIST_PAGE_SIZE,
  });
}

export async function fetchTikTokSmartPlusAdGroups(input: {
  advertiserId: string;
  campaignId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokAdGroupGetRow[]> {
  const request = input.request ?? tiktokGet;
  return pageRows<TikTokAdGroupGetRow>({
    path: "/smart_plus/adgroup/get/",
    advertiserId: input.advertiserId,
    token: input.token,
    request,
    filtering: { campaign_ids: [input.campaignId] },
    pageSize: SMART_PLUS_PAGE_SIZE,
  });
}

export async function fetchTikTokSmartPlusAds(input: {
  advertiserId: string;
  campaignId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokAdGetRow[]> {
  const request = input.request ?? tiktokGet;
  return pageRows<TikTokAdGetRow>({
    path: "/smart_plus/ad/get/",
    advertiserId: input.advertiserId,
    token: input.token,
    request,
    filtering: { campaign_ids: [input.campaignId] },
    pageSize: SMART_PLUS_PAGE_SIZE,
  });
}

/**
 * /smart_plus/ad/get/ omits auto-added creatives. /ad/get/ with
 * campaign_automation_type UPGRADED_SMART_PLUS returns the full manual
 * ad shape, including TikTok-added rows. Never use ad_ids_v2.
 *
 * Unverified until a live capture: `filtering.campaign_automation_type`
 * is documented, not yet seen on Ironworks.
 */
export async function fetchTikTokUpgradedCreativesViaAdGet(input: {
  advertiserId: string;
  campaignId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokAdGetRow[]> {
  return fetchTikTokAds({
    ...input,
    filtering: { campaign_automation_type: "UPGRADED_SMART_PLUS" },
  });
}

export async function fetchTikTokLegacySmartCampaign(input: {
  advertiserId: string;
  campaignId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokSpcGetRow | null> {
  const request = input.request ?? tiktokGet;
  const rows = await pageRows<TikTokSpcGetRow>({
    path: "/campaign/spc/get/",
    advertiserId: input.advertiserId,
    token: input.token,
    request,
    filtering: { campaign_ids: [input.campaignId] },
    // Unverified until capture: docs allow 1000; live /campaign/spc/get/
    // page_size max is not confirmed.
    pageSize: LIST_PAGE_SIZE,
  });
  return rows.find((row) => row.campaign_id === input.campaignId) ?? rows[0] ?? null;
}

export type TikTokImportLiveBundle = {
  kind: TikTokLiveCampaignKind;
  campaign: TikTokCampaignGetRow;
  adGroups: TikTokAdGroupGetRow[];
  ads: TikTokAdGetRow[];
  chosenAds: TikTokAdGetRow[];
  autoAddedAds: TikTokAdGetRow[];
  spc: TikTokSpcGetRow | null;
};

export async function readTikTokLiveCampaign(input: {
  advertiserId: string;
  campaignId: string;
  token: string;
  request?: TikTokGet;
}): Promise<TikTokImportLiveBundle> {
  const campaign = await fetchTikTokCampaignRow(input);
  if (!campaign?.campaign_id) {
    throw new Error(`TikTok campaign ${input.campaignId} was not found`);
  }
  const kind = classifyTikTokCampaign(campaign);
  if (kind === "legacy_smart_plus") {
    const spc = await fetchTikTokLegacySmartCampaign(input);
    if (!spc) {
      throw new Error(
        `TikTok import failed: /campaign/spc/get/ returned no row for ${input.campaignId}`,
      );
    }
    return {
      kind,
      campaign,
      adGroups: [],
      ads: [],
      chosenAds: [],
      autoAddedAds: [],
      spc,
    };
  }
  if (kind === "smart_plus") {
    const [adGroups, chosenAds, allAds] = await Promise.all([
      fetchTikTokSmartPlusAdGroups(input),
      fetchTikTokSmartPlusAds(input),
      fetchTikTokUpgradedCreativesViaAdGet(input),
    ]);
    if (adGroups.length === 0) {
      throw new Error(
        `TikTok import failed: /smart_plus/adgroup/get/ returned no ad groups for ${input.campaignId}`,
      );
    }
    if (chosenAds.length === 0) {
      throw new Error(
        `TikTok import failed: /smart_plus/ad/get/ returned no ads for ${input.campaignId}`,
      );
    }
    const chosenIds = new Set(
      chosenAds.flatMap((ad) => creativeKeysFromSmartPlusAd(ad)),
    );
    const autoAddedAds = allAds.filter((ad) => {
      const key = ad.ad_id ?? ad.video_id ?? "";
      return key ? !chosenIds.has(key) : false;
    });
    return {
      kind,
      campaign,
      adGroups,
      ads: allAds,
      chosenAds,
      autoAddedAds,
      spc: null,
    };
  }
  const [adGroups, ads] = await Promise.all([
    fetchTikTokAdGroups(input),
    fetchTikTokAds(input),
  ]);
  if (adGroups.length === 0) {
    throw new Error(
      `TikTok import failed: /adgroup/get/ returned no ad groups for ${input.campaignId}`,
    );
  }
  if (ads.length === 0) {
    throw new Error(
      `TikTok import failed: /ad/get/ returned no ads for ${input.campaignId}`,
    );
  }
  return {
    kind,
    campaign,
    adGroups,
    ads,
    chosenAds: ads,
    autoAddedAds: [],
    spc: null,
  };
}

/**
 * Chosen vs TikTok-added split. Assumes `/ad/get/` `ad_id` equals
 * `/smart_plus/ad/get/` `creative_id` (the doc-derived fixture sets
 * both to the same string, so a test cannot fail this). Unverified
 * until capture. Video ids are a second key so a mismatch still
 * matches on the asset.
 */
function creativeKeysFromSmartPlusAd(ad: TikTokAdGetRow): string[] {
  const keys: string[] = [];
  if (ad.ad_id) keys.push(ad.ad_id);
  const list = requireArrayFromCandidates<TikTokSmartPlusCreativeRow>(
    ad,
    ["creative_list"],
    "/smart_plus/ad/get/ creative_list",
  );
  for (const creative of list) {
    if (creative.creative_id) keys.push(creative.creative_id);
    if (creative.video_id) keys.push(creative.video_id);
  }
  return keys;
}
