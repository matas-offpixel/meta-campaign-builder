import type {
  TikTokAttachAdGroupSnapshot,
  TikTokAttachCampaignSnapshot,
} from "../../types/tiktok-draft.ts";
import {
  snapshotTikTokAttachAdGroup,
  snapshotTikTokAttachCampaign,
  type TikTokAttachAdGroup,
  type TikTokAttachCampaign,
} from "./targets.ts";

/** `/api/tiktok/attach-targets` campaign row. */
export type TikTokAttachCampaignOption = TikTokAttachCampaign & {
  adGroupCount: number | null;
  smartPlus: boolean;
  objectiveSupported: boolean;
};

export type TikTokAttachAdGroupOption = TikTokAttachAdGroup & { smartPlus: boolean };

export function filterTikTokAttachOptions<T extends { id: string; name: string }>(
  rows: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((row) => row.name.toLowerCase().includes(q) || row.id.includes(q));
}

export function toggleTikTokAttachCampaign(
  selected: readonly TikTokAttachCampaignSnapshot[],
  option: TikTokAttachCampaignOption,
  now: Date = new Date(),
): TikTokAttachCampaignSnapshot[] {
  if (selected.some((s) => s.id === option.id)) {
    return selected.filter((s) => s.id !== option.id);
  }
  return [
    ...selected,
    snapshotTikTokAttachCampaign(option, option.adGroupCount, now.toISOString()),
  ];
}

export function toggleTikTokAttachAdGroup(
  selected: readonly TikTokAttachAdGroupSnapshot[],
  option: TikTokAttachAdGroupOption,
  campaignName: string,
  now: Date = new Date(),
): TikTokAttachAdGroupSnapshot[] {
  if (selected.some((s) => s.id === option.id)) {
    return selected.filter((s) => s.id !== option.id);
  }
  return [...selected, snapshotTikTokAttachAdGroup(option, campaignName, now.toISOString())];
}

/** Picker row disabled reason, or null when it can be selected. */
export function tikTokAttachCampaignDisabledReason(
  option: TikTokAttachCampaignOption,
  mode: "attach_campaign" | "attach_adgroup" | "attach_all_adgroups",
): string | null {
  if (option.smartPlus) return "Smart+ — not supported";
  if (mode === "attach_campaign" && !option.objectiveSupported) {
    return `${option.objectiveType ?? "Unknown objective"} — cannot create ad groups`;
  }
  return null;
}

export function tikTokAttachBudgetLabel(option: {
  budgetMode: string | null;
  budgetOptimizeOn: boolean;
}): string {
  const mode = (option.budgetMode ?? "").replace(/^BUDGET_MODE_/, "").toLowerCase() || "—";
  return option.budgetOptimizeOn ? `campaign budget (${mode})` : `ad group budgets`;
}
