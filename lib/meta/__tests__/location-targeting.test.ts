/**
 * Tests for lib/meta/location-targeting.ts (task #118, multi-location per
 * campaign) — the pure LocationTargetingGroup → Meta geo_locations
 * conversion, and resolving a per-ad-set `locationGroupId` FK fresh at
 * launch time.
 *
 * Run: node --test lib/meta/__tests__/location-targeting.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { groupToGeo, resolveAdSetGeoLocations } from "../location-targeting.ts";
import { buildAdSetPayload } from "../adset.ts";
import type {
  AdSetSuggestion,
  AudienceSettings,
  BudgetScheduleSettings,
  LocationTargetingGroup,
} from "../../types.ts";

const NEWCASTLE: LocationTargetingGroup = {
  id: "grp_newcastle",
  label: "Newcastle +40km",
  source: "manual",
  selections: [
    { id: "sel1", source: "search", label: "Newcastle", mode: "include", locationType: "city", locationKey: "111", radius: 40, distanceUnit: "kilometer" },
  ],
};

const MANCHESTER: LocationTargetingGroup = {
  id: "grp_manchester",
  label: "Manchester +30km",
  source: "manual",
  selections: [
    { id: "sel2", source: "search", label: "Manchester", mode: "include", locationType: "city", locationKey: "222", radius: 30, distanceUnit: "kilometer" },
  ],
};

describe("groupToGeo", () => {
  it("converts an include-city selection to cities[]", () => {
    const geo = groupToGeo(NEWCASTLE);
    assert.deepEqual(geo.cities, [{ key: "111", radius: 40, distance_unit: "kilometer" }]);
  });

  it("converts an include-country selection to countries[]", () => {
    const uk: LocationTargetingGroup = {
      id: "gb",
      label: "UK",
      source: "preset",
      selections: [{ id: "s1", source: "preset", label: "United Kingdom", mode: "include", locationType: "country", countryCode: "GB" }],
    };
    assert.deepEqual(groupToGeo(uk).countries, ["GB"]);
  });

  it("moves exclude-city selections into excluded_geo_locations", () => {
    const uk: LocationTargetingGroup = {
      id: "gb_excl_london",
      label: "UK excl London",
      source: "preset",
      selections: [
        { id: "s1", source: "preset", label: "United Kingdom", mode: "include", locationType: "country", countryCode: "GB" },
        { id: "s2", source: "preset", label: "London", mode: "exclude", locationType: "city", locationKey: "2421178", radius: 40, distanceUnit: "kilometer" },
      ],
    };
    const geo = groupToGeo(uk);
    assert.deepEqual(geo.countries, ["GB"]);
    assert.deepEqual(geo.excluded_geo_locations?.cities, [{ key: "2421178", radius: 40, distance_unit: "kilometer" }]);
  });
});

describe("resolveAdSetGeoLocations", () => {
  const adSetWithFk: AdSetSuggestion = {
    id: "s1",
    name: "Test",
    sourceType: "interest_group",
    sourceId: "g1",
    sourceName: "Test",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 10,
    advantagePlus: false,
    enabled: true,
    locationGroupId: "grp_manchester",
    // Stale snapshot on purpose — proves the FK wins when the group resolves.
    geoLocations: { countries: ["GB"] },
  };

  it("prefers a fresh lookup via locationGroupId over the stamped geoLocations snapshot", () => {
    const geo = resolveAdSetGeoLocations(adSetWithFk, [NEWCASTLE, MANCHESTER]);
    assert.deepEqual(geo, groupToGeo(MANCHESTER));
  });

  it("falls back to the stamped geoLocations snapshot when the FK's group no longer exists", () => {
    const geo = resolveAdSetGeoLocations(adSetWithFk, [NEWCASTLE]);
    assert.deepEqual(geo, { countries: ["GB"] });
  });

  it("BACKWARD COMPAT: falls back to the stamped geoLocations snapshot when locationGroupId is absent", () => {
    const { locationGroupId, ...withoutFk } = adSetWithFk;
    void locationGroupId;
    const geo = resolveAdSetGeoLocations(withoutFk, [NEWCASTLE, MANCHESTER]);
    assert.deepEqual(geo, { countries: ["GB"] });
  });

  it("returns undefined when neither locationGroupId nor geoLocations is set", () => {
    const bare: AdSetSuggestion = { ...adSetWithFk, locationGroupId: undefined, geoLocations: undefined };
    assert.equal(resolveAdSetGeoLocations(bare, [NEWCASTLE, MANCHESTER]), undefined);
  });
});

// ─── Integration: buildAdSetPayload resolves per-ad-set location fresh ──────

const emptyAudiences: AudienceSettings = {
  interestGroups: [],
  customAudienceGroups: [],
  pageGroups: [],
  savedAudiences: { audienceIds: [] },
  selectedPagesLookalikeGroups: [],
} as unknown as AudienceSettings;

function makeAdSet(overrides: Partial<AdSetSuggestion> = {}): AdSetSuggestion {
  return {
    id: "s1",
    name: "Test Ad Set",
    sourceType: "interest_group",
    sourceId: "g1",
    sourceName: "Test",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 10,
    advantagePlus: false,
    enabled: true,
    ...overrides,
  } as AdSetSuggestion;
}

describe("buildAdSetPayload — per-ad-set location (task #118)", () => {
  const schedule: BudgetScheduleSettings = {
    startDate: "",
    endDate: "",
    locationGroups: [NEWCASTLE, MANCHESTER],
  } as unknown as BudgetScheduleSettings;

  it("two ad sets with different locationGroupId send different geo_locations", () => {
    const p1 = buildAdSetPayload(
      makeAdSet({ id: "s1", locationGroupId: "grp_newcastle" }),
      "cam", emptyAudiences, schedule, "link_clicks", "traffic",
    );
    const p2 = buildAdSetPayload(
      makeAdSet({ id: "s2", locationGroupId: "grp_manchester" }),
      "cam", emptyAudiences, schedule, "link_clicks", "traffic",
    );
    assert.deepEqual(p1.targeting.geo_locations?.cities, groupToGeo(NEWCASTLE).cities);
    assert.deepEqual(p2.targeting.geo_locations?.cities, groupToGeo(MANCHESTER).cities);
    assert.notDeepEqual(p1.targeting.geo_locations?.cities, p2.targeting.geo_locations?.cities);
  });

  it("BACKWARD COMPAT: a draft with no locationGroups at all still uses the stamped geoLocations snapshot", () => {
    const oldSchedule: BudgetScheduleSettings = { startDate: "", endDate: "" } as unknown as BudgetScheduleSettings;
    const payload = buildAdSetPayload(
      makeAdSet({ geoLocations: { cities: [{ key: "999", radius: 20, distance_unit: "mile" }] } }),
      "cam", emptyAudiences, oldSchedule, "link_clicks", "traffic",
    );
    assert.deepEqual(payload.targeting.geo_locations, {
      countries: undefined,
      cities: [{ key: "999", radius: 20, distance_unit: "mile" }],
      regions: undefined,
    });
  });
});
