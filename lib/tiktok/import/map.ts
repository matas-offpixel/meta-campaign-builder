import { nextDuplicateName } from "../../duplicate-name.ts";
import { duplicateTikTokDraftState } from "../../tiktok-wizard/library.ts";
import {
  createDefaultTikTokDraft,
  type TikTokAccountSetup,
  type TikTokAudiences,
  type TikTokBidStrategy,
  type TikTokCampaignDraft,
  type TikTokCreativeDraft,
  type TikTokObjective,
  type TikTokOptimisationGoal,
  type TikTokSalesDestination,
} from "../../types/tiktok-draft.ts";
import { isTikTokIdentityType } from "../identity.ts";
import {
  TIKTOK_AGE_GROUP_RANGES,
  TIKTOK_LOCATION_IDS_BY_CODE,
} from "../write/mapping.ts";
import type {
  TikTokAdGetRow,
  TikTokAdGroupGetRow,
  TikTokCampaignGetRow,
  TikTokImportLiveBundle,
  TikTokSmartPlusCreativeRow,
  TikTokSpcGetRow,
} from "./readers.ts";
import {
  TIKTOK_IMPORT_DROPPED_FIELDS,
  emptyImportEnhancements,
  enhancementsFromAds,
  relaunchCampaignName,
  type TikTokImportDroppedField,
  type TikTokImportMeta,
} from "./types.ts";

const LOCATION_CODES_BY_ID = Object.fromEntries(
  Object.entries(TIKTOK_LOCATION_IDS_BY_CODE).map(([code, id]) => [id, code]),
);

const OBJECTIVE_FROM_TIKTOK: Record<string, TikTokObjective> = {
  TRAFFIC: "TRAFFIC",
  LEAD_GENERATION: "LEAD_GENERATION",
  WEB_CONVERSIONS: "CONVERSIONS",
  CONVERSIONS: "CONVERSIONS",
  VIDEO_VIEWS: "VIDEO_VIEWS",
  REACH: "REACH",
  ENGAGEMENT: "ENGAGEMENT",
};

const GOAL_FROM_TIKTOK: Record<string, TikTokOptimisationGoal> = {
  CLICK: "CLICK",
  TRAFFIC_LANDING_PAGE_VIEW: "LANDING_PAGE_VIEW",
  LANDING_PAGE_VIEW: "LANDING_PAGE_VIEW",
  CONVERT: "CONVERSION",
  CONVERSION: "CONVERSION",
  VALUE: "VALUE",
  VIDEO_VIEW: "VIDEO_VIEW",
  ENGAGED_VIEW: "VIEW_6_SECOND",
  VIEW_6_SECOND: "VIEW_6_SECOND",
  REACH: "REACH",
  SHOW: "SHOW",
  ENGAGEMENT: "ENGAGEMENT",
};

export function collectDroppedFields(
  sources: ReadonlyArray<Record<string, unknown> | null | undefined>,
): TikTokImportDroppedField[] {
  const dropped: TikTokImportDroppedField[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    for (const field of TIKTOK_IMPORT_DROPPED_FIELDS) {
      if (field === "spc_audience_age") continue;
      if (!(field in source) || seen.has(field)) continue;
      seen.add(field);
      dropped.push({ field, sourceValue: source[field] });
    }
  }
  return dropped;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item == null ? "" : String(item).trim()))
    .filter(Boolean);
}

function unwrapTargeting(
  group: TikTokAdGroupGetRow,
): Record<string, unknown> {
  if (group.targeting_spec && typeof group.targeting_spec === "object") {
    return { ...group, ...group.targeting_spec };
  }
  return group;
}

function mapObjective(value: unknown): TikTokObjective | null {
  const key = asString(value);
  if (!key) return null;
  return OBJECTIVE_FROM_TIKTOK[key] ?? null;
}

