/**
 * Existing TikTok campaigns and ad groups a launch can write into.
 *
 * Field names are the ones `/campaign/get/` and `/adgroup/get/` returned
 * for Ironworks on 2026-10-08 (see the PR session log). Notably
 * `budget_optimize_on` is absent unless it is true, and Smart+ shows as
 * `campaign_automation_type: UPGRADED_SMART_PLUS` on campaigns and on
 * ad groups independently.
 */

import type {
  TikTokAttachAdGroupSnapshot,
  TikTokAttachCampaignSnapshot,
  TikTokObjective,
} from "../../types/tiktok-draft.ts";
import { classifyTikTokCampaign } from "../import/types.ts";

export interface TikTokAttachCampaign {
  id: string;
  name: string;
  operationStatus: string | null;
  secondaryStatus: string | null;
  objectiveType: string | null;
  salesDestination: string | null;
  budgetMode: string | null;
  budgetOptimizeOn: boolean;
  automationType: string | null;
  isSmartPerformanceCampaign: boolean;
}

export interface TikTokAttachAdGroup {
  id: string;
  name: string;
  campaignId: string;
  campaignName: string | null;
  operationStatus: string | null;
  secondaryStatus: string | null;
  optimizationGoal: string | null;
  optimizationEvent: string | null;
  pixelId: string | null;
  promotionType: string | null;
  automationType: string | null;
  isSmartPerformanceCampaign: boolean;
}

/**
 * Launch-time view of the targets. `source: "snapshot"` means the live
 * read failed (or this is the browser) and the values were captured at
 * selection time.
 */
export interface TikTokAttachLiveTargets {
  source: "live" | "snapshot";
  campaigns: TikTokAttachCampaign[];
  /** Every ad group of `campaigns`, deleted rows already dropped. */
  adGroups: TikTokAttachAdGroup[];
  /** Campaign ids whose ad-group read failed. */
  adGroupReadFailed: string[];
}

export const TIKTOK_ATTACH_CAMPAIGN_FIELDS = [
  "campaign_id",
  "campaign_name",
  "objective_type",
  "sales_destination",
  "budget",
  "budget_mode",
  "budget_optimize_on",
  "operation_status",
  "secondary_status",
  "campaign_automation_type",
  "is_smart_performance_campaign",
] as const;

export const TIKTOK_ATTACH_ADGROUP_FIELDS = [
  "adgroup_id",
  "adgroup_name",
  "campaign_id",
  "campaign_name",
  "operation_status",
  "secondary_status",
  "optimization_goal",
  "optimization_event",
  "pixel_id",
  "promotion_type",
  "campaign_automation_type",
  "is_smart_performance_campaign",
] as const;

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function normalizeTikTokAttachCampaign(
  row: Record<string, unknown>,
): TikTokAttachCampaign | null {
  const id = str(row.campaign_id);
  if (!id) return null;
  return {
    id,
    name: str(row.campaign_name) ?? id,
    operationStatus: str(row.operation_status),
    secondaryStatus: str(row.secondary_status),
    objectiveType: str(row.objective_type),
    salesDestination: str(row.sales_destination),
    budgetMode: str(row.budget_mode),
    budgetOptimizeOn: row.budget_optimize_on === true,
    automationType: str(row.campaign_automation_type),
    isSmartPerformanceCampaign: row.is_smart_performance_campaign === true,
  };
}

export function normalizeTikTokAttachAdGroup(
  row: Record<string, unknown>,
): TikTokAttachAdGroup | null {
  const id = str(row.adgroup_id);
  const campaignId = str(row.campaign_id);
  if (!id || !campaignId) return null;
  return {
    id,
    name: str(row.adgroup_name) ?? id,
    campaignId,
    campaignName: str(row.campaign_name),
    operationStatus: str(row.operation_status),
    secondaryStatus: str(row.secondary_status),
    optimizationGoal: str(row.optimization_goal),
    optimizationEvent: str(row.optimization_event),
    pixelId: str(row.pixel_id),
    promotionType: str(row.promotion_type),
    automationType: str(row.campaign_automation_type),
    isSmartPerformanceCampaign: row.is_smart_performance_campaign === true,
  };
}

