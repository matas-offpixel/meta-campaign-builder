/**
 * Per-ad-group budget on Assign. The campaign amount is a fallback in
 * resolveTikTokAdGroupBudget; an imported group keeps its own number,
 * so the operator has to be able to edit that number. Nothing here
 * raises or lowers a budget without a click.
 */

import { tikTokAdGroupBudgetFloor } from "../tiktok/write/mapping.ts";
import type {
  TikTokAdGroupDraft,
  TikTokBudgetSchedule,
} from "../types/tiktok-draft.ts";
import { parseOptionalMoney } from "./budget-schedule.ts";

export function patchTikTokAdGroupBudget(
  adGroups: readonly TikTokAdGroupDraft[],
  adGroupId: string,
  budget: number | null,
): TikTokAdGroupDraft[] {
  return adGroups.map((group) =>
    group.id === adGroupId ? { ...group, budget } : group,
  );
}

export function persistTikTokAdGroupBudgetPatch(
  schedule: TikTokBudgetSchedule,
  adGroupId: string,
  budget: number | null,
): TikTokBudgetSchedule {
  return {
    ...schedule,
    adGroups: patchTikTokAdGroupBudget(schedule.adGroups, adGroupId, budget),
  };
}

export function parseTikTokAdGroupBudgetInput(raw: string): number | null {
  return parseOptionalMoney(raw);
}

export function tikTokAdGroupBudgetFloorLine(input: {
  budgetMode: TikTokBudgetSchedule["budgetMode"];
  startAt: string | null;
  endAt: string | null;
  currency: string | null | undefined;
}): string {
  const currency = (input.currency ?? "").trim().toUpperCase() || "unknown";
  const floor = tikTokAdGroupBudgetFloor({
    budgetMode: input.budgetMode,
    startAt: input.startAt,
    endAt: input.endAt,
    currency: input.currency,
  });
  if (!floor.ok) return floor.error.message;
  if (floor.value == null) {
    return `No TikTok minimum is documented for ${currency} — preflight will not block on amount`;
  }
  return `TikTok's ${currency} minimum for ${input.budgetMode} is ${floor.value}`;
}

export function tikTokAdGroupBudgetDiffersFromCampaign(
  adGroupBudget: number | null,
  campaignAmount: number | null,
): adGroupBudget is number {
  return (
    adGroupBudget != null &&
    campaignAmount != null &&
    adGroupBudget !== campaignAmount
  );
}

export function tikTokAdGroupMatchCampaignLine(input: {
  campaignAmount: number;
  adGroupBudget: number;
}): { text: string; action: string } {
  return {
    text: `Campaign budget is £${input.campaignAmount}. This ad group is £${input.adGroupBudget}.`,
    action: `Set to £${input.campaignAmount}`,
  };
}

export function tikTokAdGroupBudgetIssue<T extends { id: string }>(
  issues: readonly T[],
  adGroupId: string,
): T | undefined {
  return issues.find(
    (issue) =>
      issue.id === `adgroup-budget-${adGroupId}` ||
      issue.id === `adgroup-budget-floor-${adGroupId}`,
  );
}

/**
 * Skip a payload-builder budget error only when collect already pushed
 * `adgroup-budget-{id}` or `adgroup-budget-floor-{id}` for this group.
 * Keyed on those ids, not on `field === "budget"`, so a later payload-only
 * budget rule still emits.
 */
export function shouldSkipDuplicateTikTokAdGroupBudgetPayload(
  issues: readonly { id: string }[],
  adGroupId: string,
): boolean {
  return tikTokAdGroupBudgetIssue(issues, adGroupId) != null;
}

export function shouldPersistTikTokAdGroupBudget(
  eventType: "change" | "blur",
): boolean {
  return eventType === "blur";
}

export function applyTikTokAdGroupBudgetChange(
  writes: { persist: (raw: string) => void },
  eventType: "change" | "blur",
  raw: string,
): void {
  if (!shouldPersistTikTokAdGroupBudget(eventType)) return;
  writes.persist(raw);
}

/** A write in flight does not disable the field. */
export function tikTokAdGroupBudgetFieldDisabled(_input: {
  saving: boolean;
}): boolean {
  return false;
}

export function tikTokAdGroupBudgetDraftValue(budget: number | null): string {
  return budget == null ? "" : String(budget);
}
