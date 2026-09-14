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
};

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
  return `Not carried over from the Smart+ campaign: ${items.join(", ")}.`;
}

export function formatTikTokImportEnhancementLine(
  source: TikTokImportEnhancements,
): string {
  const on = source.isAcoOn > 0 || source.creativeAuthorizedOn > 0;
  return `Source ads: enhancements ${on ? "ON" : "OFF"} (is_aco true on ${source.isAcoOn} of ${source.isAcoTotal}). Relaunch: OFF.`;
}

export function formatTikTokImportCreativeCounts(
  counts: TikTokImportCreativeCounts,
): string {
  return `${counts.chosen} creatives you chose, ${counts.tiktokAdded} TikTok added.`;
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
