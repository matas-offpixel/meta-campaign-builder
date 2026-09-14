/**
 * Live TikTok → creator import. Read-only against TikTok. The source
 * campaign is never written. Launch is the existing gated writer.
 */

/**
 * `/file/video/ad/search/` is the seventh path, added deliberately: a
 * relaunch carries only creatives that still exist in the advertiser's
 * Creative Library, so the library is read on every import. It is the
 * same endpoint the wizard's video picker already uses
 * (`TIKTOK_VIDEO_LIBRARY_PATH` in `lib/tiktok/creative.ts`).
 */
export const TIKTOK_IMPORT_PATHS = [
  "/campaign/get/",
  "/adgroup/get/",
  "/ad/get/",
  "/smart_plus/adgroup/get/",
  "/smart_plus/ad/get/",
  "/campaign/spc/get/",
  "/file/video/ad/search/",
] as const;

export type TikTokImportPath = (typeof TIKTOK_IMPORT_PATHS)[number];

export type TikTokLiveCampaignKind =
  | "manual"
  | "smart_plus"
  | "legacy_smart_plus";

export const TIKTOK_LIVE_CAMPAIGN_KIND_LABEL: Record<
  TikTokLiveCampaignKind,
  string
> = {
  manual: "Manual",
  smart_plus: "Smart+",
  legacy_smart_plus: "Legacy Smart+",
};

export type TikTokImportDroppedField = {
  field: string;
  sourceValue: unknown;
};

/**
 * Absent is not false. TikTok omits `is_aco` entirely on Upgraded Smart+
 * rows read through `/ad/get/` (live, advertiser 7639802149165301776,
 * 2026-09-15: absent on all 45), and #944 rendered that as
 * "is_aco true on 0 of 45" — a claim the API never made.
 */
export type TikTokImportEnhancements = {
  isAcoOn: number;
  isAcoOff: number;
  isAcoAbsent: number;
  isAcoTotal: number;
  creativeAuthorizedOn: number;
  creativeAuthorizedOff: number;
  creativeAuthorizedAbsent: number;
  creativeAuthorizedTotal: number;
};

/**
 * Why a source creative did not reach `creatives.items`.
 *
 * `not_in_creative_library` is the rule, not an error: a relaunch
 * recreates the campaign the operator launched, so it carries only
 * assets that still exist in the advertiser's Creative Library.
 * TikTok's delivery-time variants (Music_Refresh, New_Hook,
 * AI Generated Video-N, remixed cuts) are not in it.
 */
export const TIKTOK_IMPORT_NOT_CARRIED_REASONS = [
  "not_in_creative_library",
  "unsupported_ad_format",
  "no_asset_reported",
] as const;

export type TikTokImportNotCarriedReason =
  (typeof TIKTOK_IMPORT_NOT_CARRIED_REASONS)[number];

export const TIKTOK_IMPORT_NOT_CARRIED_LABELS: Record<
  TikTokImportNotCarriedReason,
  string
> = {
  not_in_creative_library: "not in the Creative Library",
  unsupported_ad_format: "carousel — no draft equivalent",
  no_asset_reported: "TikTok reported no video, image or post",
};

export type TikTokImportNotCarried = {
  /** `/ad/get/` `ad_id`, or `smart_plus_creative_id` when only that is known. */
  adId: string | null;
  name: string;
  videoId: string | null;
  reason: TikTokImportNotCarriedReason;
  /** Documented `ad_format` when TikTok reported one. */
  adFormat: string | null;
};

/**
 * `sourceRows === carried + deduped + notCarried`. Every source ad is
 * accounted for exactly once; #944's `{chosen, tiktokAdded}` counted 45
 * creatives twice.
 */
export type TikTokImportCreativeCounts = {
  sourceRows: number;
  carried: number;
  deduped: number;
  notCarried: number;
  /**
   * Source rows that matched no counterpart across
   * `/smart_plus/ad/get/` and `/ad/get/`. Provenance only — an unjoined
   * row is still carried or not on the Creative Library rule.
   */
  unjoined: number;
};

export type TikTokImportMeta = {
  sourceCampaignId: string;
  sourceCampaignName: string;
  sourceKind: TikTokLiveCampaignKind;
  dropped: TikTokImportDroppedField[];
  sourceEnhancements: TikTokImportEnhancements;
  creativeCounts: TikTokImportCreativeCounts | null;
  notCarried: TikTokImportNotCarried[];
};

export type TikTokLiveCampaignRow = {
  id: string;
  name: string;
  objective: string | null;
  status: string | null;
  kind: TikTokLiveCampaignKind;
};

