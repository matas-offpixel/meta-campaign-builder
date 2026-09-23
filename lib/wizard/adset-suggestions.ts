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

import type { AdSetSuggestion, LocationSelection, LocationTargetingGroup, LocationTier } from "@/lib/types";
// Relative + explicit extension (not the "@/" alias): this is a VALUE
// import, not type-only, so `--experimental-strip-types` does not erase it —
// plain Node ESM resolution needs a real resolvable specifier, unlike the
// type-only "@/lib/types" import above which vanishes entirely at runtime.
import {
  adSetLocationGroupIds,
  groupTier,
  groupToGeo,
  locationsToGeo,
} from "../meta/location-targeting.ts";
import { nextDuplicateName } from "../duplicate-name.ts";

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
 * Targets every configured location together (matching every other
 * newly-generated ad set); falls back to `fallbackGroup` (UK nationwide)
 * when no location group is configured yet.
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
  const configured = locationGroups.length > 0;
  return stampLocations(
    {
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
    },
    configured ? locationGroups : [fallbackGroup],
    { configured },
  );
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
 * silently published strict with no way to tell them apart).
 *
 * When the mode is unchanged (blank ad sets, objectives where Advantage+
 * isn't available, or an already-mixed source/copy pair) the copy still
 * MUST have a different name from the source — that is the End Dubs
 * distinguishing behaviour. The fallback used to be " (copy)"; it is now
 * {@link nextDuplicateName} ("Similar Pages 2") so the name stays unique
 * without the useless suffix. The mode-flip suffixes are untouched.
 */
export function resolveDuplicateAdSetName(
  original: Pick<AdSetSuggestion, "name" | "advantagePlus">,
  copyAdvantagePlus: boolean,
  existingNames: readonly string[] = [],
): string {
  if (original.advantagePlus && !copyAdvantagePlus) {
    const suffix = " – Strict";
    return `${truncateForSuffix(original.name, suffix)}${suffix}`;
  }
  if (!original.advantagePlus && copyAdvantagePlus) {
    const suffix = " – Adv+";
    return `${truncateForSuffix(original.name, suffix)}${suffix}`;
  }
  const next = nextDuplicateName(original.name, existingNames);
  if (next.length <= MAX_ADSET_NAME_LENGTH) return next;
  const suffixMatch = /(\s*\d+)$/.exec(next);
  const suffix = suffixMatch?.[1] ?? "";
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
    name: resolveDuplicateAdSetName(
      source,
      copyAdvantagePlus,
      suggestions.map((s) => s.name),
    ),
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
 * present. Drafts generated before the row grew a location badge carry the
 * full group label in the name; reassigning or duplicating such a row must
 * not leave the old location behind in the name.
 */
function stripLocationSuffix(name: string, label: string | undefined): string {
  if (!label) return name;
  for (const suffix of [` — ${label}`, ` — ${shortLocationLabel(label)}`]) {
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
  }
  return name;
}

/**
 * Badge text for a location group label. The stored label is the full Meta
 * path ("Newcastle upon Tyne, England, United Kingdom (+200 km)"); the row
 * badge only needs the place and the radius ("Newcastle upon Tyne +200km").
 * The full label stays stored and goes in the badge's `title`.
 */
export function shortLocationLabel(label: string): string {
  const radius = /\(?\+\s*(\d+)\s*(km|mi)\)?\s*$/i.exec(label);
  const withoutRadius = radius ? label.slice(0, radius.index).trim() : label.trim();
  const place = withoutRadius.split(",")[0].trim();
  return radius ? `${place} +${radius[1]}${radius[2].toLowerCase()}` : place;
}

/** Labels of the groups an id list resolves to, in campaign order; dangling ids are dropped. */
function resolveGroups(ids: readonly string[], groups: LocationTargetingGroup[]): LocationTargetingGroup[] {
  const wanted = new Set(ids);
  return groups.filter((g) => wanted.has(g.id));
}

function resolveExclusions(ids: readonly string[] | undefined, pool: LocationSelection[]): LocationSelection[] {
  if (!ids?.length) return [];
  const wanted = new Set(ids);
  return pool.filter((p) => wanted.has(p.id));
}

/** `locationLabel` for a set of locations: the full labels joined, for logs and the row tooltip. */
function joinedLabel(groups: LocationTargetingGroup[]): string | undefined {
  return groups.length ? groups.map((g) => g.label).join(" · ") : undefined;
}

/**
 * Point an ad set at exactly `locationIds`, restamping the `geoLocations`
 * snapshot and `locationLabel` from the same conversion launch uses.
 *
 * A name without a location in it is the operator's and is left alone. A name
 * ending in its old location (a legacy generated row, or a split row) loses
 * it, and takes the new one only if the row still isolates one location — so
 * a row can never be named for a city it no longer targets.
 */
export function setAdSetLocations(
  suggestion: AdSetSuggestion,
  locationIds: readonly string[],
  groups: LocationTargetingGroup[],
  pool: LocationSelection[] = [],
): AdSetSuggestion {
  const chosen = resolveGroups(locationIds, groups);
  const stripped = stripLocationSuffix(suggestion.name, suggestion.locationLabel);
  const name =
    stripped === suggestion.name
      ? suggestion.name
      : chosen.length === 1
        ? nameForLocation(stripped, undefined, chosen[0])
        : stripped;
  return {
    ...suggestion,
    name,
    locationGroupIds: chosen.map((g) => g.id),
    locationGroupId: undefined,
    geoLocations: chosen.length
      ? locationsToGeo(chosen, resolveExclusions(suggestion.excludedLocationIds, pool))
      : undefined,
    locationLabel: joinedLabel(chosen),
  };
}

/** Apply exactly `exclusionIds` from the campaign pool to an ad set. */
export function setAdSetExclusions(
  suggestion: AdSetSuggestion,
  exclusionIds: readonly string[],
  groups: LocationTargetingGroup[],
  pool: LocationSelection[],
): AdSetSuggestion {
  const excludedLocationIds = resolveExclusions(exclusionIds, pool).map((p) => p.id);
  const ids = adSetLocationGroupIds(suggestion);
  const chosen = ids ? resolveGroups(ids, groups) : [];
  return {
    ...suggestion,
    excludedLocationIds,
    ...(chosen.length
      ? { geoLocations: locationsToGeo(chosen, resolveExclusions(excludedLocationIds, pool)) }
      : {}),
  };
}

/** Row-control bulk apply: give every ad set in `targetIds` the same locations. */
export function applyLocationsToAdSets(
  suggestions: AdSetSuggestion[],
  targetIds: readonly string[],
  locationIds: readonly string[],
  groups: LocationTargetingGroup[],
  pool: LocationSelection[] = [],
): AdSetSuggestion[] {
  const targets = new Set(targetIds);
  return suggestions.map((s) => (targets.has(s.id) ? setAdSetLocations(s, locationIds, groups, pool) : s));
}

/** Row-control bulk apply: give every ad set in `targetIds` the same pooled exclusions. */
export function applyExclusionsToAdSets(
  suggestions: AdSetSuggestion[],
  targetIds: readonly string[],
  exclusionIds: readonly string[],
  groups: LocationTargetingGroup[],
  pool: LocationSelection[],
): AdSetSuggestion[] {
  const targets = new Set(targetIds);
  return suggestions.map((s) => (targets.has(s.id) ? setAdSetExclusions(s, exclusionIds, groups, pool) : s));
}

export type LocationQuickPick = "all" | "primary" | "secondary" | "none";

/** The row control's options: every campaign location with the tier set in the picker. */
export function locationOptions(groups: LocationTargetingGroup[]): { id: string; label: string; tier?: LocationTier }[] {
  return groups.map((g) => ({ id: g.id, label: g.label, tier: groupTier(g) }));
}

/** Ids behind the row control's All / All primary / All secondary / None. */
export function locationIdsForQuickPick(
  options: readonly { id: string; tier?: LocationTier }[],
  pick: LocationQuickPick,
): string[] {
  if (pick === "none") return [];
  return options.filter((o) => pick === "all" || o.tier === pick).map((o) => o.id);
}

/**
 * Generate default: one ad set per audience targeting every campaign location
 * together. `configured` is false for the synthetic UK-nationwide fallback,
 * which is not a real group, so the row keeps only the stamped snapshot.
 */
export function stampLocations(
  base: Omit<AdSetSuggestion, "geoLocations" | "locationLabel">,
  groups: LocationTargetingGroup[],
  opts: { configured: boolean },
): AdSetSuggestion {
  if (!opts.configured) {
    const fallback = groups[0];
    return { ...base, geoLocations: fallback ? groupToGeo(fallback) : undefined, locationLabel: fallback?.label };
  }
  return setAdSetLocations({ ...base } as AdSetSuggestion, groups.map((g) => g.id), groups);
}

/** Name for a row that isolates one location: the audience name plus the short location, within the name cap. */
function nameForLocation(name: string, previousLabel: string | undefined, group: LocationTargetingGroup): string {
  const suffix = ` — ${shortLocationLabel(group.label)}`;
  return `${truncateForSuffix(stripLocationSuffix(name, previousLabel), suffix)}${suffix}`;
}

function uniqueId(candidate: string, taken: Set<string>): string {
  let id = candidate;
  for (let n = 2; taken.has(id); n += 1) id = `${candidate}_${n}`;
  taken.add(id);
  return id;
}

/**
 * Split by city: replace ad set `id` with one ad set per location it
 * targets, in place. Each copy keeps the row's exclusions and settings, takes
 * an even share of its daily budget (so the campaign total is unchanged), and
 * carries the location in its name — that name is what Meta reports per-city
 * CPR under. A row with fewer than two locations is returned unchanged.
 */
export function splitAdSetByLocation(
  suggestions: AdSetSuggestion[],
  id: string,
  groups: LocationTargetingGroup[],
  pool: LocationSelection[] = [],
): AdSetSuggestion[] {
  const idx = suggestions.findIndex((s) => s.id === id);
  if (idx === -1) return suggestions;
  const source = suggestions[idx];
  const chosen = resolveGroups(adSetLocationGroupIds(source) ?? [], groups);
  if (chosen.length < 2) return suggestions;
  const taken = new Set(suggestions.map((s) => s.id));
  taken.delete(source.id);
  const share = roundMoney(source.budgetPerDay / chosen.length);
  const copies = chosen.map((g) =>
    setAdSetLocations(
      {
        ...source,
        id: uniqueId(`${source.id}_${g.id}`, taken),
        name: nameForLocation(source.name, source.locationLabel, g),
        budgetPerDay: share,
      },
      [g.id],
      groups,
      pool,
    ),
  );
  return [...suggestions.slice(0, idx), ...copies, ...suggestions.slice(idx + 1)];
}

/** Every ad set that targets `groupId` (by its effective location ids). */
export function adSetsTargetingLocation(suggestions: AdSetSuggestion[], groupId: string): AdSetSuggestion[] {
  return suggestions.filter((s) => adSetLocationGroupIds(s)?.includes(groupId));
}

/**
 * A location added after ad sets exist is on none of them. "Add to every ad
 * set" — the combined default: append it to every enabled row's locations.
 */
export function addLocationToEveryAdSet(
  suggestions: AdSetSuggestion[],
  group: LocationTargetingGroup,
  groups: LocationTargetingGroup[],
  pool: LocationSelection[] = [],
): AdSetSuggestion[] {
  return suggestions.map((s) => {
    if (!s.enabled) return s;
    const ids = adSetLocationGroupIds(s) ?? [];
    if (ids.includes(group.id)) return s;
    return setAdSetLocations(s, [...ids, group.id], groups, pool);
  });
}

/**
 * Step 5 ad-set row layout. The right-hand controls are ~650px of fixed-width
 * inputs, so the row wraps them under the name before the name column falls
 * below its minimum.
 */
export const ADSET_ROW_MAIN_CLASS = "flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3";
export const ADSET_ROW_NAME_COLUMN_CLASS = "min-w-[14rem] flex-1";
export const ADSET_ROW_NAME_INPUT_CLASS =
  "min-w-[8rem] flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-foreground hover:border-border focus:border-primary focus:bg-card focus:outline-none";
/** The closed row control: capped and truncating, full list in its `title`. */
export const ADSET_ROW_LOCATION_CONTROL_CLASS =
  "inline-flex min-w-0 max-w-[9rem] items-center gap-1 rounded border px-1.5 py-1 text-[11px]";

/**
 * Closed-control summary for an ad set's locations. One location reads as
 * its short label; more read as a count, with the full list for the tooltip,
 * so a long list never re-breaks the row.
 */
export function adSetLocationSummary(
  suggestion: AdSetSuggestion,
  groups: LocationTargetingGroup[],
): { text: string; title: string; empty: boolean } {
  const ids = adSetLocationGroupIds(suggestion);
  if (ids === undefined) {
    const label = suggestion.locationLabel ?? "UK (nationwide)";
    return { text: shortLocationLabel(label), title: `${label} (from before per-row locations)`, empty: false };
  }
  const chosen = resolveGroups(ids, groups);
  if (chosen.length === 0) return { text: "No locations", title: "No locations — this ad set can't launch", empty: true };
  if (chosen.length === 1) return { text: shortLocationLabel(chosen[0].label), title: chosen[0].label, empty: false };
  const allCities = chosen.every((g) => g.selections.every((s) => s.locationType === "city"));
  return {
    text: `${chosen.length} ${allCities ? "cities" : "locations"}`,
    title: chosen.map((g) => g.label).join("\n"),
    empty: false,
  };
}

/** Closed-control summary for the pooled exclusions applied to an ad set. */
export function adSetExclusionSummary(
  suggestion: AdSetSuggestion,
  pool: LocationSelection[],
): { text: string; title: string } {
  const applied = resolveExclusions(suggestion.excludedLocationIds, pool);
  if (applied.length === 0) return { text: "Excl: none", title: "No pooled exclusions applied to this ad set" };
  const labels = applied.map((p) => (p.radius ? `${p.label} (+${p.radius} km)` : p.label));
  return {
    text: applied.length === 1 ? `Excl: ${shortLocationLabel(labels[0])}` : `Excl: ${applied.length}`,
    title: labels.join("\n"),
  };
}

/**
 * "Duplicate ad sets for it" — the split alternative to
 * {@link addLocationToEveryAdSet} for a location added after ad sets exist:
 * one new row per enabled ad set that doesn't target it yet, targeting only
 * that location and named for it. Manual-confirm only. Returns ONLY the new
 * rows; the caller appends them.
 */
export function duplicateSuggestionsUnderLocationGroup(
  suggestions: AdSetSuggestion[],
  targetGroup: LocationTargetingGroup,
  groups: LocationTargetingGroup[] = [targetGroup],
  pool: LocationSelection[] = [],
): AdSetSuggestion[] {
  const allGroups = groups.some((g) => g.id === targetGroup.id) ? groups : [...groups, targetGroup];
  return suggestions
    .filter((s) => s.enabled && !adSetLocationGroupIds(s)?.includes(targetGroup.id))
    .map((s) =>
      setAdSetLocations(
        {
          ...s,
          id: `${s.id}_${targetGroup.id}_${Date.now()}`,
          name: nameForLocation(s.name, s.locationLabel, targetGroup),
        },
        [targetGroup.id],
        allGroups,
        pool,
      ),
    );
}
