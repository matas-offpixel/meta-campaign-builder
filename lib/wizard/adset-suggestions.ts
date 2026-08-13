/**
 * lib/wizard/adset-suggestions.ts
 *
 * Pure, framework-free helpers for the Step 5 "Ad Sets" refinement pack
 * (operator ask 2026-08-07). Kept out of `components/steps/budget-schedule.tsx`
 * so the array-manipulation logic is unit-testable without rendering React,
 * and so the component only has to wire state + render.
 *
 * Covers:
 *   - "+ Blank ad set"          → createBlankAdSetSuggestion
 *   - Duplicate ad set (icon)   → duplicateAdSetSuggestion
 *   - Delete ad set (icon)      → deleteAdSetSuggestion
 *   - Bulk "Set all ages"       → applyBulkAgeRange
 *   - Bulk "Set all budgets"    → applyBulkDailyBudget
 *   - "Generate audience set × location" bonus → duplicateSuggestionsUnderLocationGroup
 */

import type { AdSetSuggestion, LocationTargetingGroup } from "@/lib/types";
// Relative + explicit extension (not the "@/" alias): this is a VALUE
// import, not type-only, so `--experimental-strip-types` does not erase it —
// plain Node ESM resolution needs a real resolvable specifier, unlike the
// type-only "@/lib/types" import above which vanishes entirely at runtime.
import { groupToGeo } from "../meta/location-targeting.ts";

/**
 * Meta's practical minimum daily budget in major currency units. Used as the
 * only hard floor for blank ad sets — never 0 (subcode 1885272), but never a
 * fixed £100 either (PR #756's floor launched Wide/blank sets at 4–40× the
 * campaign budget; reproducer: Puzzle Southampton 2026-08-13, £25 campaign →
 * Wide defaulted to £100/day).
 */
export const MIN_BLANK_AD_SET_BUDGET = 1;

/**
 * Step 5 warning threshold: flag any enabled ad set whose `budgetPerDay` is
 * more than this share of the campaign daily budget (Soft warning only —
 * does not block launch).
 */
export const AD_SET_BUDGET_SHARE_WARNING_THRESHOLD = 0.3;

/**
 * Ad set name length cap for the Step 5 inline name input (task #126).
 * Meta's actual ad set name limit is ~400 chars, but the UI stays tight so
 * names remain scannable in the row list.
 */
