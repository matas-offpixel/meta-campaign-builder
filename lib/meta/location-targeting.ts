/**
 * lib/meta/location-targeting.ts
 *
 * Pure conversion between the wizard's `LocationTargetingGroup` model (Step 5
 * "Location Targeting") and Meta's ad-set `geo_locations` targeting shape.
 *
 * Extracted out of `components/steps/budget-schedule.tsx` (where `groupToGeo`
 * originally lived, only used at "Generate Suggestions" time to STAMP a
 * snapshot onto each `AdSetSuggestion.geoLocations`) so the same conversion
 * can also run at LAUNCH time in `lib/meta/adset.ts`, resolving an ad set's
 * locations fresh against `BudgetScheduleSettings.locationGroups` (task #118,
 * multi-location per campaign). One conversion, two call sites — no risk of
 * UI and launch payload drifting apart on what a given location actually means.
 */

import type {
  AdSetGeoLocations,
  AdSetSuggestion,
  BudgetScheduleSettings,
  LocationSelection,
  LocationTargetingGroup,
  LocationTier,
} from "@/lib/types";

type GeoCity = NonNullable<AdSetGeoLocations["cities"]>[number];
type GeoArea = { countries?: string[]; cities?: GeoCity[]; regions?: { key: string }[] };

function pushSelection(target: GeoArea, sel: LocationSelection): void {
  if (sel.locationType === "country" && sel.countryCode) {
    target.countries = target.countries ?? [];
    target.countries.push(sel.countryCode);
  } else if (sel.locationType === "city" && sel.locationKey) {
    target.cities = target.cities ?? [];
    target.cities.push({ key: sel.locationKey, radius: sel.radius, distance_unit: sel.distanceUnit });
  } else if (sel.locationType === "region" && sel.locationKey) {
    target.regions = target.regions ?? [];
    target.regions.push({ key: sel.locationKey });
  }
}

function radiusKm(radius: number | undefined, unit: GeoCity["distance_unit"]): number {
  if (!radius) return 0;
  return unit === "mile" ? radius * 1.609344 : radius;
}

/** Union of areas: one entry per country / region / city key; a city listed twice keeps its wider radius. */
function unionArea(parts: GeoArea[]): GeoArea {
  const countries = new Set<string>();
  const regions = new Map<string, { key: string }>();
  const cities = new Map<string, GeoCity>();
  for (const part of parts) {
    for (const c of part.countries ?? []) countries.add(c);
    for (const r of part.regions ?? []) regions.set(r.key, r);
    for (const c of part.cities ?? []) {
      const prev = cities.get(c.key);
      if (!prev || radiusKm(c.radius, c.distance_unit) > radiusKm(prev.radius, prev.distance_unit)) {
        cities.set(c.key, c);
      }
    }
  }
  const out: GeoArea = {};
  if (countries.size) out.countries = [...countries];
  if (cities.size) out.cities = [...cities.values()];
  if (regions.size) out.regions = [...regions.values()];
  return out;
}

function selectionsToGeo(selections: LocationSelection[]): AdSetGeoLocations {
  const geo: AdSetGeoLocations = {};
  const excluded: GeoArea = {};
  for (const sel of selections) pushSelection(sel.mode === "include" ? geo : excluded, sel);
  if (excluded.countries?.length || excluded.cities?.length || excluded.regions?.length) {
    geo.excluded_geo_locations = excluded;
  }
  return geo;
}

/**
 * Convert a `LocationTargetingGroup` (UI model) into Meta's `geo_locations`
 * shape. Excluded countries and regions are emitted alongside excluded
 * cities — Meta's `excluded_geo_locations` accepts all three.
 */
export function groupToGeo(group: LocationTargetingGroup): AdSetGeoLocations {
  return selectionsToGeo(group.selections);
}

/**
 * One ad set's `geo_locations` from a set of campaign locations plus the
 * pooled exclusions applied to it. Includes are the union of every group's
 * includes; exclusions are the union of the groups' own exclusions (the
 * UK-excl-London preset) and the pooled ones.
 */