function mapGoal(value: unknown): TikTokOptimisationGoal | null {
  const key = asString(value);
  if (!key) return null;
  return GOAL_FROM_TIKTOK[key] ?? null;
}

function mapBidStrategy(value: unknown): TikTokBidStrategy | null {
  const key = asString(value);
  if (key === "BID_TYPE_NO_BID") return "LOWEST_COST";
  if (key === "BID_TYPE_CUSTOM") return "COST_CAP";
  return null;
}

function mapBudgetMode(value: unknown): "DAILY" | "LIFETIME" {
  return asString(value) === "BUDGET_MODE_TOTAL" ? "LIFETIME" : "DAILY";
}

function mapSalesDestination(value: unknown): TikTokSalesDestination | null {
  const key = asString(value);
  if (key === "TIKTOK_SHOP" || key === "WEBSITE" || key === "APP") return key;
  return null;
}

function mapLocationCodes(ids: unknown): string[] {
  return asStringArray(ids).map(
    (id) => LOCATION_CODES_BY_ID[id] ?? id,
  );
}

function mapAgeRange(ageGroups: unknown): { ageMin: number; ageMax: number } | null {
  const groups = asStringArray(ageGroups);
  const ranges = TIKTOK_AGE_GROUP_RANGES.filter((bucket) =>
    groups.includes(bucket.id),
  );
  if (ranges.length === 0) return null;
  return {
    ageMin: Math.min(...ranges.map((bucket) => bucket.min)),
    ageMax: Math.max(...ranges.map((bucket) => bucket.max)),
  };
}

function mapSpcAudienceAge(
  value: unknown,
): { ageMin: number; ageMax: number } | TikTokImportDroppedField {
  if (Array.isArray(value)) {
    const range = mapAgeRange(value);
    if (range) return range;
  }
  if (typeof value === "string") {
    const range = mapAgeRange([value]);
    if (range) return range;
  }
  return { field: "spc_audience_age", sourceValue: value };
}

function mapGenders(value: unknown): TikTokAudiences["genders"] {
  const key = asString(value);
  if (key === "GENDER_MALE") return ["MALE"];
  if (key === "GENDER_FEMALE") return ["FEMALE"];
  return [];
}

function mapIdentityType(
  value: unknown,
): TikTokAccountSetup["identityType"] {
  const key = asString(value);
  return key && isTikTokIdentityType(key) ? key : null;
}

function applyTargeting(
  audiences: TikTokAudiences,
  source: Record<string, unknown>,
): TikTokAudiences {
  const next = { ...audiences };
  const locations = mapLocationCodes(source.location_ids);
  if (locations.length > 0) next.locationCodes = locations;
  const ages = mapAgeRange(source.age_groups);
  if (ages) {
    next.ageMin = ages.ageMin;
    next.ageMax = ages.ageMax;
  }
  next.genders = mapGenders(source.gender);
  const languages = asStringArray(source.languages);
  if (languages.length > 0) next.languages = languages;
  next.interestCategoryIds = asStringArray(source.interest_category_ids);
  next.interestKeywordIds = asStringArray(source.interest_keyword_ids);
  next.behaviourCategoryIds = asStringArray(
    (source.actions as Array<{ action_category_ids?: unknown }> | undefined)
      ?.flatMap((action) => asStringArray(action.action_category_ids)) ??
      source.action_category_ids,
  );
  next.customAudienceIds = asStringArray(source.audience_ids);
  const saved = asString(source.saved_audience_id);
  next.lookalikeAudienceIds = saved ? [saved] : [];
  return next;
}

function newCreativeId(index: number): string {
  return `import-creative-${index + 1}`;
}

