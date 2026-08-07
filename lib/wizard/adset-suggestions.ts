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
 */

import type { AdSetSuggestion, LocationTargetingGroup } from "@/lib/types";
// Relative + explicit extension (not the "@/" alias): this is a VALUE
// import, not type-only, so `--experimental-strip-types` does not erase it —
// plain Node ESM resolution needs a real resolvable specifier, unlike the
// type-only "@/lib/types" import above which vanishes entirely at runtime.
import { groupToGeo } from "../meta/location-targeting.ts";

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
 */
export function createBlankAdSetSuggestion(
  locationGroups: LocationTargetingGroup[],
  fallbackGroup: LocationTargetingGroup,
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
    budgetPerDay: 0,
    advantagePlus: true,
    enabled: true,
    geoLocations: groupToGeo(effectiveGroup),
    locationLabel: effectiveGroup.label,
  };
}

/**
 * Clone the ad set with id `id`, appending " (copy)" to its name, and insert
 * the clone directly after the source row (so A/B pairs — e.g. Advantage+ on
 * vs off, or two age bands, on the same audience — stay adjacent instead of
 * landing at the end of the list).
 *
 * Every field is copied via spread, including `placementConfig`, `budgetPerDay`,
 * `geoLocations`/`locationLabel`, and the `advantagePlus` flag.
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
