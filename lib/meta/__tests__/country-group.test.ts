import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AdSetSuggestion, AudienceSettings, BudgetScheduleSettings, LocationSelection, LocationTargetingGroup } from "../../types.ts";
import { buildAdSetPayload } from "../adset.ts";
import {
  EUROPE_EXCL_UK_PRESET,
  EUROPE_PRESET,
  locationSearchQuery,
  matchPresetLocation,
  parseLocationSearchHits,
  parseLocationSearchTypes,
  selectionFromGeoResult,
} from "../location-search.ts";
import {
  findAdSetLocationProblems,
  findAdSetLocationWarnings,
  geoHasNoIncludedArea,
  groupToGeo,
  withGroupTier,
} from "../location-targeting.ts";
import { generateSuggestions, geoFingerprint } from "../../wizard/generate-adset-suggestions.ts";

/**
 * Shape Meta's targeting-search docs describe for a country group.
 * Not a live `q=europe` response — this environment has no Meta token.
 * The key `europe` is the one the DHB capture already stores on two ad sets.
 */
const EUROPE_HIT = {
  key: "europe",
  name: "Europe",
  type: "country_group",
  country_codes: ["GB", "FR", "DE"],
};

const EEA_HIT = {
  key: "eea",
  name: "European Economic Area",
  type: "country_group",
  country_codes: ["FR", "DE"],
};

function group(id: string, selections: LocationSelection[]): LocationTargetingGroup {
  return { id, label: id, source: "manual", selections };
}

function selection(partial: Partial<LocationSelection> & Pick<LocationSelection, "id" | "locationType">): LocationSelection {
  return {
    source: "search",
    label: partial.id,
    mode: "include",
    ...partial,
  };
}

function adSet(name: string, locationGroupIds: string[]): AdSetSuggestion {
  return {
    id: "as1",
    name,
    sourceType: "interest_group",
    sourceId: "g1",
    sourceName: name,
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 10,
    advantagePlus: false,
    enabled: true,
    locationGroupIds,
  } as AdSetSuggestion;
}

const emptyAudiences = {
  interestGroups: [],
  customAudienceGroups: [],
  pageGroups: [],
  savedAudiences: { audienceIds: [] },
  selectedPagesLookalikeGroups: [],
} as unknown as AudienceSettings;

describe("location search asks Meta for country groups", () => {
  it("accepts country_group alone or with the other types", () => {
    assert.deepEqual(parseLocationSearchTypes("country_group"), ["country_group"]);
    assert.deepEqual(parseLocationSearchTypes("city,region,country,country_group"), [
      "city",
      "region",
      "country",
      "country_group",
    ]);
    assert.equal(parseLocationSearchTypes("zip"), null);
    assert.deepEqual(parseLocationSearchTypes(null), ["city", "region", "country"]);
  });

  it("sends q=europe as a country_group location_types array", () => {
    const query = locationSearchQuery("europe", ["country_group"]);
    assert.equal(query.type, "adgeolocation");
    assert.equal(query.q, "europe");
    assert.equal(query.location_types, '["country_group"]');
  });

  it("keeps the key and member codes on a country_group hit", () => {
    const [hit] = parseLocationSearchHits([EUROPE_HIT, { key: "1", name: "Nope", type: "zip" }]);
    assert.equal(hit?.key, "europe");
    assert.equal(hit?.type, "country_group");
    assert.deepEqual(hit?.country_codes, ["GB", "FR", "DE"]);
    const selection = selectionFromGeoResult(hit!);
    assert.equal(selection?.locationType, "country_group");
    assert.equal(selection?.locationKey, "europe");
    assert.equal(selection?.countryCode, undefined);
    assert.deepEqual(selection?.memberCountryCodes, ["GB", "FR", "DE"]);
  });
});