function mapCreativeFromAd(
  ad: TikTokAdGetRow,
  index: number,
  fallbackName: string,
): TikTokCreativeDraft {
  const videoId = asString(ad.video_id);
  const sparkId = asString(ad.tiktok_item_id);
  const title = asString(ad.ad_name) ?? asString(ad.ad_text) ?? fallbackName;
  return {
    id: asString(ad.ad_id) ?? newCreativeId(index),
    name: title,
    mode: sparkId ? "SPARK_AD" : "VIDEO_REFERENCE",
    baseName: title,
    videoId,
    videoUrl: null,
    thumbnailUrl: null,
    coverImageId: asStringArray(ad.image_ids)[0] ?? null,
    durationSeconds: null,
    title,
    sparkPostId: sparkId,
    identityId: asString(ad.identity_id),
    identityType: mapIdentityType(ad.identity_type),
    identityBcId: asString(ad.identity_authorized_bc_id) ?? asString(ad.identity_bc_id),
    caption: asString(ad.ad_text) ?? "",
    adText: asString(ad.ad_text) ?? "",
    displayName: title,
    landingPageUrl: asString(ad.landing_page_url) ?? "",
    cta: asString(ad.call_to_action),
    musicId: null,
  };
}

function mapCreativeFromSmartPlusItem(
  creative: TikTokSmartPlusCreativeRow,
  index: number,
  fallbackName: string,
): TikTokCreativeDraft {
  return mapCreativeFromAd(
    {
      ad_id: creative.creative_id,
      ad_name: fallbackName,
      video_id: creative.video_id,
      image_ids: creative.image_ids,
      tiktok_item_id: creative.tiktok_item_id,
      identity_id: creative.identity_id,
      identity_type: creative.identity_type,
      identity_authorized_bc_id: creative.identity_authorized_bc_id,
      landing_page_url: creative.landing_page_url,
      ad_text: creative.ad_text,
      call_to_action: creative.call_to_action,
    },
    index,
    fallbackName,
  );
}

function creativesFromManualAds(ads: TikTokAdGetRow[]): TikTokCreativeDraft[] {
  return ads.map((ad, index) =>
    mapCreativeFromAd(ad, index, `Imported creative ${index + 1}`),
  );
}

function creativesFromSmartPlusAds(ads: TikTokAdGetRow[]): TikTokCreativeDraft[] {
  const items: TikTokCreativeDraft[] = [];
  for (const ad of ads) {
    const list = ad.creative_list ?? [];
    if (list.length === 0) {
      items.push(mapCreativeFromAd(ad, items.length, ad.ad_name ?? "Imported creative"));
      continue;
    }
    for (const creative of list) {
      items.push(
        mapCreativeFromSmartPlusItem(
          creative,
          items.length,
          ad.ad_name ?? `Imported creative ${items.length + 1}`,
        ),
      );
    }
  }
  return items;
}

function creativesFromSpc(spc: TikTokSpcGetRow): TikTokCreativeDraft[] {
  const titles = (spc.title_list ?? [])
    .map((row) => asString(row.title))
    .filter((title): title is string => Boolean(title));
  const videos = (spc.media_info_list ?? [])
    .map((row) => asString(row.media_info?.video_info?.video_id))
    .filter((id): id is string => Boolean(id));
  const count = Math.max(videos.length, titles.length, videos.length === 0 && titles.length === 0 ? 0 : 1);
  const items: TikTokCreativeDraft[] = [];
  for (let index = 0; index < count; index += 1) {
    const title = titles[index] ?? titles[0] ?? `Imported creative ${index + 1}`;
    items.push({
      id: newCreativeId(index),
      name: title,
      mode: "VIDEO_REFERENCE",
      baseName: title,
      videoId: videos[index] ?? videos[0] ?? null,
      videoUrl: null,
      thumbnailUrl: null,
      coverImageId: null,
      durationSeconds: null,
      title,
      sparkPostId: null,
      identityId: asString(spc.identity_id),
      identityType: mapIdentityType(spc.identity_type),
      identityBcId: null,
      caption: title,
      adText: title,
      displayName: title,
      landingPageUrl: asString(spc.landing_page_url) ?? "",
      cta: null,
      musicId: null,
    });
  }
  return items;
}

