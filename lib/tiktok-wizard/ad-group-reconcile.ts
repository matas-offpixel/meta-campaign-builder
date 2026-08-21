/**
 * lib/tiktok-wizard/ad-group-reconcile.ts
 *
 * Keeps `budgetSchedule.adGroups` in step with the interest groups the
 * operator actually has. Before this existed, Step 6 wrote the ad-group list
 * once on first visit and every later read short-circuited on it: an interest
 * group added afterwards never became an ad group (its targeting never
 * launched), and a deleted one left an ad group whose `interestGroupId` no
 * longer resolved, which made the mapper fall back to the flattened union of
 * every group's targeting.
 *
 * The reconciliation rule:
 *
 * - If at least one NON-EMPTY interest group exists, ad groups are 1:1 with
 *   those groups, in interest-group order. An ad group already carrying a
 *   matching `interestGroupId` is preserved so operator edits (names and
 *   budgets) survive. Schedule is campaign-level and is not stored on the
 *   ad group. Ad groups without an `interestGroupId` — the positional
 *   "Ad group 1/2/3" stubs — are dropped once interest groups take over,
 *   because their targeting is not expressible as an interest group and
 *   keeping them would send the flattened union.
 * - If there is NO non-empty interest group, positional ad groups are the
 *   truth: existing ones (with their edits) are kept, orphans pointing at a
 *   deleted or now-empty interest group are dropped, and when nothing is left
 *   a fresh positional default set is generated.
 *
 * Preserved ad groups keep their stored budget even when the group count
 * changes; only freshly-added ad groups take the even split of the campaign
 * budget. Preflight still validates every ad-group budget against TikTok's
 * floor, so a stale split is caught rather than silently launched.
 */

import type {
  TikTokAdGroupDraft,
  TikTokCampaignDraft,
  TikTokInterestGroup,
} from "../types/tiktok-draft.ts";
import { isTikTokInterestGroupNonEmpty } from "./interest-groups.ts";

export interface TikTokAdGroupReconciliation {
  adGroups: TikTokAdGroupDraft[];
  added: TikTokAdGroupDraft[];
  removed: TikTokAdGroupDraft[];
  /** True when the persisted list no longer matches the reconciled one. */
  changed: boolean;
}

export function reconcileTikTokAdGroups(
  draft: TikTokCampaignDraft,
): TikTokAdGroupReconciliation {
  const existing = draft.budgetSchedule.adGroups ?? [];
  const interestGroups = (draft.audiences.interestGroups ?? []).filter(
    isTikTokInterestGroupNonEmpty,
  );
  const adGroups =
    interestGroups.length > 0
      ? fromInterestGroups(draft, existing, interestGroups)
      : fromPositional(draft, existing);

  const nextIds = new Set(adGroups.map((adGroup) => adGroup.id));
  const existingIds = new Set(existing.map((adGroup) => adGroup.id));
  const added = adGroups.filter((adGroup) => !existingIds.has(adGroup.id));
  const removed = existing.filter((adGroup) => !nextIds.has(adGroup.id));
  const reordered =
    existing.length === adGroups.length &&
    existing.some((adGroup, index) => adGroup.id !== adGroups[index]?.id);

  return {
    adGroups,
    added,
    removed,
    changed: added.length > 0 || removed.length > 0 || reordered,
  };
}

/**
 * One line naming what reconciliation did, for the operator. Null when the
 * list is unchanged — silence is only correct when nothing moved.
 */
export function describeTikTokAdGroupReconciliation(
  result: TikTokAdGroupReconciliation,
): string | null {
  if (!result.changed) return null;
  const parts: string[] = [];
  if (result.added.length > 0) {
    parts.push(
      `Added ${result.added.length} ad group${result.added.length === 1 ? "" : "s"} (${result.added
        .map((adGroup) => adGroup.name || adGroup.id)
        .join(", ")})`,
    );
  }
  if (result.removed.length > 0) {
    parts.push(
      `Removed ${result.removed.length} ad group${result.removed.length === 1 ? "" : "s"} (${result.removed
        .map((adGroup) => adGroup.name || adGroup.id)
        .join(", ")})`,
    );
  }
  if (parts.length === 0) parts.push("Reordered ad groups");
  return `${parts.join(" · ")} to match your interest groups.`;
}

export function defaultTikTokPositionalAdGroups(
  draft: TikTokCampaignDraft,
): TikTokAdGroupDraft[] {
  const count = draft.optimisation.smartPlusEnabled ? 2 : 3;
  const perGroupBudget = evenSplit(draft.budgetSchedule.budgetAmount, count);
  return Array.from({ length: count }, (_, index) => ({
    id: `adgroup-${index + 1}`,
    name: draft.optimisation.smartPlusEnabled
      ? `Smart+ ad group ${index + 1}`
      : `Ad group ${index + 1}`,
    budget: perGroupBudget,
    startAt: null,
    endAt: null,
  }));
}

function fromInterestGroups(
  draft: TikTokCampaignDraft,
  existing: TikTokAdGroupDraft[],
  interestGroups: TikTokInterestGroup[],
): TikTokAdGroupDraft[] {
  const byInterestGroupId = new Map<string, TikTokAdGroupDraft>();
  for (const adGroup of existing) {
    if (adGroup.interestGroupId) {
      byInterestGroupId.set(adGroup.interestGroupId, adGroup);
    }
  }
  const perGroupBudget = evenSplit(
    draft.budgetSchedule.budgetAmount,
    interestGroups.length,
  );
  return interestGroups.map((group, index) => {
    const preserved = byInterestGroupId.get(group.id);
    if (preserved) return preserved;
    return {
      id: `ig_${group.id}`,
      name: group.name.trim() || `Interest group ${index + 1}`,
      budget: perGroupBudget,
      startAt: null,
      endAt: null,
      interestGroupId: group.id,
    };
  });
}

function fromPositional(
  draft: TikTokCampaignDraft,
  existing: TikTokAdGroupDraft[],
): TikTokAdGroupDraft[] {
  const positional = existing.filter((adGroup) => !adGroup.interestGroupId);
  if (positional.length > 0) return positional;
  return defaultTikTokPositionalAdGroups(draft);
}

function evenSplit(budgetAmount: number | null, count: number): number | null {
  if (budgetAmount == null || count <= 0) return null;
  return Math.round((budgetAmount / count) * 100) / 100;
}