describe("country group presets resolve through search results", () => {
  it("does not store a group key on the preset", () => {
    assert.equal(JSON.stringify(EUROPE_PRESET).includes('"europe"'), false);
    assert.equal(JSON.stringify(EUROPE_EXCL_UK_PRESET).includes('"europe"'), false);
    assert.deepEqual(
      EUROPE_EXCL_UK_PRESET.steps.map((step) => ({ type: step.type, mode: step.mode, query: step.query })),
      [
        { type: "country_group", mode: "include", query: "Europe" },
        { type: "country", mode: "exclude", query: "United Kingdom" },
      ],
    );
  });

  it("picks the hit named Europe when eea is also returned, then excludes GB", () => {
    const include = matchPresetLocation(EUROPE_EXCL_UK_PRESET.steps[0]!, [EEA_HIT, EUROPE_HIT]);
    assert.equal(include?.key, "europe");
    assert.equal(include?.name, "Europe");
    const included = selectionFromGeoResult(include!, "include", undefined, undefined, "preset");
    const excluded = selectionFromGeoResult(
      { key: "GB", name: "United Kingdom", type: "country", country_code: "GB" },
      "exclude",
      undefined,
      undefined,
      "preset",
    );
    assert.equal(included?.locationType, "country_group");
    assert.equal(excluded?.locationType, "country");
    assert.equal(excluded?.countryCode, "GB");
    assert.equal(excluded?.mode, "exclude");
    const geo = groupToGeo(group("preset_europe_excl_uk", [included!, excluded!]));
    assert.deepEqual(geo.country_groups, ["europe"]);
    assert.equal(geo.countries, undefined);
    assert.deepEqual(geo.excluded_geo_locations?.countries, ["GB"]);
    assert.equal(geo.excluded_geo_locations?.country_groups, undefined);
  });
});

describe("country groups are written beside countries, cities, and regions", () => {
  const europe = selection({
    id: "eu",
    label: "Europe",
    locationType: "country_group",
    locationKey: "europe",
    memberCountryCodes: ["GB", "FR", "DE"],
  });
  const manchester = selection({
    id: "mcr",
    label: "Manchester",
    locationType: "city",
    locationKey: "222",
    radius: 30,
    distanceUnit: "kilometer",
    countryCode: "GB",
  });
  const france = selection({
    id: "fr",
    label: "France",
    locationType: "country",
    countryCode: "FR",
  });
  const scotland = selection({
    id: "scot",
    label: "Scotland",
    locationType: "region",
    locationKey: "3866",
    countryCode: "GB",
  });

  it("include writes geo_locations.country_groups and leaves the other lists", () => {
    const geo = groupToGeo(group("mixed", [europe, manchester, france, scotland]));
    assert.deepEqual(geo.country_groups, ["europe"]);
    assert.deepEqual(geo.countries, ["FR"]);
    assert.deepEqual(geo.cities, [{ key: "222", radius: 30, distance_unit: "kilometer" }]);
    assert.deepEqual(geo.regions, [{ key: "3866" }]);
    assert.equal(geoHasNoIncludedArea(geo), false);
  });

  it("exclude writes excluded_geo_locations.country_groups", () => {
    const geo = groupToGeo(group("ex", [france, { ...europe, mode: "exclude" }]));
    assert.deepEqual(geo.countries, ["FR"]);
    assert.deepEqual(geo.excluded_geo_locations?.country_groups, ["europe"]);
    assert.equal(geo.country_groups, undefined);
  });

  it("buildMetaTargeting sends the group and does not default the ad set to GB", () => {
    const located = group("eu", [europe]);
    const payload = buildAdSetPayload(
      adSet("Europe fans", ["eu"]),
      "cam",
      emptyAudiences,
      { locationGroups: [located] } as BudgetScheduleSettings,
      "link_clicks",
      "traffic",
    );
    assert.deepEqual(payload.targeting.geo_locations.country_groups, ["europe"]);
    assert.equal(payload.targeting.geo_locations.countries, undefined);
  });

  it("two groups that differ only by key do not share a fingerprint", () => {
    const africa = selection({
      id: "af",
      label: "Africa",
      locationType: "country_group",
      locationKey: "africa",
      memberCountryCodes: ["ZA"],
    });
    assert.notEqual(geoFingerprint(group("eu", [europe])), geoFingerprint(group("af", [africa])));
    assert.equal(
      geoFingerprint(group("eu", [europe])),
      geoFingerprint(group("eu-copy", [{ ...europe, memberCountryCodes: ["GB"] }])),
    );
  });
});

