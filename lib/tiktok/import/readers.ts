import { tiktokGet } from "../client.ts";
import { fetchTikTokVideoLibrary } from "../creative.ts";
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
  landing_page_url?: string;
  ad_text?: string;
  call_to_action?: string;
  is_aco?: boolean;
  creative_authorized?: boolean;
  campaign_automation_type?: string;
};

/**
 * `/smart_plus/ad/get/` rows are asset groups, not ads, and every
 * creative field is nested. Shape below is verbatim from
 * https://business-api.tiktok.com/portal/docs/get-upgraded-smart-ads/v1.3
 * (doc-derived, pending the live capture from the raw route).
 *
 * #944 read `ad_id`, `creative_id`, `video_id`, `image_ids`, `ad_text`,
 * `landing_page_url`, `call_to_action` and `identity_*` flat off these
 * rows. None of those keys exist at that level, which is why the
 * Ironworks import saved 45 creatives with `videoId: null`.
 */
export type TikTokSmartPlusAdRow = Record<string, unknown> & {
  smart_plus_ad_id?: string;
  ad_name?: string;
  campaign_id?: string;
  adgroup_id?: string;
  operation_status?: string;
  creative_list?: TikTokSmartPlusCreativeRow[];
  /** Ad-level, not per creative. TikTok pairs them at delivery. */
  ad_text_list?: Array<{ ad_text?: string }>;
  call_to_action_list?: Array<{ call_to_action?: string }>;
  landing_page_url_list?: Array<{ landing_page_url?: string }>;
  ad_configuration?: TikTokSmartPlusAdConfiguration;
};

export type TikTokSmartPlusAdConfiguration = Record<string, unknown> & {
  identity_id?: string;
  identity_type?: string;
  identity_authorized_bc_id?: string;
  dark_post_status?: string;
  creative_auto_add_toggle?: boolean;
  creative_auto_enhancement_strategy_list?: string[];
};

export type TikTokSmartPlusCreativeRow = Record<string, unknown> & {
  /**
   * Doc: "This ID is the same as the `ad_id` you receive from `/ad/get/`
   * when you do not specify the `ad_ids_v2` filter." This — not
   * `ad_material_id`, and not `creative_id` (which does not exist) — is
   * the join key to `/ad/get/`.
   */
  smart_plus_creative_id?: string;
  /** Ad-specific; explicitly NOT the Creative Library id. Joins to nothing. */
  ad_material_id?: string;
  material_operation_status?: string;
  creative_info?: TikTokSmartPlusCreativeInfo;
};

export type TikTokSmartPlusCreativeInfo = Record<string, unknown> & {
  ad_format?: string;
  material_name?: string;
  video_info?: { video_id?: string; file_name?: string; thumbnail_mode?: string };
  image_info?: Array<{ web_uri?: string }>;
  music_info?: { music_id?: string };
  tiktok_item_id?: string;
  identity_id?: string;
  identity_type?: string;
  identity_authorized_bc_id?: string;
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
}): Promise<TikTokSmartPlusAdRow[]> {
  const request = input.request ?? tiktokGet;
  return pageRows<TikTokSmartPlusAdRow>({
    path: "/smart_plus/ad/get/",
    advertiserId: input.advertiserId,
    token: input.token,
    request,
    filtering: { campaign_ids: [input.campaignId] },
    pageSize: SMART_PLUS_PAGE_SIZE,
  });
}

/**
 * /smart_plus/ad/get/ omits auto-added creatives ("This field only
 * returns creatives that you have explicitly selected… To retrieve all
 * creatives in a campaign, including those added automatically, use
 * /ad/get/" —
 * https://business-api.tiktok.com/portal/docs/get-upgraded-smart-ads/v1.3).
 * /ad/get/ with campaign_automation_type UPGRADED_SMART_PLUS returns the
 * full manual ad shape. Never use ad_ids_v2 — the doc's
 * smart_plus_creative_id equality holds only without that filter.
 *
 * VERIFIED LIVE 2026-09-15 on advertiser 7639802149165301776: 45 rows
 * with ad_id, ad_name, video_id, image_ids, tiktok_item_id.
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

const LIBRARY_PAGE_SIZE = 100;
const LIBRARY_MAX_PAGES = 50;

/**
 * Every `video_id` in the advertiser's Creative Library.
 *
 * A relaunch recreates the campaign the operator launched, so it carries
 * only assets that are still in the library — the same set a
 * `VIDEO_REFERENCE` creative can reference at launch. TikTok's
 * delivery-time variants are not in it and are reported, not imported.
 *
 * A failed read throws and a truncated read throws: an empty library is
 * a claim about the advertiser, and a partial one would silently turn
 * real originals into "not carried".
 */