function firstIdentity(creatives: TikTokCreativeDraft[]): {
  identityId: string | null;
  identityType: TikTokAccountSetup["identityType"];
  identityBcId: string | null;
} {
  const withId = creatives.find((item) => item.identityId);
  return {
    identityId: withId?.identityId ?? null,
    identityType: withId?.identityType ?? null,
    identityBcId: withId?.identityBcId ?? null,
  };
}

function assignCreatives(
  adGroupIds: string[],
  creativeIds: string[],
): Record<string, string[]> {
  if (adGroupIds.length === 0) return {};
  return { [adGroupIds[0]!]: creativeIds };
}

export function mapTikTokLiveCampaignToDraft(
  bundle: TikTokImportLiveBundle,
  draftId: string,
  account: { tiktokAccountId: string | null; advertiserId: string },
): TikTokCampaignDraft {
  const draft = createDefaultTikTokDraft(draftId);
  draft.accountSetup.tiktokAccountId = account.tiktokAccountId;
  draft.accountSetup.advertiserId = account.advertiserId;
  draft.optimisation.smartPlusEnabled = false;

  if (bundle.kind === "legacy_smart_plus") {
    return mapLegacy(bundle, draft);
  }
  if (bundle.kind === "smart_plus") {
    return mapUpgraded(bundle, draft);
  }
  return mapManual(bundle, draft);
}

function applyCampaignFields(
  draft: TikTokCampaignDraft,
  campaign: TikTokCampaignGetRow,
  extra?: { optimization_goal?: unknown; pixel_id?: unknown; optimization_event?: unknown; bid_type?: unknown },
): void {
  const sourceName = asString(campaign.campaign_name) ?? "Imported campaign";
  draft.campaignSetup.campaignName = sourceName;
  draft.campaignSetup.objective = mapObjective(campaign.objective_type);
  const sales = mapSalesDestination(campaign.sales_destination);
  if (sales) draft.campaignSetup.salesDestination = sales;
  else if (asString(campaign.virtual_objective_type) === "SALES") {
    draft.campaignSetup.salesDestination = "WEBSITE";
  }
  const goal = mapGoal(extra?.optimization_goal);
  if (goal) draft.campaignSetup.optimisationGoal = goal;
  const bid = mapBidStrategy(extra?.bid_type);
  draft.campaignSetup.bidStrategy = bid;
  draft.optimisation.bidStrategy = bid;
  const pixelId = asString(extra?.pixel_id);
  if (pixelId) draft.accountSetup.pixelId = pixelId;
  const event = asString(extra?.optimization_event);
  if (event) draft.accountSetup.optimisationEvent = event;
}

function mapManual(
  bundle: TikTokImportLiveCampaignish,
  draft: TikTokCampaignDraft,
): TikTokCampaignDraft {
  const group = bundle.adGroups[0] ?? {};
  applyCampaignFields(draft, bundle.campaign, group);
  draft.audiences = applyTargeting(draft.audiences, unwrapTargeting(group));
  const budget = asNumber(group.budget) ?? asNumber(bundle.campaign.budget);
  draft.budgetSchedule.budgetMode = mapBudgetMode(
    group.budget_mode ?? bundle.campaign.budget_mode,
  );
  draft.budgetSchedule.budgetAmount = budget;
  if (draft.budgetSchedule.budgetMode === "DAILY") {
    draft.budgetSchedule.dailyBudget = budget;
  } else {
    draft.budgetSchedule.lifetimeBudget = budget;
  }
  draft.budgetSchedule.scheduleStartAt = asString(group.schedule_start_time);
  draft.budgetSchedule.scheduleEndAt = asString(group.schedule_end_time);
  const cap = asNumber(group.conversion_bid_price) ?? asNumber(group.bid_price);
  if (cap != null) draft.optimisation.targetCostPerResult = cap;
  const groupId = asString(group.adgroup_id) ?? "import-adgroup-1";
  draft.budgetSchedule.adGroups = [
    {
      id: groupId,
      name: asString(group.adgroup_name) ?? "Imported ad group",
      budget,
      startAt: null,
      endAt: null,
    },
  ];
  draft.creatives.items = creativesFromManualAds(bundle.ads);
  draft.creativeAssignments.byAdGroupId = assignCreatives(
    [groupId],
    draft.creatives.items.map((item) => item.id),
  );
  const identity = firstIdentity(draft.creatives.items);
  draft.accountSetup.identityId = identity.identityId;
  draft.accountSetup.identityType = identity.identityType;
  draft.accountSetup.identityBcId = identity.identityBcId;
  draft.importMeta = buildMeta(bundle, collectDroppedFields([bundle.campaign, group]), bundle.ads);
  return draft;
}

