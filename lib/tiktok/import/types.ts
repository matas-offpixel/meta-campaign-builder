/**
 * Live TikTok → creator import. Read-only against TikTok. The source
 * campaign is never written. Launch is the existing gated writer.
 */

export const TIKTOK_IMPORT_PATHS = [
  "/campaign/get/",
  "/adgroup/get/",
  "/ad/get/",
  "/smart_plus/adgroup/get/",
  "/smart_plus/ad/get/",
  "/campaign/spc/get/",
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

export type TikTokImportEnhancements = {
  isAcoOn: number;
  isAcoTotal: number;
  creativeAuthorizedOn: number;
  creativeAuthorizedTotal: number;
};

export type TikTokImportCreativeCounts = {
  chosen: number;
  tiktokAdded: number;
};

export type TikTokImportMeta = {
  sourceCampaignId: string;
  sourceCampaignName: string;
  sourceKind: TikTokLiveCampaignKind;
  dropped: TikTokImportDroppedField[];
  sourceEnhancements: TikTokImportEnhancements;
  creativeCounts: TikTokImportCreativeCounts | null;
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
  "connection_type",
  "carrier_ids",
  "isp_ids",
  "network_types",
] as const;

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
  connection_type: "connection type",
  carrier_ids: "carriers",
  isp_ids: "ISPs",
  network_types: "network types",
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
  const on = source.isAcoOn > 0 || source.creativeAuthorizedOn > 0;
  return `Source ads: enhancements ${on ? "ON" : "OFF"} (is_aco true on ${source.isAcoOn} of ${source.isAcoTotal}). Relaunch: ${relaunch}.`;
}

export function formatTikTokImportCreativeCounts(
  counts: TikTokImportCreativeCounts,
): string {
  return `${counts.chosen} creatives you chose (assigned), ${counts.tiktokAdded} TikTok added (unassigned).`;
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
    isAcoTotal: 0,
    creativeAuthorizedOn: 0,
    creativeAuthorizedTotal: 0,
  };
}

export function enhancementsFromAds(
  ads: ReadonlyArray<{
    is_aco?: boolean | null;
    creative_authorized?: boolean | null;
  }>,
): TikTokImportEnhancements {
  let isAcoOn = 0;
  let creativeAuthorizedOn = 0;
  for (const ad of ads) {
    if (ad.is_aco === true) isAcoOn += 1;
    if (ad.creative_authorized === true) creativeAuthorizedOn += 1;
  }
  return {
    isAcoOn,
    isAcoTotal: ads.length,
    creativeAuthorizedOn,
    creativeAuthorizedTotal: ads.length,
  };
}