/** Smart+-only fields. No manual equivalent — list them, do not translate. */
export const TIKTOK_IMPORT_DROPPED_FIELDS = [
  "budget_auto_adjust_strategy",
  "smart_plus_adgroup_mode",
  "targeting_optimization_mode",
  "smart_audience_enabled",
  "smart_interest_behavior_enabled",
  "suggestion_audience_enabled",
  "creative_auto_add_toggle",
  "creative_auto_enhancement_strategy_list",
  "spc_audience_age",
] as const;

/**
 * Requested targeting the draft cannot hold. Same `dropped[]` list as
 * Smart+-only — nothing on the source ad group is lost unnamed.
 * `saved_audience_id` is a stored spec, not a lookalike: do not put it
 * on `lookalikeAudienceIds`. The writer reads that field as
 * `saved_audience_id`, but this PR does not invent a second draft key
 * (`lib/tiktok/write/**` is frozen).
 */
export const TIKTOK_IMPORT_UNCARRIABLE_TARGETING_FIELDS = [
  "excluded_audience_ids",
  "saved_audience_id",
  "placements",
  "placement_type",
  "purchase_intention_keyword_ids",
  "operating_systems",
  "min_android_version",
  "min_ios_version",
  "device_model_ids",
  "carrier_ids",
  "isp_ids",
  "network_types",
  "dark_post_status",
] as const;

/**
 * Documented `creative_info.ad_format` values with no draft mode.
 * https://business-api.tiktok.com/portal/docs/get-upgraded-smart-ads/v1.3
 * A carousel is listed by id, not coerced into a VIDEO_REFERENCE with a
 * null `videoId` — that is what #944 did to three Ironworks rows.
 */
export const TIKTOK_IMPORT_UNSUPPORTED_AD_FORMATS: readonly string[] = [
  "CAROUSEL_ADS",
  "CATALOG_CAROUSEL",
];

export const TIKTOK_IMPORT_DROPPED_LABELS: Record<string, string> = {
  budget_auto_adjust_strategy: "automatic budget adjustment",
  smart_plus_adgroup_mode: "Smart+ ad group mode",
  targeting_optimization_mode: "targeting optimisation",
  smart_audience_enabled: "automatic audience expansion",
  smart_interest_behavior_enabled:
    "automatic interest and behaviour targeting",
  suggestion_audience_enabled: "suggested audiences",
  creative_auto_add_toggle: "automatic creative additions",
  creative_auto_enhancement_strategy_list: "automatic creative enhancement",
  spc_audience_age: "Smart+ audience age",
  excluded_audience_ids: "excluded audiences",
  saved_audience_id: "saved audience",
  placements: "placements",
  placement_type: "placement type",
  purchase_intention_keyword_ids: "purchase-intention keywords",
  operating_systems: "operating systems",
  min_android_version: "minimum Android version",
  min_ios_version: "minimum iOS version",
  device_model_ids: "device models",
  carrier_ids: "carriers",
  isp_ids: "ISPs",
  network_types: "network types",
  dark_post_status: "ads-only mode",
  ad_text_list: "extra ad texts on the asset group",
  call_to_action_list: "extra calls to action on the asset group",
  landing_page_url_list: "extra landing pages on the asset group",
  display_name: "ad display name",
  identity_conflict: "source identities disagreed",
  unsupported_ad_format: "carousel creatives",
  gender: "an unrecognised gender value",
};

/**
 * Relaunch enhancements are OFF because `buildTikTokAdPayload` in
 * `lib/tiktok/write/mapping.ts` sends `is_aco: false` (and
 * `creative_authorized: false`). Import tests grep that literal so a
 * writer change turns this line red.
 */
export const TIKTOK_IMPORT_RELAUNCH_ENHANCEMENTS = "OFF" as const;

export function classifyTikTokCampaign(row: {
  campaign_automation_type?: string | null;
  is_smart_performance_campaign?: boolean | null;
}): TikTokLiveCampaignKind {
  const automation = String(row.campaign_automation_type ?? "")
    .trim()
    .toUpperCase();
  if (automation === "UPGRADED_SMART_PLUS") return "smart_plus";
  if (automation === "SMART_PLUS" || row.is_smart_performance_campaign === true) {
    return "legacy_smart_plus";
  }
  return "manual";
}

export function formatDroppedSourceValue(value: unknown): string {
  if (value === true || value === "true" || value === "ON") return "was on";
  if (value === false || value === "false" || value === "OFF") return "was off";
  if (Array.isArray(value)) {
    return value.length === 0 ? "was empty" : value.join(", ");
  }
  if (value == null || value === "") return "was unset";
  return String(value);
}