function mapUpgraded(
  bundle: TikTokImportLiveCampaignish,
  draft: TikTokCampaignDraft,
): TikTokCampaignDraft {
  const group = unwrapTargeting(bundle.adGroups[0] ?? {});
  applyCampaignFields(draft, bundle.campaign, group);
  draft.audiences = applyTargeting(draft.audiences, group);
  const budget = asNumber(group.budget) ?? asNumber(bundle.campaign.budget);
  draft.budgetSchedule.budgetMode = mapBudgetMode(
    group.budget_mode ?? bundle.campaign.budget_mode,
  );
  draft.budgetSchedule.budgetAmount = budget;
  if (draft.budgetSchedule.budgetMode === "DAILY") {
    draft.budgetSchedule.dailyBudget = budget;
  } else {
    draft.budgetSchedule.lifetimeBudget = budget;
  }
  draft.budgetSchedule.scheduleStartAt = asString(group.schedule_start_time);
  draft.budgetSchedule.scheduleEndAt = asString(group.schedule_end_time);
  const groupId = asString(group.adgroup_id) ?? "import-adgroup-1";
  draft.budgetSchedule.adGroups = [
    {
      id: groupId,
      name: asString(group.adgroup_name) ?? "Imported ad group",
      budget,
      startAt: null,
      endAt: null,
    },
  ];
  const chosen = creativesFromSmartPlusAds(bundle.chosenAds);
  const autoAdded = creativesFromManualAds(bundle.autoAddedAds);
  const seen = new Set(chosen.map((item) => item.videoId ?? item.id));
  const extra = autoAdded.filter(
    (item) => !seen.has(item.videoId ?? item.id),
  );
  draft.creatives.items = [...chosen, ...extra];
  draft.creativeAssignments.byAdGroupId = assignCreatives(
    [groupId],
    draft.creatives.items.map((item) => item.id),
  );
  const identity = firstIdentity(draft.creatives.items);
  draft.accountSetup.identityId = identity.identityId;
  draft.accountSetup.identityType = identity.identityType;
  draft.accountSetup.identityBcId = identity.identityBcId;
  const dropped = collectDroppedFields([
    bundle.campaign,
    bundle.adGroups[0],
    group,
    ...bundle.chosenAds,
  ]);
  draft.importMeta = {
    ...buildMeta(
      bundle,
      dropped,
      bundle.ads.length > 0 ? bundle.ads : bundle.chosenAds,
    ),
    creativeCounts: {
      chosen: chosen.length,
      tiktokAdded: extra.length,
    },
  };
  return draft;
}

