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
import { logUnmatchedCandidates } from "../unmatched-candidates.ts";
import type {
  TikTokAdGetRow,
  TikTokAdGroupGetRow,
  TikTokCampaignGetRow,
  TikTokImportLibraryVideo,
  TikTokImportLiveBundle,
  TikTokSmartPlusAdRow,
  TikTokSmartPlusCreativeRow,
  TikTokSpcGetRow,
} from "./readers.ts";
import {
  requireArrayFromCandidates,
  requireObjectFromCandidates,
  requireStringFromCandidates,
} from "./envelope.ts";
import {
  defaultCarryKeys,
  matchTikTokGeneratedName,
  stemFromAdName,
  suggestionLabelFor,
  type TikTokImportPickerPayload,
  type TikTokImportPickerRow,
} from "./picker.ts";
import {
  TIKTOK_IMPORT_DROPPED_FIELDS,
  TIKTOK_IMPORT_UNCARRIABLE_TARGETING_FIELDS,
  TIKTOK_IMPORT_UNSUPPORTED_AD_FORMATS,
  emptyImportEnhancements,
  enhancementsFromAds,
  relaunchCampaignName,
  type TikTokImportCreativeCounts,
  type TikTokImportDroppedField,
  type TikTokImportMeta,
  type TikTokImportNotCarried,
  type TikTokImportNotCarriedReason,
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

export class TikTokImportSourceError extends Error {
  constructor(message: string) {
    super(`TikTok import failed: ${message}`);
    this.name = "TikTokImportSourceError";
  }
}

function hasDroppedValue(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

export function collectDroppedFields(
  sources: ReadonlyArray<Record<string, unknown> | null | undefined>,
): TikTokImportDroppedField[] {
  const dropped: TikTokImportDroppedField[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    for (const field of [
      ...TIKTOK_IMPORT_DROPPED_FIELDS,
      ...TIKTOK_IMPORT_UNCARRIABLE_TARGETING_FIELDS,
    ]) {
      if (field === "spc_audience_age") continue;
      if (!(field in source) || seen.has(field)) continue;
      if (!hasDroppedValue(source[field])) continue;
      seen.add(field);
      dropped.push({ field, sourceValue: source[field] });
    }
  }
  return dropped;
}

function pushDropped(
  dropped: TikTokImportDroppedField[],
  field: string,
  sourceValue: unknown,
): void {
  if (dropped.some((item) => item.field === field)) return;
  dropped.push({ field, sourceValue });
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** `[{ ad_text }]` → `["…"]`. Ad-level lists on `/smart_plus/ad/get/`. */
function stringsFromKeyedList(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => asString(asRecord(row)?.[key]))
    .filter((item): item is string => Boolean(item));
}

function unwrapManualTargeting(
  group: TikTokAdGroupGetRow,
): Record<string, unknown> {
  if (group.targeting_spec && typeof group.targeting_spec === "object") {
    return { ...group, ...group.targeting_spec };
  }
  return group;
}

function unwrapUpgradedTargeting(
  group: TikTokAdGroupGetRow,
): Record<string, unknown> {
  const spec = requireObjectFromCandidates(
    group,
    ["targeting_spec"],
    "/smart_plus/adgroup/get/ targeting_spec",
  );
  return { ...group, ...spec };
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
  return asStringArray(ids).map((id) => LOCATION_CODES_BY_ID[id] ?? id);
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

function mapIdentityType(value: unknown): TikTokAccountSetup["identityType"] {
  const key = asString(value);
  return key && isTikTokIdentityType(key) ? key : null;
}

/**
 * Targeting the draft cannot represent is named, never defaulted.
 *
 * #944 left `ageMin/ageMax` at the 18–65 default when `age_groups` did
 * not map and `locationCodes` empty when `location_ids` did not read —
 * both of which preflight passes, so the draft silently claimed a
 * targeting the source campaign never had. Ironworks is 18–54 in
 * location 2648110.
 */
function applyTargeting(
  audiences: TikTokAudiences,
  source: Record<string, unknown>,
  dropped: TikTokImportDroppedField[],
): TikTokAudiences {
  const next = { ...audiences };

  const locations = mapLocationCodes(source.location_ids);
  if (locations.length === 0) {
    throw new TikTokImportSourceError(
      "the source ad group reported no location_ids. A draft with no location targeting would relaunch nationally; refusing to guess.",
    );
  }
  next.locationCodes = locations;

  if ("age_groups" in source && hasDroppedValue(source.age_groups)) {
    const ages = mapAgeRange(source.age_groups);
    if (!ages) {
      throw new TikTokImportSourceError(
        `age_groups ${JSON.stringify(source.age_groups)} matched no known TikTok age bucket. Leaving the draft at its 18–65 default would be a claim about the source campaign.`,
      );
    }
    next.ageMin = ages.ageMin;
    next.ageMax = ages.ageMax;
  }

  const gender = asString(source.gender);
  if (gender === "GENDER_MALE") next.genders = ["MALE"];
  else if (gender === "GENDER_FEMALE") next.genders = ["FEMALE"];
  else {
    next.genders = [];
    if (gender && gender !== "GENDER_UNLIMITED") {
      pushDropped(dropped, "gender", gender);
    }
  }

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
  // saved_audience_id is a stored spec, not a lookalike. Drop-and-list it
  // (TIKTOK_IMPORT_UNCARRIABLE_TARGETING_FIELDS) — never translate one id
  // type into another.
  next.lookalikeAudienceIds = [];
  return next;
}

function mapPacing(value: unknown): "STANDARD" | "ACCELERATED" | null {
  const key = asString(value);
  if (key === "PACING_MODE_FAST") return "ACCELERATED";
  if (key === "PACING_MODE_SMOOTH") return "STANDARD";
  return null;
}

/* -------------------------------------------------------------------------
 * Source creatives
 *
 * One normalised record per source ad, whichever read it came from, so
 * the carry decision and the provenance label are made in one place.
 * ---------------------------------------------------------------------- */

type TikTokImportOrigin = "chosen" | "tiktok_added" | "unjoined";

type SourceCreative = {
  /** `smart_plus_creative_id` / `/ad/get/` `ad_id`. */
  key: string;
  origin: TikTokImportOrigin;
  name: string;
  assetGroup: string;
  adFormat: string | null;
  videoId: string | null;
  imageIds: string[];
  coverImageId: string | null;
  sparkPostId: string | null;
  identityId: string | null;
  identityType: TikTokAccountSetup["identityType"];
  identityBcId: string | null;
  adText: string;
  cta: string | null;
  landingPageUrl: string;
  musicId: string | null;
};

function inferAssetGroup(
  adName: string,
  assetGroupNames: readonly string[],
): string {
  const stem = stemFromAdName(adName, assetGroupNames);
  if (stem === adName) return "";
  return adName.slice(stem.length + 1);
}

function sourceFromAdGetRow(
  ad: TikTokAdGetRow,
  index: number,
  origin: TikTokImportOrigin,
  assetGroupNames: readonly string[] = [],
): SourceCreative {
  const name = asString(ad.ad_name) ?? asString(ad.ad_text) ?? `Source ad ${index + 1}`;
  return {
    key: asString(ad.ad_id) ?? `import-creative-${index + 1}`,
    origin,
    name,
    assetGroup: inferAssetGroup(name, assetGroupNames),
    // `/ad/get/` is never asked for `ad_format` or `music_id` — those
    // names are not on the captured `/adgroup/get/` accepted list, and
    // that list says nothing about this endpoint. Unsupported-format
    // detection is Smart+-only until `/ad/get/` is captured the same
    // way. Do not read a field we did not request.
    adFormat: null,
    videoId: asString(ad.video_id),
    imageIds: asStringArray(ad.image_ids),
    coverImageId: asStringArray(ad.image_ids)[0] ?? null,
    sparkPostId: asString(ad.tiktok_item_id),
    identityId: asString(ad.identity_id),
    identityType: mapIdentityType(ad.identity_type),
    identityBcId: asString(ad.identity_authorized_bc_id),
    adText: asString(ad.ad_text) ?? "",
    cta: asString(ad.call_to_action),
    landingPageUrl: asString(ad.landing_page_url) ?? "",
    musicId: null,
  };
}

/**
 * `/smart_plus/ad/get/` asset group → N source creatives.
 *
 * Every key below is documented at
 * https://business-api.tiktok.com/portal/docs/get-upgraded-smart-ads/v1.3
 * — doc-derived, pending the capture. Text, CTA and landing page are
 * ad-level *lists*: TikTok pairs them with creatives at delivery, so the
 * source made no per-creative choice. The first entry is carried and the
 * rest are listed in `dropped[]`; they are not copied onto every
 * creative as if each had chosen them.
 */
function sourcesFromSmartPlusAd(
  ad: TikTokSmartPlusAdRow,
  startIndex: number,
  dropped: TikTokImportDroppedField[],
): SourceCreative[] {
  const config = asRecord(ad.ad_configuration) ?? {};
  const texts = stringsFromKeyedList(ad.ad_text_list, "ad_text");
  const ctas = stringsFromKeyedList(ad.call_to_action_list, "call_to_action");
  const landings = stringsFromKeyedList(
    ad.landing_page_url_list,
    "landing_page_url",
  );
  if (texts.length > 1) pushDropped(dropped, "ad_text_list", texts.slice(1));
  if (ctas.length > 1) pushDropped(dropped, "call_to_action_list", ctas.slice(1));
  if (landings.length > 1) {
    pushDropped(dropped, "landing_page_url_list", landings.slice(1));
  }

  const groupId =
    asString(ad.smart_plus_ad_id) ?? `import-asset-group-${startIndex + 1}`;
  if (!ad.smart_plus_ad_id) {
    logUnmatchedCandidates("/smart_plus/ad/get/", ["smart_plus_ad_id"]);
  }
  const list = requireArrayFromCandidates<TikTokSmartPlusCreativeRow>(
    ad,
    ["creative_list"],
    "/smart_plus/ad/get/ creative_list",
  );

  return list.map((creative, offset) => {
    const index = startIndex + offset;
    const info = requireObjectFromCandidates(
      creative,
      ["creative_info"],
      `/smart_plus/ad/get/ creative_list[${offset}].creative_info`,
    );
    const video = asRecord(info.video_info);
    const images = Array.isArray(info.image_info) ? info.image_info : [];
    const imageIds = images
      .map((row) => asString(asRecord(row)?.web_uri))
      .filter((id): id is string => Boolean(id));
    // ad_material_id joins to nothing (doc: ad-specific, not the
    // Creative Library id). Falling back to it as a draft/join key
    // was a silent miss. import-creative-N is an invented id and
    // cannot match an /ad/get/ ad_id.
    const key =
      asString(creative.smart_plus_creative_id) ?? `import-creative-${index + 1}`;
    if (!creative.smart_plus_creative_id) {
      logUnmatchedCandidates(
        `/smart_plus/ad/get/ creative_list[${offset}]`,
        ["smart_plus_creative_id"],
      );
    }
    return {
      key,
      origin: "chosen" as TikTokImportOrigin,
      name:
        asString(info.material_name) ??
        asString(video?.file_name) ??
        `${groupId} ${offset + 1}`,
      assetGroup: asString(ad.ad_name) ?? "",
      adFormat: asString(info.ad_format),
      videoId: asString(video?.video_id),
      imageIds,
      coverImageId: imageIds[0] ?? null,
      sparkPostId: asString(info.tiktok_item_id),
      identityId: asString(info.identity_id) ?? asString(config.identity_id),
      identityType:
        mapIdentityType(info.identity_type) ?? mapIdentityType(config.identity_type),
      identityBcId:
        asString(info.identity_authorized_bc_id) ??
        asString(config.identity_authorized_bc_id),
      adText: texts[0] ?? "",
      cta: ctas[0] ?? null,
      landingPageUrl: landings[0] ?? "",
      musicId: asString(asRecord(info.music_info)?.music_id),
    };
  });
}

function mergeSource(chosen: SourceCreative, ad: SourceCreative): SourceCreative {
  return {
    ...chosen,
    name: chosen.name || ad.name,
    assetGroup: chosen.assetGroup || ad.assetGroup,
    adFormat: chosen.adFormat ?? ad.adFormat,
    videoId: chosen.videoId ?? ad.videoId,
    imageIds: chosen.imageIds.length > 0 ? chosen.imageIds : ad.imageIds,
    coverImageId: chosen.coverImageId ?? ad.coverImageId,
    sparkPostId: chosen.sparkPostId ?? ad.sparkPostId,
    identityId: chosen.identityId ?? ad.identityId,
    identityType: chosen.identityType ?? ad.identityType,
    identityBcId: chosen.identityBcId ?? ad.identityBcId,
    adText: chosen.adText || ad.adText,
    cta: chosen.cta ?? ad.cta,
    landingPageUrl: chosen.landingPageUrl || ad.landingPageUrl,
    musicId: chosen.musicId ?? ad.musicId,
  };
}

/**
 * The documented equality is `creative_list[].smart_plus_creative_id ===
 * /ad/get/ ad_id` (without the `ad_ids_v2` filter). `video_id` and
 * `tiktok_item_id` are the second and third keys.
 *
 * `unjoined` is always the number of `/ad/get/` rows that matched no
 * `creative_list` row. One successful join does not relabel the rest
 * `tiktok_added` — that was #944 with a smaller blast radius. Without
 * a documented TikTok split, leftover unmatched ads stay `unjoined`.
 * The picker reports `chosenJoined` / `chosenTotal` so the header can
 * say both numbers when they disagree.
 */
function joinUpgradedSources(
  chosen: SourceCreative[],
  adRows: SourceCreative[],
): {
  sources: SourceCreative[];
  unjoined: number;
  chosenJoined: number;
  chosenTotal: number;
} {
  const byKey = new Map(adRows.map((row) => [row.key, row]));
  const byVideo = new Map(
    adRows.filter((row) => row.videoId).map((row) => [row.videoId!, row]),
  );
  const bySpark = new Map(
    adRows.filter((row) => row.sparkPostId).map((row) => [row.sparkPostId!, row]),
  );

  const usedAdKeys = new Set<string>();
  const sources: SourceCreative[] = [];
  let chosenJoined = 0;
  for (const entry of chosen) {
    const match =
      byKey.get(entry.key) ??
      (entry.videoId ? byVideo.get(entry.videoId) : undefined) ??
      (entry.sparkPostId ? bySpark.get(entry.sparkPostId) : undefined);
    if (match) {
      usedAdKeys.add(match.key);
      chosenJoined += 1;
      sources.push(mergeSource(entry, match));
    } else {
      sources.push(entry);
    }
  }

  let unjoined = 0;
  for (const row of adRows) {
    if (usedAdKeys.has(row.key)) continue;
    unjoined += 1;
    sources.push({ ...row, origin: "unjoined" });
  }
  return {
    sources,
    unjoined,
    chosenJoined,
    chosenTotal: chosen.length,
  };
}

/* -------------------------------------------------------------------------
 * Unique rows. The operator ticks what to carry. A name pattern is a
 * suggestion and never removes a row. Library membership prefers a
 * video_id when two copies share a stem — it is not a gate.
 * ---------------------------------------------------------------------- */

type UniqueRow = {
  key: string;
  kind: "video" | "spark";
  name: string;
  source: SourceCreative;
  assetGroups: string[];
  copies: number;
  inLibrary: boolean;
  library: TikTokImportLibraryVideo | null;
  disabled: boolean;
  suggestionReason: string | null;
  unsupportedReason: TikTokImportNotCarriedReason | null;
};

function assetGroupNames(bundle: TikTokImportLiveBundle): string[] {
  return bundle.smartPlusAds
    .map((ad) => asString(ad.ad_name))
    .filter((name): name is string => Boolean(name));
}

function classifySource(
  source: SourceCreative,
): TikTokImportNotCarriedReason | "spark" | "video" {
  // Spark wins even when creative_info.ad_format is CAROUSEL_ADS — the
  // captured Feed : JJ post is that shape, and /ad/get/ may omit
  // tiktok_item_id. Merge is creative_list first.
  if (source.sparkPostId) return "spark";
  if (
    source.adFormat &&
    TIKTOK_IMPORT_UNSUPPORTED_AD_FORMATS.includes(source.adFormat)
  ) {
    return "unsupported_ad_format";
  }
  if (!source.videoId && source.imageIds.length > 0) {
    return "image_ad_unsupported";
  }
  if (!source.videoId) return "no_asset_reported";
  return "video";
}

function stemOf(
  source: SourceCreative,
  groups: readonly string[],
  libraryById: ReadonlyMap<string, TikTokImportLibraryVideo>,
): string {
  if (source.videoId) {
    const fileName = libraryById.get(source.videoId)?.file_name;
    if (fileName) return fileName;
  }
  return stemFromAdName(source.name, groups);
}

function uniqueGroups(sources: readonly SourceCreative[]): string[] {
  return [...new Set(sources.map((row) => row.assetGroup).filter(Boolean))].sort();
}

type CollectedSources = {
  sources: SourceCreative[];
  sourceRows: number;
  unjoined: number;
  chosenJoined: number;
  chosenTotal: number;
};

function collectSources(
  bundle: TikTokImportLiveBundle,
  dropped: TikTokImportDroppedField[],
): CollectedSources {
  const groups = assetGroupNames(bundle);
  if (bundle.kind === "legacy_smart_plus") {
    const spc = bundle.spc ?? {};
    const sources = creativesFromSpc(spc).map((item, index) => ({
      key: `import-creative-${index + 1}`,
      origin: "chosen" as const,
      name: item.title,
      assetGroup: "",
      adFormat: null,
      videoId: item.videoId,
      imageIds: [],
      coverImageId: null,
      sparkPostId: null,
      identityId: asString(spc.identity_id),
      identityType: mapIdentityType(spc.identity_type),
      identityBcId: null,
      adText: item.title,
      cta: null,
      landingPageUrl: asString(spc.landing_page_url) ?? "",
      musicId: null,
    }));
    return {
      sources,
      sourceRows: sources.length,
      unjoined: 0,
      chosenJoined: 0,
      chosenTotal: 0,
    };
  }
  if (bundle.kind === "smart_plus") {
    const chosen: SourceCreative[] = [];
    for (const ad of bundle.smartPlusAds) {
      chosen.push(...sourcesFromSmartPlusAd(ad, chosen.length, dropped));
    }
    const campaignId =
      asString(bundle.campaign.campaign_id) ?? "unknown campaign";
    if (chosen.length === 0) {
      throw new TikTokImportSourceError(
        `/smart_plus/ad/get/ returned ${bundle.smartPlusAds.length} asset groups and 0 creatives for ${campaignId} (${bundle.ads.length} /ad/get/ rows)`,
      );
    }
    const adRows = bundle.ads.map((ad, index) =>
      sourceFromAdGetRow(ad, index, "unjoined", groups),
    );
    const { sources, unjoined, chosenJoined, chosenTotal } =
      joinUpgradedSources(chosen, adRows);
    return {
      sources,
      sourceRows: sources.length,
      unjoined,
      chosenJoined,
      chosenTotal,
    };
  }
  const sources = bundle.ads.map((ad, index) =>
    sourceFromAdGetRow(ad, index, "chosen", groups),
  );
  return {
    sources,
    sourceRows: sources.length,
    unjoined: 0,
    chosenJoined: 0,
    chosenTotal: 0,
  };
}

function collectUniqueRows(
  bundle: TikTokImportLiveBundle,
  dropped: TikTokImportDroppedField[],
): {
  rows: UniqueRow[];
  sourceRows: number;
  unjoined: number;
  chosenJoined: number;
  chosenTotal: number;
} {
  const { sources, sourceRows, unjoined, chosenJoined, chosenTotal } =
    collectSources(bundle, dropped);
  const groups = assetGroupNames(bundle);
  const libraryById = new Map(
    (bundle.libraryVideos ?? []).map((row) => [row.video_id, row]),
  );
  const libraryIds = new Set(bundle.libraryVideoIds);
  const bySpark = new Map<string, SourceCreative[]>();
  const byVideo = new Map<string, SourceCreative[]>();
  const blocked: SourceCreative[] = [];

  for (const source of sources) {
    const kind = classifySource(source);
    if (kind === "spark") {
      const key = source.sparkPostId!;
      bySpark.set(key, [...(bySpark.get(key) ?? []), source]);
      continue;
    }
    if (kind === "video") {
      const key = source.videoId!;
      byVideo.set(key, [...(byVideo.get(key) ?? []), source]);
      continue;
    }
    blocked.push(source);
    if (kind === "unsupported_ad_format") {
      pushDropped(dropped, "unsupported_ad_format", source.adFormat);
    }
  }

  const byStem = new Map<string, Array<{ videoId: string; sources: SourceCreative[] }>>();
  for (const [videoId, rows] of byVideo) {
    const stem = stemOf(rows[0]!, groups, libraryById);
    const copies = byStem.get(stem) ?? [];
    copies.push({ videoId, sources: rows });
    byStem.set(stem, copies);
  }

  const unique: UniqueRow[] = [];
  for (const [stem, copies] of byStem) {
    const preferred =
      copies.find((copy) => libraryIds.has(copy.videoId)) ?? copies[0]!;
    const all = copies.flatMap((copy) => copy.sources);
    const source = { ...preferred.sources[0]!, videoId: preferred.videoId };
    const generated = matchTikTokGeneratedName(stem);
    unique.push({
      key: preferred.videoId,
      kind: "video",
      name: stem,
      source,
      assetGroups: uniqueGroups(all),
      copies: copies.length,
      inLibrary: libraryIds.has(preferred.videoId),
      library: libraryById.get(preferred.videoId) ?? null,
      disabled: false,
      suggestionReason: generated,
      unsupportedReason: null,
    });
  }

  for (const [sparkId, rows] of bySpark) {
    const source = rows[0]!;
    const stem = stemFromAdName(source.name, groups) || sparkId;
    unique.push({
      key: sparkId,
      kind: "spark",
      name: stem,
      source: { ...source, sparkPostId: sparkId },
      assetGroups: uniqueGroups(rows),
      copies: rows.length,
      inLibrary: false,
      library: null,
      disabled: false,
      suggestionReason: matchTikTokGeneratedName(stem),
      unsupportedReason: null,
    });
  }

  for (const source of blocked) {
    const kind = classifySource(source) as TikTokImportNotCarriedReason;
    unique.push({
      key: source.key,
      kind: "video",
      name: stemFromAdName(source.name, groups),
      source,
      assetGroups: uniqueGroups([source]),
      copies: 1,
      inLibrary: false,
      library: null,
      disabled: true,
      suggestionReason: matchTikTokGeneratedName(
        stemFromAdName(source.name, groups),
      ),
      unsupportedReason: kind,
    });
  }

  return { rows: unique, sourceRows, unjoined, chosenJoined, chosenTotal };
}

function pickerRowFromUnique(row: UniqueRow): TikTokImportPickerRow {
  const defaultTicked = !row.disabled && !row.suggestionReason;
  const picker: TikTokImportPickerRow = {
    key: row.key,
    kind: row.kind,
    name: row.name,
    thumbnailUrl: row.library?.video_cover_url ?? null,
    durationSeconds: row.library?.duration ?? null,
    width: row.library?.width ?? null,
    height: row.library?.height ?? null,
    assetGroups: row.assetGroups,
    copies: row.copies,
    inLibrary: row.inLibrary,
    thumbnailError: false,
    defaultTicked,
    disabled: row.disabled,
    suggestionReason: row.suggestionReason,
    unsupportedReason: row.unsupportedReason,
    suggestionLabel: null,
  };
  return { ...picker, suggestionLabel: suggestionLabelFor(picker) };
}

export function buildTikTokImportPicker(
  bundle: TikTokImportLiveBundle,
): TikTokImportPickerPayload {
  const { rows, unjoined, chosenJoined, chosenTotal } = collectUniqueRows(
    bundle,
    [],
  );
  return {
    campaign: {
      id: asString(bundle.campaign.campaign_id) ?? "",
      name: asString(bundle.campaign.campaign_name) ?? "Imported campaign",
      kind: bundle.kind,
    },
    rows: rows.map(pickerRowFromUnique),
    unjoined,
    chosenJoined,
    chosenTotal,
  };
}

export function classifyTikTokImportCarry(
  picker: TikTokImportPickerPayload,
  carry: readonly string[],
): { accepted: string[]; rejected: string[] } {
  const enabled = new Set(
    picker.rows.filter((row) => !row.disabled).map((row) => row.key),
  );
  const accepted = carry.filter((key) => enabled.has(key));
  const rejected = carry.filter((key) => !enabled.has(key));
  return { accepted, rejected };
}

export function formatRejectedCarryKeys(rejected: readonly string[]): string {
  return `Nothing was saved. Rejected keys: ${rejected.join(", ")}.`;
}

export function parseTikTokImportCarry(body: {
  carry?: unknown;
}):
  | { action: "picker" }
  | { action: "nosave" }
  | { action: "save"; carry: string[] } {
  if (!Object.prototype.hasOwnProperty.call(body, "carry")) {
    return { action: "picker" };
  }
  if (!Array.isArray(body.carry)) return { action: "nosave" };
  const carry = body.carry
    .filter((key): key is string => typeof key === "string" && Boolean(key.trim()))
    .map((key) => key.trim());
  if (carry.length === 0) return { action: "nosave" };
  return { action: "save", carry };
}

type CarryResult = {
  creatives: TikTokCreativeDraft[];
  notCarried: TikTokImportNotCarried[];
  counts: TikTokImportCreativeCounts;
};

function notCarriedFromUnique(
  row: UniqueRow,
  reason: TikTokImportNotCarriedReason,
): TikTokImportNotCarried {
  return {
    adId: row.source.key,
    name: row.name,
    videoId: row.source.videoId,
    reason,
    adFormat: row.source.adFormat,
  };
}

function reasonForUnticked(row: UniqueRow): TikTokImportNotCarriedReason {
  if (row.unsupportedReason) return row.unsupportedReason;
  if (row.suggestionReason) return "looks_tiktok_generated";
  return "operator_unticked";
}

function carryUniqueRows(input: {
  rows: UniqueRow[];
  sourceRows: number;
  carry?: string[];
  dropped: TikTokImportDroppedField[];
}): CarryResult {
  const picker = {
    campaign: { id: "", name: "", kind: "manual" as const },
    rows: input.rows.map(pickerRowFromUnique),
    unjoined: 0,
    chosenJoined: 0,
    chosenTotal: 0,
  };
  const keys = new Set(input.carry ?? defaultCarryKeys(picker));
  const creatives: TikTokCreativeDraft[] = [];
  const notCarried: TikTokImportNotCarried[] = [];

  for (const row of input.rows) {
    const take = keys.has(row.key) && !row.disabled;
    if (!take) {
      notCarried.push(notCarriedFromUnique(row, reasonForUnticked(row)));
      continue;
    }
    const source = row.source;
    const isSpark = Boolean(source.sparkPostId);
    creatives.push({
      id: source.key,
      name: row.name,
      mode: isSpark ? "SPARK_AD" : "VIDEO_REFERENCE",
      baseName: row.name,
      videoId: source.videoId,
      videoUrl: null,
      thumbnailUrl: row.library?.video_cover_url ?? null,
      coverImageId: source.coverImageId,
      durationSeconds: row.library?.duration ?? null,
      title: row.name,
      sparkPostId: source.sparkPostId,
      identityId: source.identityId,
      identityType: source.identityType,
      identityBcId: source.identityBcId,
      caption: source.adText,
      adText: source.adText,
      displayName: "",
      landingPageUrl: source.landingPageUrl,
      cta: source.cta,
      musicId: source.musicId,
    });
  }

  pushDropped(input.dropped, "display_name", null);
  return {
    creatives,
    notCarried,
    counts: {
      sourceRows: input.sourceRows,
      unique: input.rows.length,
      carried: creatives.length,
      unticked: input.rows.length - creatives.length,
    },
  };
}

/**
 * Identity is read from the source, never borrowed from a neighbouring
 * creative. When the source ads disagree, the draft says so and the
 * operator picks on Review.
 */
function resolveAccountIdentity(
  creatives: readonly TikTokCreativeDraft[],
  dropped: TikTokImportDroppedField[],
  preferred?: {
    identityId: string | null;
    identityType: TikTokAccountSetup["identityType"];
    identityBcId: string | null;
  },
): {
  identityId: string | null;
  identityType: TikTokAccountSetup["identityType"];
  identityBcId: string | null;
} {
  if (preferred?.identityId) return preferred;
  const distinct = [
    ...new Set(
      creatives.map((item) => item.identityId).filter((id): id is string => Boolean(id)),
    ),
  ];
  if (distinct.length === 1) {
    const match = creatives.find((item) => item.identityId === distinct[0])!;
    return {
      identityId: match.identityId ?? null,
      identityType: match.identityType ?? null,
      identityBcId: match.identityBcId ?? null,
    };
  }
  if (distinct.length > 1) pushDropped(dropped, "identity_conflict", distinct);
  return { identityId: null, identityType: null, identityBcId: null };
}

function creativesFromSpc(
  spc: TikTokSpcGetRow,
): Array<{ title: string; videoId: string }> {
  const titleRows = requireArrayFromCandidates<{ title?: string }>(
    spc,
    ["title_list"],
    "/campaign/spc/get/ title_list",
  );
  const titles = titleRows.map((row, index) =>
    requireStringFromCandidates(
      row,
      ["title"],
      `/campaign/spc/get/ title_list[${index}].title`,
    ),
  );
  const mediaRows = requireArrayFromCandidates<Record<string, unknown>>(
    spc,
    ["media_info_list"],
    "/campaign/spc/get/ media_info_list",
  );
  const videos = mediaRows.map((row, index) => {
    const media = requireObjectFromCandidates(
      row,
      ["media_info"],
      `/campaign/spc/get/ media_info_list[${index}].media_info`,
    );
    const video = requireObjectFromCandidates(
      media,
      ["video_info"],
      `/campaign/spc/get/ media_info_list[${index}].media_info.video_info`,
    );
    return requireStringFromCandidates(
      video,
      ["video_id"],
      `/campaign/spc/get/ media_info_list[${index}].media_info.video_info.video_id`,
    );
  });
  if (videos.length === 0) {
    throw new TikTokImportSourceError(
      "/campaign/spc/get/ reported no videos",
    );
  }
  return videos.map((videoId, index) => ({
    videoId,
    title: titles[index] ?? titles[0] ?? `Imported creative ${index + 1}`,
  }));
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
  account: {
    tiktokAccountId: string | null;
    advertiserId: string;
    currency?: string | null;
    timezone?: string | null;
  },
  options?: { carry?: string[] },
): TikTokCampaignDraft {
  const draft = createDefaultTikTokDraft(draftId);
  draft.accountSetup.tiktokAccountId = account.tiktokAccountId;
  draft.accountSetup.advertiserId = account.advertiserId;
  draft.accountSetup.currency = account.currency ?? null;
  draft.accountSetup.timezone = account.timezone ?? null;
  draft.optimisation.smartPlusEnabled = false;

  if (bundle.kind === "legacy_smart_plus") {
    return mapLegacy(bundle, draft, options);
  }
  if (bundle.kind === "smart_plus") return mapUpgraded(bundle, draft, options);
  return mapManual(bundle, draft, options);
}

function applyCampaignFields(
  draft: TikTokCampaignDraft,
  campaign: TikTokCampaignGetRow,
  extra?: {
    optimization_goal?: unknown;
    pixel_id?: unknown;
    optimization_event?: unknown;
    bid_type?: unknown;
  },
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

function applyBudgetAndSchedule(
  draft: TikTokCampaignDraft,
  group: Record<string, unknown>,
  campaign: TikTokCampaignGetRow,
  groupId: string,
  groupName: string,
): void {
  const budget = asNumber(group.budget) ?? asNumber(campaign.budget);
  draft.budgetSchedule.budgetMode = mapBudgetMode(
    group.budget_mode ?? campaign.budget_mode,
  );
  draft.budgetSchedule.budgetAmount = budget;
  if (draft.budgetSchedule.budgetMode === "DAILY") {
    draft.budgetSchedule.dailyBudget = budget;
  } else {
    draft.budgetSchedule.lifetimeBudget = budget;
  }
  draft.budgetSchedule.scheduleStartAt = asString(group.schedule_start_time);
  draft.budgetSchedule.scheduleEndAt = asString(group.schedule_end_time);
  draft.budgetSchedule.adGroups = [
    { id: groupId, name: groupName, budget, startAt: null, endAt: null },
  ];
}

function applyImportedCreatives(
  bundle: TikTokImportLiveBundle,
  draft: TikTokCampaignDraft,
  groupId: string,
  dropped: TikTokImportDroppedField[],
  options?: { carry?: string[] },
  preferredIdentity?: {
    identityId: string | null;
    identityType: TikTokAccountSetup["identityType"];
    identityBcId: string | null;
  },
): void {
  const { rows, sourceRows } = collectUniqueRows(bundle, dropped);
  const carried = carryUniqueRows({
    rows,
    sourceRows,
    carry: options?.carry,
    dropped,
  });
  draft.creatives.items = carried.creatives;
  draft.creativeAssignments.byAdGroupId = assignCreatives(
    [groupId],
    carried.creatives.map((item) => item.id),
  );
  const identity = resolveAccountIdentity(
    carried.creatives,
    dropped,
    preferredIdentity,
  );
  draft.accountSetup.identityId = identity.identityId;
  draft.accountSetup.identityType = identity.identityType;
  draft.accountSetup.identityBcId = identity.identityBcId;
  draft.importMeta = buildMeta(bundle, dropped, bundle.ads, carried);
}

function mapManual(
  bundle: TikTokImportLiveBundle,
  draft: TikTokCampaignDraft,
  options?: { carry?: string[] },
): TikTokCampaignDraft {
  const group = bundle.adGroups[0] ?? {};
  if (bundle.adGroups.length > 1) {
    throw new TikTokImportSourceError(
      `the source campaign has ${bundle.adGroups.length} ad groups and this import maps one. Ad groups 2–${bundle.adGroups.length} would be silently lost.`,
    );
  }
  const dropped = collectDroppedFields([bundle.campaign, group]);
  applyCampaignFields(draft, bundle.campaign, group);
  draft.audiences = applyTargeting(
    draft.audiences,
    unwrapManualTargeting(group),
    dropped,
  );
  const pacing = mapPacing(group.pacing);
  if (pacing) draft.optimisation.pacing = pacing;
  const cap = asNumber(group.conversion_bid_price) ?? asNumber(group.bid_price);
  if (cap != null) draft.optimisation.targetCostPerResult = cap;
  const groupId = asString(group.adgroup_id) ?? "import-adgroup-1";
  applyBudgetAndSchedule(
    draft,
    group,
    bundle.campaign,
    groupId,
    asString(group.adgroup_name) ?? "Imported ad group",
  );

  applyImportedCreatives(bundle, draft, groupId, dropped, options);
  return draft;
}

function mapUpgraded(
  bundle: TikTokImportLiveBundle,
  draft: TikTokCampaignDraft,
  options?: { carry?: string[] },
): TikTokCampaignDraft {
  if (bundle.adGroups.length > 1) {
    throw new TikTokImportSourceError(
      `the source campaign has ${bundle.adGroups.length} Smart+ ad groups and this import maps one. Ad groups 2–${bundle.adGroups.length} would be silently lost.`,
    );
  }
  const rawGroup = bundle.adGroups[0] ?? {};
  const group = unwrapUpgradedTargeting(rawGroup);
  const configs = bundle.smartPlusAds
    .map((ad) => asRecord(ad.ad_configuration))
    .filter((config): config is Record<string, unknown> => Boolean(config));
  const dropped = collectDroppedFields([
    bundle.campaign,
    rawGroup,
    group,
    ...configs,
  ]);

  applyCampaignFields(draft, bundle.campaign, group);
  draft.audiences = applyTargeting(draft.audiences, group, dropped);
  const pacing = mapPacing(group.pacing);
  if (pacing) draft.optimisation.pacing = pacing;
  const groupId = asString(group.adgroup_id) ?? "import-adgroup-1";
  applyBudgetAndSchedule(
    draft,
    group,
    bundle.campaign,
    groupId,
    asString(group.adgroup_name) ?? "Imported ad group",
  );

  const config = configs[0];
  applyImportedCreatives(bundle, draft, groupId, dropped, options, {
    identityId: asString(config?.identity_id),
    identityType: mapIdentityType(config?.identity_type),
    identityBcId: asString(config?.identity_authorized_bc_id),
  });
  return draft;
}

function mapLegacy(
  bundle: TikTokImportLiveBundle,
  draft: TikTokCampaignDraft,
  options?: { carry?: string[] },
): TikTokCampaignDraft {
  const spc = bundle.spc ?? {};
  const dropped = collectDroppedFields([bundle.campaign, spc]);
  applyCampaignFields(draft, { ...bundle.campaign, ...spc }, spc);
  draft.audiences = applyTargeting(draft.audiences, spc, dropped);
  const spcAge =
    "spc_audience_age" in spc ? mapSpcAudienceAge(spc.spc_audience_age) : null;
  if (spcAge && "field" in spcAge) {
    dropped.push(spcAge);
  } else if (spcAge && "ageMin" in spcAge) {
    draft.audiences.ageMin = spcAge.ageMin;
    draft.audiences.ageMax = spcAge.ageMax;
  }
  const groupId = "import-adgroup-1";
  applyBudgetAndSchedule(draft, spc, bundle.campaign, groupId, "Imported ad group");

  applyImportedCreatives(bundle, draft, groupId, dropped, options, {
    identityId: asString(spc.identity_id),
    identityType: mapIdentityType(spc.identity_type),
    identityBcId: null,
  });
  return draft;
}

function buildMeta(
  bundle: TikTokImportLiveBundle,
  dropped: TikTokImportDroppedField[],
  ads: TikTokAdGetRow[],
  carried: CarryResult,
): TikTokImportMeta {
  return {
    sourceCampaignId: asString(bundle.campaign.campaign_id) ?? "",
    sourceCampaignName:
      asString(bundle.campaign.campaign_name) ?? "Imported campaign",
    sourceKind: bundle.kind,
    dropped,
    sourceEnhancements:
      ads.length > 0 ? enhancementsFromAds(ads) : emptyImportEnhancements(),
    creativeCounts: carried.counts,
    notCarried: carried.notCarried,
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