export function locationsToGeo(
  groups: LocationTargetingGroup[],
  exclusions: LocationSelection[] = [],
): AdSetGeoLocations {
  const includes: GeoArea[] = [];
  const excludes: GeoArea[] = [];
  for (const g of groups) {
    const geo = groupToGeo(g);
    const { excluded_geo_locations, ...include } = geo;
    includes.push(include);
    if (excluded_geo_locations) excludes.push(excluded_geo_locations);
  }
  const pooled: GeoArea = {};
  for (const sel of exclusions) pushSelection(pooled, sel);
  excludes.push(pooled);

  const geo: AdSetGeoLocations = unionArea(includes);
  const excluded = unionArea(excludes);
  if (excluded.countries || excluded.cities || excluded.regions) geo.excluded_geo_locations = excluded;
  return geo;
}

/**
 * The location ids an ad set targets: `locationGroupIds` when present,
 * otherwise the single legacy `locationGroupId`, otherwise `undefined`
 * (a row that only has the stamped `geoLocations` snapshot).
 */
export function adSetLocationGroupIds(adSet: AdSetSuggestion): string[] | undefined {
  if (adSet.locationGroupIds) return adSet.locationGroupIds;
  return adSet.locationGroupId ? [adSet.locationGroupId] : undefined;
}

function pick<T extends { id: string }>(ids: string[] | undefined, pool: T[] | undefined): T[] {
  if (!ids?.length || !pool?.length) return [];
  const byId = new Map(pool.map((x) => [x.id, x]));
  return ids.map((id) => byId.get(id)).filter((x): x is T => x !== undefined);
}

/**
 * Resolve the effective geo-targeting for an ad set at launch time.
 *
 * Precedence — the first rule that applies wins, nothing is blended:
 *   1. `adSet.locationGroupIds` is present (a multi-city ad set, including
 *      every row generated or edited since multi-city shipped): the targeting
 *      is exactly `locationsToGeo(those groups, pooled exclusions in
 *      adSet.excludedLocationIds)`, resolved FRESH against `locationGroups`
 *      and `excludedLocations`. Ids that no longer resolve are dropped. If
 *      none resolve the result is `{}` — never the stamped snapshot, never
 *      UK nationwide. `findAdSetLocationProblems` blocks that before launch
 *      and `buildMetaTargeting` refuses it if it gets that far.
 *   2. `adSet.locationGroupId` (a pre-multi-city row) resolves: that one
 *      group via `groupToGeo`, plus any pooled exclusions applied to the row.
 *   3. The stamped `adSet.geoLocations` snapshot — drafts from before
 *      `locationGroupId` existed, or a legacy FK pointing at a removed group.
 *   4. `undefined` — caller (`buildMetaTargeting`) defaults to
 *      `{ countries: ["GB"] }`. Only reachable by a legacy row that never had
 *      any location; a row the operator emptied is rule 1.
 */
export function resolveAdSetGeoLocations(
  adSet: AdSetSuggestion,
  locationGroups: LocationTargetingGroup[] | undefined,
  excludedLocations?: LocationSelection[],
): AdSetGeoLocations | undefined {
  const exclusions = pick(adSet.excludedLocationIds, excludedLocations);
  if (adSet.locationGroupIds) {
    const groups = pick(adSet.locationGroupIds, locationGroups);
    return groups.length ? locationsToGeo(groups, exclusions) : {};
  }
  if (adSet.locationGroupId) {
    const group = locationGroups?.find((g) => g.id === adSet.locationGroupId);
    if (group) return exclusions.length ? locationsToGeo([group], exclusions) : groupToGeo(group);
  }
  return adSet.geoLocations;
}

/** True when the resolved geo includes nothing — Meta has no area to deliver in. */
export function geoHasNoIncludedArea(geo: AdSetGeoLocations): boolean {
  return !geo.countries?.length && !geo.cities?.length && !geo.regions?.length;
}