describe("preflight treats a country group like a containing country", () => {
  const europe = { ...group("eu", [
    selection({
      id: "eu",
      label: "Europe",
      locationType: "country_group",
      locationKey: "europe",
      memberCountryCodes: ["GB", "FR"],
    }),
  ]), label: "Europe" };
  const gb = { ...group("gb", [
    selection({ id: "gb", label: "United Kingdom", locationType: "country", countryCode: "GB" }),
  ]), label: "United Kingdom" };
  const exclUk = group("europe_excl_uk", [
    selection({
      id: "eu",
      label: "Europe",
      locationType: "country_group",
      locationKey: "europe",
      memberCountryCodes: ["GB", "FR"],
    }),
    selection({
      id: "gb",
      label: "United Kingdom",
      mode: "exclude",
      locationType: "country",
      countryCode: "GB",
    }),
  ]);

  it("flags GB included inside an included Europe group, and does not block it", () => {
    const rows = [adSet("Europe fans", ["eu", "gb"])];
    const schedule = { locationGroups: [europe, gb] };
    assert.deepEqual(findAdSetLocationProblems(rows, schedule), []);
    const warnings = findAdSetLocationWarnings(rows, schedule);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /"Europe" already contains "United Kingdom"/);
  });

  it("Europe excluding UK is not an overlap", () => {
    const rows = [adSet("Europe excl UK", ["europe_excl_uk"])];
    const schedule = { locationGroups: [exclUk] };
    assert.deepEqual(findAdSetLocationProblems(rows, schedule), []);
    assert.deepEqual(findAdSetLocationWarnings(rows, schedule), []);
  });

  it("an excluded Europe group that contains an included GB city is refused", () => {
    const city = {
      ...group("mcr", [
        selection({
          id: "mcr",
          label: "Manchester",
          locationType: "city",
          locationKey: "222",
          countryCode: "GB",
          radius: 40,
          distanceUnit: "kilometer",
        }),
      ]),
      label: "Manchester",
    };
    const exclusion: LocationSelection = {
      ...europe.selections[0]!,
      id: "ex_eu",
      mode: "exclude",
    };
    const rows = [adSet("Manchester", ["mcr"])];
    rows[0]!.excludedLocationIds = ["ex_eu"];
    const problems = findAdSetLocationProblems(rows, {
      locationGroups: [city],
      excludedLocations: [exclusion],
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /excluding "Europe"/);
    assert.match(problems[0]!, /Manchester/);
  });
});

describe("primary and secondary apply to a country group", () => {
  it("a Europe group tagged Primary is its own generate slice", () => {
    const europe = withGroupTier(
      group("eu", [
        selection({
          id: "eu",
          label: "Europe",
          locationType: "country_group",
          locationKey: "europe",
        }),
      ]),
      "primary",
    );
    const uk = withGroupTier(
      group("gb", [
        selection({ id: "gb", label: "United Kingdom", locationType: "country", countryCode: "GB" }),
      ]),
      "secondary",
    );
    const audiences = {
      pageGroups: [{ id: "pg1", name: "Pages", pageIds: ["p1"], lookalike: false }],
      customAudienceGroups: [],
      savedAudiences: { audienceIds: [] },
      interestGroups: [],
      selectedPagesLookalikeGroups: [],
    } as unknown as AudienceSettings;
    const rows = generateSuggestions(audiences, 100, [europe, uk], uk);
    assert.deepEqual(
      rows.map((row) => row.locationTier),
      ["primary", "secondary"],
    );
    assert.deepEqual(rows[0]?.locationGroupIds, ["eu"]);
    assert.deepEqual(rows[1]?.locationGroupIds, ["gb"]);
  });
});
