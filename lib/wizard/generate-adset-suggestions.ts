/**
 * lib/wizard/generate-adset-suggestions.ts
 *
 * Step 5 "Generate Suggestions": one ad set per audience source per
 * non-empty picker tier. Untiered locations are not swept into a tier —
 * they stay on All and Custom. When no location is tiered, each audience
 * still gets one ad set targeting every campaign location together.
 * Per-city ad sets are an explicit Split by city on the row
 * (`splitAdSetByLocation`), never the default.
 */

import type {
  AdSetSuggestion,
  AudienceSettings,
  LocationTargetingGroup,
  LocationTier,
  LookalikeRange,
} from "@/lib/types";
import { suggestAgeRange } from "../interest-suggestions.ts";
import { groupTier, groupToGeo } from "../meta/location-targeting.ts";
import { nameForTier, stampLocations } from "./adset-suggestions.ts";

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeysDeep((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/**
 * Stable fingerprint for a LocationTargetingGroup's effective geo. Keys are
 * sorted at every level — an array replacer on `JSON.stringify` would also
 * filter nested keys, reducing every single-city group to `{"cities":[{}]}`.
 */
export function geoFingerprint(group: LocationTargetingGroup): string {
  return JSON.stringify(sortKeysDeep(groupToGeo(group)));
}

/** Deduplicate location groups that produce identical geo_locations payloads. */
function deduplicateLocationGroups(groups: LocationTargetingGroup[]): LocationTargetingGroup[] {
  const seen = new Map<string, LocationTargetingGroup>();
  for (const g of groups) {
    const fp = geoFingerprint(g);
    if (!seen.has(fp)) {
      seen.set(fp, g);
    } else {
      console.log(`[deduplicateLocationGroups] Dropping duplicate: "${g.label}" matches "${seen.get(fp)!.label}"`);
    }
  }
  return Array.from(seen.values());
}

export function generateSuggestions(
  audiences: AudienceSettings,
  budget: number,
  locationGroups: LocationTargetingGroup[],
  fallbackGroup: LocationTargetingGroup,
): AdSetSuggestion[] {
  const baseSuggestions: Omit<AdSetSuggestion, "geoLocations" | "locationLabel">[] = [];
  const age = suggestAgeRange(audiences);
  // Declared here (before any forEach that references it) to avoid TDZ crash in the
  // minified/bundled build where the original let/const was placed further down.
  const RANGE_LABELS: Record<string, string> = { "0-1%": "1%", "1-2%": "2%", "2-3%": "3%" };

  audiences.pageGroups.forEach((g) => {
    if (g.pageIds.length === 0) return;
    baseSuggestions.push({
      id: `as_pg_${g.id}`,
      name: g.name || "Page Group",
      sourceType: "page_group",
      sourceId: g.id,
      sourceName: `${g.name || "Untitled"} (${g.pageIds.length} pages)`,
      ageMin: age.min,
      ageMax: age.max,
      budgetPerDay: 0,
      advantagePlus: false,
      enabled: true,
    });
  });

  audiences.customAudienceGroups.forEach((g) => {
    if (g.audienceIds.length === 0) return;
    baseSuggestions.push({
      id: `as_ca_${g.id}`,
      name: g.name || "Custom Audiences",
      sourceType: "custom_group",
      sourceId: g.id,
      sourceName: `${g.name || "Untitled"} (${g.audienceIds.length} audiences)`,
      ageMin: age.min,
      ageMax: age.max,
      budgetPerDay: 0,
      advantagePlus: false,
      enabled: true,
    });
    // Lookalike ad sets from this custom audience group (one per tier)
    if (g.lookalike && g.lookalikeRanges?.length) {
      for (const range of g.lookalikeRanges) {
        const pctLabel = RANGE_LABELS[range] ?? range;
        baseSuggestions.push({
          id: `as_ca_lal_${g.id}_${range}`,
          name: `${g.name || "Custom Audiences"} — ${pctLabel} Lookalike`,
          sourceType: "custom_group_lookalike",
          sourceId: g.id,
          sourceName: `${g.name || "Untitled"} ${pctLabel} Lookalike`,
          lookalikeRange: range,
          ageMin: age.min,
          ageMax: age.max,
          budgetPerDay: 0,
          advantagePlus: false,
          enabled: true,
        });
      }
    }
  });

  audiences.savedAudiences.audienceIds.forEach((id, i) => {
    baseSuggestions.push({
      id: `as_sa_${id}`,
      name: `Saved Audience ${i + 1}`,
      sourceType: "saved_audience",
      sourceId: id,
      sourceName: id,
      ageMin: age.min,
      ageMax: age.max,
      budgetPerDay: 0,
      advantagePlus: false,
      enabled: true,
    });
  });

  audiences.interestGroups.forEach((g) => {
    if (g.interests.length === 0) return;
    baseSuggestions.push({
      id: `as_ig_${g.id}`,
      name: g.name || "Interest Group",
      sourceType: "interest_group",
      sourceId: g.id,
      sourceName: `${g.name || "Untitled"} (${g.interests.length} interests)`,
      ageMin: age.min,
      ageMax: age.max,
      budgetPerDay: 0,
      advantagePlus: false,
      enabled: true,
    });
  });

  // Lookalike ad sets from page groups with lookalike enabled
  audiences.pageGroups.forEach((g) => {
    if (!g.lookalike || g.pageIds.length === 0) return;
    const ranges = g.lookalikeRanges?.length ? g.lookalikeRanges : ["0-1%"];
    for (const range of ranges) {
      const pctLabel = RANGE_LABELS[range] ?? range;
      baseSuggestions.push({
        id: `as_lal_${g.id}_${range}`,
        name: `${g.name || "Page Group"} — ${pctLabel} Lookalike`,
        sourceType: "lookalike_group",
        sourceId: g.id,
        sourceName: `${g.name || "Untitled"} ${pctLabel} Lookalike`,
        ageMin: age.min,
        ageMax: age.max,
        budgetPerDay: 0,
        advantagePlus: false,
        enabled: true,
      });
    }
  });

  // Lookalike ad sets from SelectedPagesLookalikeGroups (one per range per group)
  (audiences.selectedPagesLookalikeGroups ?? []).forEach((g) => {
    if (g.selectedPageIds.length === 0) return;
    const ranges: LookalikeRange[] = g.lookalikeRanges?.length ? g.lookalikeRanges : ["0-1%"];
    for (const range of ranges) {
      const pctLabel = RANGE_LABELS[range] ?? range;
      baseSuggestions.push({
        id: `as_splal_${g.id}_${range}`,
        name: `${g.name || "Selected Pages"} — ${pctLabel} Lookalike`,
        sourceType: "selected_pages_lookalike",
        sourceId: g.id,
        sourceName: `${g.name || "Selected Pages"} (${g.selectedPageIds.length} pages, ${pctLabel})`,
        lookalikeRange: range,
        ageMin: age.min,
        ageMax: age.max,
        budgetPerDay: 0,
        advantagePlus: false,
        enabled: true,
      });
    }
  });

  const configured = locationGroups.length > 0;
  const unique = configured ? deduplicateLocationGroups(locationGroups) : [fallbackGroup];
  const slices = configured ? generateSlices(unique) : [{ groups: unique }];

  const suggestions = baseSuggestions.flatMap((base) =>
    slices.map((slice) =>
      stampLocations(
        slice.tier
          ? {
              ...base,
              id: `${base.id}_${slice.tier}`,
              name: nameForTier(base.name, undefined, slice.tier),
              locationTier: slice.tier,
            }
          : base,
        slice.groups,
        { configured },
      ),
    ),
  );

  const enabled = suggestions.filter((s) => s.enabled);
  const perSet = enabled.length > 0 ? Math.round((budget / enabled.length) * 100) / 100 : 0;
  return suggestions.map((s) => ({ ...s, budgetPerDay: s.enabled ? perSet : 0 }));
}

/** One slice per non-empty tier. No tiers tagged → one slice of every location. */
function generateSlices(
  groups: LocationTargetingGroup[],
): { tier?: LocationTier; groups: LocationTargetingGroup[] }[] {
  const slices: { tier: LocationTier; groups: LocationTargetingGroup[] }[] = [];
  for (const tier of ["primary", "secondary"] as const) {
    const members = groups.filter((g) => groupTier(g) === tier);
    if (members.length) slices.push({ tier, groups: members });
  }
  return slices.length > 0 ? slices : [{ groups }];
}