/**
 * A group's tier: the tier its include selections share. The picker sets it
 * on all of a group's includes at once, so a mixed or absent tier reads as
 * untiered.
 */
export function groupTier(group: LocationTargetingGroup): LocationTier | undefined {
  const tiers = new Set(group.selections.filter((s) => s.mode === "include").map((s) => s.tier));
  if (tiers.size !== 1) return undefined;
  return [...tiers][0];
}

/** Set `tier` on every include selection of a group (undefined clears it). */
export function withGroupTier(group: LocationTargetingGroup, tier: LocationTier | undefined): LocationTargetingGroup {
  return {
    ...group,
    selections: group.selections.map((s) => (s.mode === "include" ? { ...s, tier } : s)),
  };
}

// ─── Preflight ──────────────────────────────────────────────────────────────

interface Place {
  kind: LocationSelection["locationType"];
  key: string;
  countryCode?: string;
  radiusKm: number;
  label: string;
}

/** Meta city key for London, England — known GB even on selections that predate `countryCode`. */
const LONDON_CITY_KEY = "2421178";

function selectionLabel(sel: LocationSelection): string {
  return sel.radius ? `${sel.label} +${sel.radius}${sel.distanceUnit === "mile" ? "mi" : "km"}` : sel.label;
}

function toPlace(sel: LocationSelection, label: string): Place | null {
  const key = sel.locationType === "country" ? sel.countryCode : sel.locationKey;
  if (!key) return null;
  return {
    kind: sel.locationType,
    key,
    countryCode:
      sel.locationType === "country"
        ? sel.countryCode
        : sel.countryCode ?? (sel.locationKey === LONDON_CITY_KEY ? "GB" : undefined),
    radiusKm: radiusKm(sel.radius, sel.distanceUnit),
    label,
  };
}

/**
 * Whether excluding `ex` removes all of `inc`. Decided only where the
 * selections themselves prove it: the same place with an exclusion radius at
 * least as wide, or an excluded country the include is known to sit in.
 * Two different cities are never judged — that needs coordinates this model
 * does not have.
 */
function covers(ex: Place, inc: Place): boolean {
  if (ex.kind === "country") return inc.kind === "country" ? inc.key === ex.key : inc.countryCode === ex.key;
  if (ex.kind !== inc.kind || ex.key !== inc.key) return false;
  return ex.kind !== "city" || ex.radiusKm >= inc.radiusKm;
}

/** Meta's documented per-ad-set location limits (business help 782267941863427). */
export const META_MAX_COUNTRIES_PER_AD_SET = 25;
export const META_MAX_CITIES_PER_AD_SET = 250;

type LocationSchedule = Pick<BudgetScheduleSettings, "locationGroups" | "excludedLocations"> | undefined;

interface AdSetPlaces {
  name: string;
  chosen: LocationTargetingGroup[];
  includes: Place[];
  excludes: Place[];
}

function adSetName(adSet: AdSetSuggestion, i: number): string {
  return `"${adSet.name?.trim() || `Ad Set #${i + 1}`}"`;
}

/** The included and excluded places an ad set's chosen locations add up to; `null` for a legacy row with no ids. */
function adSetPlaces(
  adSet: AdSetSuggestion,
  i: number,
  groups: LocationTargetingGroup[],
  pool: LocationSelection[],
): AdSetPlaces | null {
  const ids = adSetLocationGroupIds(adSet);
  if (ids === undefined) return null;
  const chosen = pick(ids, groups);
  const includes: Place[] = [];
  const excludes: Place[] = [];
  for (const g of chosen) {
    const incSels = g.selections.filter((s) => s.mode === "include");
    for (const sel of g.selections) {
      const label = sel.mode === "include" && incSels.length === 1 ? g.label : selectionLabel(sel);
      const place = toPlace(sel, label);
      if (place) (sel.mode === "include" ? includes : excludes).push(place);
    }
  }
  for (const sel of pick(adSet.excludedLocationIds, pool)) {
    const place = toPlace(sel, selectionLabel(sel));
    if (place) excludes.push(place);
  }
  return { name: adSetName(adSet, i), chosen, includes, excludes };
}