export async function fetchTikTokCreativeLibraryVideoIds(input: {
  advertiserId: string;
  token: string;
  request?: TikTokGet;
}): Promise<string[]> {
  const ids = new Set<string>();
  let page = 1;
  for (;;) {
    const result = await fetchTikTokVideoLibrary({
      advertiserId: input.advertiserId,
      token: input.token,
      page,
      pageSize: LIBRARY_PAGE_SIZE,
      request: input.request,
    });
    for (const video of result.videos) ids.add(video.video_id);
    const totalPage = result.totalPage;
    if (totalPage > LIBRARY_MAX_PAGES) {
      throw new Error(
        `TikTok import failed: Creative Library has ${totalPage} pages, more than the ${LIBRARY_MAX_PAGES}-page read cap. Refusing to decide what to carry from a partial library.`,
      );
    }
    if (!totalPage || page >= totalPage) break;
    page += 1;
  }
  return [...ids];
}

export type TikTokImportLiveBundle = {
  kind: TikTokLiveCampaignKind;
  campaign: TikTokCampaignGetRow;
  adGroups: TikTokAdGroupGetRow[];
  /** `/ad/get/` — the full manual shape, chosen and TikTok-added alike. */
  ads: TikTokAdGetRow[];
  /** `/smart_plus/ad/get/` — asset groups, explicitly-selected creatives only. */
  smartPlusAds: TikTokSmartPlusAdRow[];
  spc: TikTokSpcGetRow | null;
  libraryVideoIds: readonly string[];
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
  const library = fetchTikTokCreativeLibraryVideoIds(input);

  if (kind === "legacy_smart_plus") {
    const [spc, libraryVideoIds] = await Promise.all([
      fetchTikTokLegacySmartCampaign(input),
      library,
    ]);
    if (!spc) {
      throw new Error(
        `TikTok import failed: /campaign/spc/get/ returned no row for ${input.campaignId}`,
      );
    }
    requireNonEmptyLibrary(libraryVideoIds);
    return {
      kind,
      campaign,
      adGroups: [],
      ads: [],
      smartPlusAds: [],
      spc,
      libraryVideoIds,
    };
  }

  if (kind === "smart_plus") {
    const [adGroups, smartPlusAds, ads, libraryVideoIds] = await Promise.all([
      fetchTikTokSmartPlusAdGroups(input),
      fetchTikTokSmartPlusAds(input),
      fetchTikTokUpgradedCreativesViaAdGet(input),
      library,
    ]);
    if (adGroups.length === 0) {
      throw new Error(
        `TikTok import failed: /smart_plus/adgroup/get/ returned no ad groups for ${input.campaignId}`,
      );
    }
    // An Upgraded Smart+ campaign may legitimately have zero explicitly
    // selected creatives — TikTok documents creative_list as returning
    // only what you chose. Zero across BOTH reads is the failure.
    if (smartPlusAds.length === 0 && ads.length === 0) {
      throw new Error(
        `TikTok import failed: neither /smart_plus/ad/get/ nor /ad/get/ returned an ad for ${input.campaignId}`,
      );
    }
    requireNonEmptyLibrary(libraryVideoIds);
    return {
      kind,
      campaign,
      adGroups,
      ads,
      smartPlusAds,
      spc: null,
      libraryVideoIds,
    };
  }

  const [adGroups, ads, libraryVideoIds] = await Promise.all([
    fetchTikTokAdGroups(input),
    fetchTikTokAds(input),
    library,
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
  requireNonEmptyLibrary(libraryVideoIds);
  return {
    kind,
    campaign,
    adGroups,
    ads,
    smartPlusAds: [],
    spc: null,
    libraryVideoIds,
  };
}

function requireNonEmptyLibrary(videoIds: readonly string[]): void {
  if (videoIds.length > 0) return;
  throw new Error(
    "TikTok import failed: /file/video/ad/search/ returned no videos. An empty Creative Library on an advertiser that is running ads is a read failure, not a reason to carry nothing.",
  );
}