export function formatTikTokImportDroppedLine(
  dropped: readonly TikTokImportDroppedField[],
): string | null {
  if (dropped.length === 0) return null;
  const items = dropped.map((item) => {
    const label = TIKTOK_IMPORT_DROPPED_LABELS[item.field] ?? item.field;
    return `${label} (${formatDroppedSourceValue(item.sourceValue)})`;
  });
  return `Not carried over from the source campaign: ${items.join(", ")}.`;
}

export function formatTikTokImportEnhancementLine(
  meta: Pick<TikTokImportMeta, "sourceKind" | "sourceEnhancements">,
): string {
  const relaunch = TIKTOK_IMPORT_RELAUNCH_ENHANCEMENTS;
  if (meta.sourceKind === "legacy_smart_plus") {
    return `Source: Legacy Smart+ — fully automated creative and targeting. Relaunch: ${relaunch}.`;
  }
  const source = meta.sourceEnhancements;
  if (source.isAcoTotal === 0) {
    return `Source ads: none read. Relaunch: ${relaunch}.`;
  }
  if (source.isAcoAbsent > 0) {
    return `Source ads: is_aco not reported on ${source.isAcoAbsent} of ${source.isAcoTotal} source ads. Relaunch: ${relaunch}.`;
  }
  const on = source.isAcoOn > 0 || source.creativeAuthorizedOn > 0;
  return `Source ads: enhancements ${on ? "ON" : "OFF"} (is_aco true on ${source.isAcoOn} of ${source.isAcoTotal}). Relaunch: ${relaunch}.`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function formatTikTokImportCreativeCounts(
  counts: TikTokImportCreativeCounts,
  notCarried: readonly TikTokImportNotCarried[] = [],
): string {
  const carried = `${plural(counts.carried, "original creative", "original creatives")} carried.`;
  if (counts.notCarried === 0) return carried;
  const reasons = new Set(notCarried.map((item) => item.reason));
  if (reasons.size <= 1 && reasons.has("not_in_creative_library")) {
    return `${carried} ${plural(counts.notCarried, "TikTok-generated variant", "TikTok-generated variants")} not carried.`;
  }
  const breakdown = TIKTOK_IMPORT_NOT_CARRIED_REASONS.filter((reason) =>
    reasons.has(reason),
  )
    .map((reason) => {
      const n = notCarried.filter((item) => item.reason === reason).length;
      return `${n} ${TIKTOK_IMPORT_NOT_CARRIED_LABELS[reason]}`;
    })
    .join(", ");
  return `${carried} ${counts.notCarried} not carried — ${breakdown}.`;
}

/** Names the operator can check against Ads Manager, longest list first. */
export function formatTikTokImportNotCarriedNames(
  notCarried: readonly TikTokImportNotCarried[],
  limit = 6,
): string | null {
  if (notCarried.length === 0) return null;
  const names = notCarried.map((item) => item.name).filter(Boolean);
  if (names.length === 0) return null;
  const shown = names.slice(0, limit).join(", ");
  const rest = names.length - Math.min(limit, names.length);
  return rest > 0 ? `${shown}, and ${rest} more.` : `${shown}.`;
}

export function relaunchCampaignName(sourceName: string): string {
  const trimmed = sourceName.trim();
  if (!trimmed) return "Imported campaign — relaunch";
  if (trimmed.endsWith(" — relaunch")) return trimmed;
  return `${trimmed} — relaunch`;
}

export function emptyImportEnhancements(): TikTokImportEnhancements {
  return {
    isAcoOn: 0,
    isAcoOff: 0,
    isAcoAbsent: 0,
    isAcoTotal: 0,
    creativeAuthorizedOn: 0,
    creativeAuthorizedOff: 0,
    creativeAuthorizedAbsent: 0,
    creativeAuthorizedTotal: 0,
  };
}

/**
 * Three counters per flag, not two. A row that never carried the key is
 * `absent`; only a row that carried `false` is `off`.
 */
export function enhancementsFromAds(
  ads: ReadonlyArray<Record<string, unknown>>,
): TikTokImportEnhancements {
  const counts = emptyImportEnhancements();
  counts.isAcoTotal = ads.length;
  counts.creativeAuthorizedTotal = ads.length;
  for (const ad of ads) {
    if (!("is_aco" in ad) || ad.is_aco == null) counts.isAcoAbsent += 1;
    else if (ad.is_aco === true) counts.isAcoOn += 1;
    else counts.isAcoOff += 1;

    if (!("creative_authorized" in ad) || ad.creative_authorized == null) {
      counts.creativeAuthorizedAbsent += 1;
    } else if (ad.creative_authorized === true) {
      counts.creativeAuthorizedOn += 1;
    } else {
      counts.creativeAuthorizedOff += 1;
    }
  }
  return counts;
}