/**
 * Everything about an ad set's locations that Meta would reject or that
 * would launch somewhere the operator did not choose. Each message names the
 * ad set and both sides of the conflict. Blocks Step 5 `validateStep`.
 *
 *   - More countries or cities than Meta allows in one ad set, counted on
 *     the targeting actually sent (after duplicates merge).
 *   - Zero locations on a multi-city row (would otherwise fall back to UK).
 *     Legacy rows without `locationGroupIds` keep their snapshot / GB
 *     behaviour and are not reported for this.
 *   - Locations chosen but none of them includes anywhere.
 *   - An exclusion that removes an included location outright.
 */
export function findAdSetLocationProblems(adSets: AdSetSuggestion[], budgetSchedule: LocationSchedule): string[] {
  const groups = budgetSchedule?.locationGroups ?? [];
  const pool = budgetSchedule?.excludedLocations ?? [];
  const problems: string[] = [];

  adSets.forEach((adSet, i) => {
    const geo = resolveAdSetGeoLocations(adSet, groups, pool);
    const countries = geo?.countries?.length ?? 0;
    const cities = geo?.cities?.length ?? 0;
    if (countries > META_MAX_COUNTRIES_PER_AD_SET) {
      problems.push(
        `${adSetName(adSet, i)} targets ${countries} countries — Meta allows at most ${META_MAX_COUNTRIES_PER_AD_SET} per ad set. Split it, or remove some.`,
      );
    }
    if (cities > META_MAX_CITIES_PER_AD_SET) {
      problems.push(
        `${adSetName(adSet, i)} targets ${cities} cities — Meta allows at most ${META_MAX_CITIES_PER_AD_SET} per ad set. Split it, or remove some.`,
      );
    }

    const places = adSetPlaces(adSet, i, groups, pool);
    if (!places) return;
    const { name, chosen, includes, excludes } = places;
    if (chosen.length === 0) {
      if (adSet.locationGroupIds) problems.push(`${name} has no locations — pick at least one on its row.`);
      return;
    }

    if (includes.length === 0) {
      problems.push(
        `${name} targets ${chosen.map((g) => `"${g.label}"`).join(", ")}, which only exclude — add a location to include.`,
      );
      return;
    }

    const emptied = includes.filter((inc) => excludes.some((ex) => covers(ex, inc)));
    for (const inc of emptied) {
      const ex = excludes.find((e) => covers(e, inc))!;
      problems.push(
        emptied.length === includes.length
          ? `${name}: excluding "${ex.label}" removes its whole included area ("${inc.label}") — Meta rejects this. Remove the exclusion from this ad set or change its locations.`
          : `${name}: "${inc.label}" is included and excluded ("${ex.label}") — remove one.`,
      );
    }
  });

  return problems;
}

/**
 * Location shapes Meta accepts but that are probably not what the operator
 * meant. Shown on Step 5; never blocks.
 *
 *   - An included country that already contains another included location.
 *     Ads Manager supports this, so it warns only. Promote it to
 *     `findAdSetLocationProblems` only with a Meta error code from a real
 *     launch that rejected it.
 */
export function findAdSetLocationWarnings(adSets: AdSetSuggestion[], budgetSchedule: LocationSchedule): string[] {
  const groups = budgetSchedule?.locationGroups ?? [];
  const pool = budgetSchedule?.excludedLocations ?? [];
  const warnings: string[] = [];

  adSets.forEach((adSet, i) => {
    const places = adSetPlaces(adSet, i, groups, pool);
    if (!places) return;
    for (const country of places.includes.filter((p) => p.kind === "country")) {
      const inside = places.includes.find((p) => p.kind !== "country" && p.countryCode === country.key);
      if (inside) {
        warnings.push(
          `${places.name}: "${country.label}" already contains "${inside.label}", so "${inside.label}" adds no reach. Remove one, or Split by city to report them separately.`,
        );
      }
    }
  });

  return warnings;
}