function mapLegacy(
  bundle: TikTokImportLiveCampaignish,
  draft: TikTokCampaignDraft,
): TikTokCampaignDraft {
  const spc = bundle.spc ?? {};
  applyCampaignFields(draft, { ...bundle.campaign, ...spc }, spc);
  draft.audiences = applyTargeting(draft.audiences, spc);
  const spcAge = "spc_audience_age" in spc ? mapSpcAudienceAge(spc.spc_audience_age) : null;
  const dropped = collectDroppedFields([bundle.campaign, spc]);
  if (spcAge && "field" in spcAge) {
    dropped.push(spcAge);
  } else if (spcAge && "ageMin" in spcAge) {
    draft.audiences.ageMin = spcAge.ageMin;
    draft.audiences.ageMax = spcAge.ageMax;
  }
  const budget = asNumber(spc.budget) ?? asNumber(bundle.campaign.budget);
  draft.budgetSchedule.budgetMode = mapBudgetMode(
    spc.budget_mode ?? bundle.campaign.budget_mode,
  );
  draft.budgetSchedule.budgetAmount = budget;
  if (draft.budgetSchedule.budgetMode === "DAILY") {
    draft.budgetSchedule.dailyBudget = budget;
  } else {
    draft.budgetSchedule.lifetimeBudget = budget;
  }
  const groupId = "import-adgroup-1";
  draft.budgetSchedule.adGroups = [
    {
      id: groupId,
      name: "Imported ad group",
      budget,
      startAt: null,
      endAt: null,
    },
  ];
  draft.creatives.items = creativesFromSpc(spc);
  draft.creativeAssignments.byAdGroupId = assignCreatives(
    [groupId],
    draft.creatives.items.map((item) => item.id),
  );
  const identity = firstIdentity(draft.creatives.items);
  draft.accountSetup.identityId = identity.identityId ?? asString(spc.identity_id);
  draft.accountSetup.identityType =
    identity.identityType ?? mapIdentityType(spc.identity_type);
  draft.accountSetup.identityBcId = identity.identityBcId;
  draft.importMeta = buildMeta(bundle, dropped, []);
  return draft;
}

type TikTokImportLiveCampaignish = TikTokImportLiveBundle;

function buildMeta(
  bundle: TikTokImportLiveBundle,
  dropped: TikTokImportDroppedField[],
  ads: TikTokAdGetRow[],
): TikTokImportMeta {
  return {
    sourceCampaignId: asString(bundle.campaign.campaign_id) ?? "",
    sourceCampaignName: asString(bundle.campaign.campaign_name) ?? "Imported campaign",
    sourceKind: bundle.kind,
    dropped,
    sourceEnhancements:
      ads.length > 0 ? enhancementsFromAds(ads) : emptyImportEnhancements(),
    creativeCounts:
      bundle.kind === "smart_plus"
        ? {
            chosen: bundle.chosenAds.reduce(
              (sum, ad) => sum + Math.max(1, ad.creative_list?.length ?? 1),
              0,
            ),
            tiktokAdded: bundle.autoAddedAds.length,
          }
        : null,
  };
}

/**
 * Import produces a draft, then goes through the same function as library
 * Duplicate so publishedIds is empty and the schedule is healed. Name is
 * then set to `source — relaunch` (collision-safe).
 */
export function finalizeTikTokImportDraft(
  mapped: TikTokCampaignDraft,
  newId: string,
  existingNames: readonly string[] = [],
  now: Date = new Date(),
): TikTokCampaignDraft {
  const sourceName =
    mapped.importMeta?.sourceCampaignName ?? mapped.campaignSetup.campaignName;
  const copy = duplicateTikTokDraftState(mapped, newId, existingNames, now);
  const relaunch = relaunchCampaignName(sourceName);
  copy.campaignSetup.campaignName = existingNames.includes(relaunch)
    ? nextDuplicateName(relaunch, existingNames)
    : relaunch;
  copy.publishedIds = null;
  copy.optimisation.smartPlusEnabled = false;
  if (copy.optimisation.bidStrategy === "SMART_PLUS") {
    copy.optimisation.bidStrategy = null;
  }
  if (copy.campaignSetup.bidStrategy === "SMART_PLUS") {
    copy.campaignSetup.bidStrategy = null;
  }
  copy.importMeta = mapped.importMeta ?? null;
  return copy;
}