export const MAX_ADSET_NAME_LENGTH = 40;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Default daily budget for a newly-added "Blank ad set" row (task #122,
 * FIX 3 + Puzzle Southampton scale fix). Deliberately never 0 — Meta rejects
 * ad set creation with subcode 1885272 when `daily_budget` is 0 — but also
 * never a fixed £100 floor that ignores campaign scale.
 *
 * Formula:
 *   candidate = max(
 *     median(enabled ad sets' budgetPerDay),
 *     campaignDefault / (enabledCount + 1),
 *     £1
 *   )
 * then, when `campaignDefault > 0`, cap at `campaignDefault / (enabledCount + 1)`
 * so a blank/Wide row can never claim more than an equal share of the
 * campaign daily budget post-add.
 *
 * With no campaign budget set, falls back to `max(median, £1)`.
 */
export function defaultBlankAdSetBudget(
  existingSuggestions: AdSetSuggestion[],
  campaignDefaultBudget: number,
): number {
  const enabled = existingSuggestions.filter((s) => s.enabled);
  const values = enabled
    .map((s) => s.budgetPerDay)
    .filter((v): v is number => Number.isFinite(v) && v > 0);
  const medianBudget = median(values);
  const safeCampaignDefault =
    Number.isFinite(campaignDefaultBudget) && campaignDefaultBudget > 0
      ? campaignDefaultBudget
      : 0;
  const equalShare =
    safeCampaignDefault > 0
      ? roundMoney(safeCampaignDefault / (enabled.length + 1))
      : 0;

  const candidate = Math.max(medianBudget, equalShare, MIN_BLANK_AD_SET_BUDGET);
  if (equalShare > 0) {
    // Cap at equal share so median can't pull a blank set above the
    // campaign-scale per-set allotment (Puzzle Southampton: median £3.13
    // on a £25/8 campaign must not win over £25/9).
    return Math.max(Math.min(candidate, equalShare), MIN_BLANK_AD_SET_BUDGET);
  }
  return candidate;
}

export interface OversizedBudgetAdSet {
  id: string;
  name: string;
  budgetPerDay: number;
  /** `budgetPerDay / campaignDailyBudget` — greater than the warning threshold. */
  shareOfCampaign: number;
}

/**
 * Enabled ad sets whose daily budget exceeds {@link AD_SET_BUDGET_SHARE_WARNING_THRESHOLD}
 * of the campaign daily budget. Pure helper for the Step 5 soft warning —
 * empty when the campaign budget is unset/non-positive.
 */
export function findAdSetsExceedingBudgetShare(
  suggestions: AdSetSuggestion[],
  campaignDailyBudget: number,
  threshold: number = AD_SET_BUDGET_SHARE_WARNING_THRESHOLD,
): OversizedBudgetAdSet[] {
  if (!(campaignDailyBudget > 0) || !(threshold > 0)) return [];
  return suggestions
    .filter((s) => s.enabled && Number.isFinite(s.budgetPerDay) && s.budgetPerDay > 0)
    .map((s) => ({
      id: s.id,
      name: s.name,
      budgetPerDay: s.budgetPerDay,
      shareOfCampaign: s.budgetPerDay / campaignDailyBudget,
    }))
    .filter((s) => s.shareOfCampaign > threshold);
}

/**
 * Build a new "blank" ad set: no page/custom/interest/lookalike source,
 * Advantage+ Audience always ON (`advantagePlus: true`, and the UI disables
 * the toggle for this row so the operator can't turn it off — see
 * `lib/meta/adset.ts` `buildMetaTargeting` for the belt-and-braces backend
 * enforcement of the same rule).
 *
 * Defaults its location to the first configured location group (matching
 * every other newly-generated ad set); falls back to `fallbackGroup`
 * (UK nationwide) when no location group is configured yet.
 *
 * `defaultBudgetPerDay` defaults to {@link MIN_BLANK_AD_SET_BUDGET} (£1) so
 * even a caller that skips `defaultBlankAdSetBudget` entirely can never
 * produce a 0-budget ad set (task #122, FIX 3) — pass the result of
 * `defaultBlankAdSetBudget` explicitly for the real "existing campaign
 * shape" default.
 */
export function createBlankAdSetSuggestion(
  locationGroups: LocationTargetingGroup[],
  fallbackGroup: LocationTargetingGroup,
  defaultBudgetPerDay: number = MIN_BLANK_AD_SET_BUDGET,
): AdSetSuggestion {
  const primary = locationGroups[0];
  const effectiveGroup = primary ?? fallbackGroup;
  return {
    id: `as_blank_${Date.now()}`,
    name: "Blank (no audience)",
    sourceType: "blank",
    sourceId: "",
    sourceName: "No audience source — Advantage+ Audience only",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: defaultBudgetPerDay > 0 ? defaultBudgetPerDay : MIN_BLANK_AD_SET_BUDGET,
    advantagePlus: true,
    enabled: true,
    geoLocations: groupToGeo(effectiveGroup),
    locationLabel: effectiveGroup.label,
    locationGroupId: primary?.id,
  };
}

/**
 * Truncate `name` to fit within {@link MAX_ADSET_NAME_LENGTH} once `suffix`
 * is appended, using an ellipsis rather than a hard cut so it's clear the
 * name was shortened.
 */
function truncateForSuffix(name: string, suffix: string): string {
  const maxBaseLength = Math.max(0, MAX_ADSET_NAME_LENGTH - suffix.length);
  if (name.length <= maxBaseLength) return name;
  return maxBaseLength <= 1 ? name.slice(0, maxBaseLength) : `${name.slice(0, maxBaseLength - 1)}…`;
}

/**
 * Default name for a duplicated ad set (task #126). When the duplicate's
 * `advantagePlus` differs from the source's (see `duplicateAdSetSuggestion`
 * below — it flips the copy's targeting mode whenever the campaign objective
 * supports both), name the copy after the mode it's actually about to run
 * with (" – Strict" / " – Adv+") so the pair reads as an intentional A/B
 * instead of two identically-named, identically-configured rows (the East
 * End Dubs Newcastle "Similar Pages" / "Similar Pages (copy)" bug — both
 * silently published strict with no way to tell them apart). Falls back to
 * the plain " (copy)" suffix when the mode is unchanged (blank ad sets,
 * objectives where Advantage+ isn't available at all, or an already-mixed
 * source/copy pair).
 */
export function resolveDuplicateAdSetName(
  original: Pick<AdSetSuggestion, "name" | "advantagePlus">,
  copyAdvantagePlus: boolean,
): string {
  let suffix = " (copy)";
  if (original.advantagePlus && !copyAdvantagePlus) suffix = " – Strict";
  else if (!original.advantagePlus && copyAdvantagePlus) suffix = " – Adv+";
  return `${truncateForSuffix(original.name, suffix)}${suffix}`;
}

/**
 * Clone the ad set with id `id` and insert the clone directly after the
 * source row (so A/B pairs — e.g. Advantage+ on vs off, or two age bands, on
 * the same audience — stay adjacent instead of landing at the end of the
 * list).
 *
 * Every field is copied via spread, including `placementConfig`,
 * `budgetPerDay`, and `geoLocations`/`locationLabel`/`locationGroupId`.
 *
 * `advantagePlus` and `name` are the two exceptions (task #126): when
 * `advantagePlusSupported` is true and the source isn't a "blank" ad set
 * (which always forces Advantage+ ON), the copy's `advantagePlus` is
 * flipped from the source's so duplicating instantly produces a useful A/B
 * differentiator rather than an identical sibling — see
 * `resolveDuplicateAdSetName` for the matching name suffix. Pass
 * `advantagePlusSupported: false` when the campaign's objective/optimisation
 * goal doesn't support Advantage+ Audience at all (see
 * `isAdvantageAudienceSupportedForObjective` in
 * `lib/meta/advantage-plus-compat.ts`) to keep the copy identical to the
 * source instead — flipping it there would just get silently stripped by
 * Meta (subcode 1870196).
 *
 * Returns the original array unchanged if `id` isn't found.
 */
export function duplicateAdSetSuggestion(
  suggestions: AdSetSuggestion[],
  id: string,
  advantagePlusSupported: boolean = true,
): AdSetSuggestion[] {
  const idx = suggestions.findIndex((s) => s.id === id);
  if (idx === -1) return suggestions;
  const source = suggestions[idx];
  const isBlank = source.sourceType === "blank";
  const copyAdvantagePlus = isBlank || !advantagePlusSupported ? source.advantagePlus : !source.advantagePlus;
  const clone: AdSetSuggestion = {
    ...source,
    id: `${source.id}_copy_${Date.now()}`,
    name: resolveDuplicateAdSetName(source, copyAdvantagePlus),
    advantagePlus: copyAdvantagePlus,
  };
  const next = [...suggestions];
  next.splice(idx + 1, 0, clone);
  return next;
}

/**
 * Force `advantagePlus: false` on every ad set that currently has it set
 * (task #127). The caller is responsible for only invoking this when the
 * campaign's objective/optimisation goal doesn't support Advantage+ Audience
 * at all (`!isAdvantageAudienceSupportedForObjective(...)` in
 * `lib/meta/advantage-plus-compat.ts`) — this function itself has no
 * objective awareness, it just performs the clear.
 *
 * Deliberately applies to EVERY ad set, including "blank" ones (which
 * `createBlankAdSetSuggestion` otherwise always creates with
 * `advantagePlus: true`, and whose row toggle the UI locks so an operator
 * can never turn it off manually). Without this, a blank ad set on an
 * incompatible objective would be permanently unlaunchable — the same
 * "stuck, no way to fix it from the UI" bug this task exists to close, just
 * for the one row type the per-row toggle can't reach. A cleared blank ad
 * set still targets by age/location; it just runs as plain broad targeting
 * instead of Advantage+ prospecting, which Meta accepts under any objective.
 *
 * Returns the (possibly identical) array plus how many rows were changed, so
 * the caller can skip a no-op `onSuggestionsChange` and decide whether to
 * show a "cleared N ad sets" notice.
 */
export function clearUnsupportedAdvantagePlus(
  suggestions: AdSetSuggestion[],
): { suggestions: AdSetSuggestion[]; clearedCount: number } {
  let clearedCount = 0;
  const next = suggestions.map((s) => {
    if (!s.advantagePlus) return s;
    clearedCount += 1;
    return { ...s, advantagePlus: false };
  });
  return { suggestions: next, clearedCount };
}

/** Delete the ad set with id `id`. Distinct from the `enabled` checkbox toggle. */
export function deleteAdSetSuggestion(
  suggestions: AdSetSuggestion[],
  id: string,
): AdSetSuggestion[] {
  return suggestions.filter((s) => s.id !== id);
}

/** Bulk-write ageMin/ageMax onto every ad set row (destructive — caller should offer undo). */
export function applyBulkAgeRange(
  suggestions: AdSetSuggestion[],
  ageMin: number,
  ageMax: number,
): AdSetSuggestion[] {
  return suggestions.map((s) => ({ ...s, ageMin, ageMax }));
}

/** Bulk-write budgetPerDay onto every ad set row (destructive — caller should offer undo). */
export function applyBulkDailyBudget(
  suggestions: AdSetSuggestion[],
  budgetPerDay: number,
): AdSetSuggestion[] {
  return suggestions.map((s) => ({ ...s, budgetPerDay }));
}

/**
 * Strip a trailing " — <label>" location suffix from an ad set name, if
 * present. Used before re-appending a *different* location's suffix so
 * repeated duplication doesn't chain suffixes ("Page Group — A — B — C").
 */
function stripLocationSuffix(name: string, label: string | undefined): string {
  if (!label) return name;
  const suffix = ` — ${label}`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

/**
 * "Generate audience set × location" bonus (task #118): duplicate every
 * currently-ENABLED ad set that isn't already assigned to `targetGroup`
 * under that new location group — one new row per existing audience, same
 * pattern as the audience × location cross-product `generateSuggestions`
 * already does at first-generation time.
 *
 * Manual-confirm only — the caller renders a button/banner and calls this
 * on click; it never runs automatically when a group is added. Returns ONLY
 * the new rows; the caller appends them to the existing array.
 */
export function duplicateSuggestionsUnderLocationGroup(
  suggestions: AdSetSuggestion[],
  targetGroup: LocationTargetingGroup,
): AdSetSuggestion[] {
  const geo = groupToGeo(targetGroup);
  return suggestions
    .filter((s) => s.enabled && s.locationGroupId !== targetGroup.id)
    .map((s) => ({
      ...s,
      id: `${s.id}_${targetGroup.id}_${Date.now()}`,
      name: `${stripLocationSuffix(s.name, s.locationLabel)} — ${targetGroup.label}`,
      geoLocations: geo,
      locationLabel: targetGroup.label,
      locationGroupId: targetGroup.id,
    }));
}