/**
 * ENABLE / DISABLE and not deleted. The Ironworks probe returned no
 * deleted rows (default and `primary_status: STATUS_ALL` gave the same
 * 27), so deletion is checked on both status fields rather than trusting
 * the default filter.
 */
export function isLiveTikTokStatus(row: {
  operationStatus: string | null;
  secondaryStatus: string | null;
}): boolean {
  const op = (row.operationStatus ?? "").toUpperCase();
  if (op && op !== "ENABLE" && op !== "DISABLE") return false;
  return !(row.secondaryStatus ?? "").toUpperCase().includes("DELETE");
}

export function isSmartPlusTikTokTarget(row: {
  automationType: string | null;
  isSmartPerformanceCampaign: boolean;
}): boolean {
  return (
    classifyTikTokCampaign({
      campaign_automation_type: row.automationType,
      is_smart_performance_campaign: row.isSmartPerformanceCampaign,
    }) !== "manual"
  );
}

/** `objective_type` → the draft objective the writer knows how to build. */
export function draftObjectiveForTikTokObjectiveType(
  objectiveType: string | null,
): TikTokObjective | null {
  switch ((objectiveType ?? "").toUpperCase()) {
    case "WEB_CONVERSIONS":
      return "CONVERSIONS";
    case "TRAFFIC":
      return "TRAFFIC";
    case "LEAD_GENERATION":
      return "LEAD_GENERATION";
    default:
      return null;
  }
}

export function snapshotTikTokAttachCampaign(
  row: TikTokAttachCampaign,
  adGroupCount: number | null,
  capturedAt: string,
): TikTokAttachCampaignSnapshot {
  return {
    id: row.id,
    name: row.name,
    status: row.operationStatus,
    objectiveType: row.objectiveType,
    budgetMode: row.budgetMode,
    budgetOptimizeOn: row.budgetOptimizeOn,
    automationType: row.automationType,
    adGroupCount,
    capturedAt,
  };
}

export function snapshotTikTokAttachAdGroup(
  row: TikTokAttachAdGroup,
  campaignName: string,
  capturedAt: string,
): TikTokAttachAdGroupSnapshot {
  return {
    id: row.id,
    name: row.name,
    campaignId: row.campaignId,
    campaignName: row.campaignName ?? campaignName,
    status: row.operationStatus,
    optimizationGoal: row.optimizationGoal,
    optimizationEvent: row.optimizationEvent,
    pixelId: row.pixelId,
    automationType: row.automationType,
    capturedAt,
  };
}

/** What the browser can know: the selection-time snapshots. */
export function tikTokAttachTargetsFromSnapshots(draft: {
  attachCampaigns?: TikTokAttachCampaignSnapshot[];
  attachAdGroups?: TikTokAttachAdGroupSnapshot[];
}): TikTokAttachLiveTargets {
  return {
    source: "snapshot",
    campaigns: (draft.attachCampaigns ?? []).map((snap) => ({
      id: snap.id,
      name: snap.name,
      operationStatus: snap.status,
      secondaryStatus: null,
      objectiveType: snap.objectiveType,
      salesDestination: null,
      budgetMode: snap.budgetMode,
      budgetOptimizeOn: snap.budgetOptimizeOn === true,
      automationType: snap.automationType,
      isSmartPerformanceCampaign: false,
    })),
    adGroups: (draft.attachAdGroups ?? []).map((snap) => ({
      id: snap.id,
      name: snap.name,
      campaignId: snap.campaignId,
      campaignName: snap.campaignName,
      operationStatus: snap.status,
      secondaryStatus: null,
      optimizationGoal: snap.optimizationGoal,
      optimizationEvent: snap.optimizationEvent,
      pixelId: snap.pixelId,
      promotionType: null,
      automationType: snap.automationType,
      isSmartPerformanceCampaign: false,
    })),
    adGroupReadFailed: [],
  };
}
