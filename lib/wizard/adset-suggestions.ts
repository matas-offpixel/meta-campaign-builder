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

/** Hard floor for `defaultBlankAdSetBudget` — never let a blank ad set default to 0 or near-0. */
const MIN_BLANK_AD_SET_BUDGET = 100;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Default daily budget for a newly-added "Blank ad set" row (task #122,
 * FIX 3) — deliberately never 0. Meta rejects ad set creation outright with
 * subcode 1885272 ("your budget is too low") when `daily_budget` is 0;
 * `createBlankAdSetSuggestion` used to hardcode `budgetPerDay: 0`, which
 * Meta only caught at launch time (reproducer: IPC Newcastle signup v2
 * launch, 2026-08-07).
 *
 * Picks the highest of:
 *   - the median `budgetPerDay` across the ad sets already on this campaign
 *     (matches the campaign's existing budget shape rather than an
 *     arbitrary constant)
 *   - `campaignDefaultBudget` (Step 5's top-level budget amount field —
 *     `BudgetScheduleSettings.budgetAmount`)
 *   - a hard floor of {@link MIN_BLANK_AD_SET_BUDGET}
 */
export function defaultBlankAdSetBudget(
  existingSuggestions: AdSetSuggestion[],
  campaignDefaultBudget: number,
): number {
  const values = existingSuggestions
    .map((s) => s.budgetPerDay)
    .filter((v): v is number => Number.isFinite(v));
  const safeCampaignDefault = Number.isFinite(campaignDefaultBudget) ? campaignDefaultBudget : 0;
  return Math.max(median(values), safeCampaignDefault, MIN_BLANK_AD_SET_BUDGET);
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
 * `defaultBudgetPerDay` defaults to {@link MIN_BLANK_AD_SET_BUDGET} so even a
 * caller that skips `defaultBlankAdSetBudget` entirely can never produce a
 * 0-budget ad set (task #122, FIX 3) — pass the result of
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
 * Clone the ad set with id `id`, appending " (copy)" to its name, and insert
 * the clone directly after the source row (so A/B pairs — e.g. Advantage+ on
 * vs off, or two age bands, on the same audience — stay adjacent instead of
 * landing at the end of the list).
 *
 * Every field is copied via spread, including `placementConfig`, `budgetPerDay`,
 * `geoLocations`/`locationLabel`/`locationGroupId`, and the `advantagePlus` flag.
 * Returns the original array unchanged if `id` isn't found.
 */
export function duplicateAdSetSuggestion(
  suggestions: AdSetSuggestion[],
  id: string,
): AdSetSuggestion[] {
  const idx = suggestions.findIndex((s) => s.id === id);
  if (idx === -1) return suggestions;
  const source = suggestions[idx];
  const clone: AdSetSuggestion = {
    ...source,
    id: `${source.id}_copy_${Date.now()}`,
    name: `${source.name} (copy)`,
  };
  const next = [...suggestions];
  next.splice(idx + 1, 0, clone);
  return next;
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
