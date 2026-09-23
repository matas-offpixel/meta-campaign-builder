/**
 * Multi-city ad sets, tiers and the exclusion pool (Matas, 23 Sept): an ad
 * set targets a SET of campaign locations combined into one ad set, each
 * location carries a Primary / Secondary tag, and exclusions live in one
 * campaign pool applied to chosen ad sets.
 *
 * Run: node --test lib/wizard/__tests__/adset-multi-city.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { migrateDraft } from "../../autosave.ts";
import { buildAdSetPayload, buildMetaTargeting } from "../../meta/adset.ts";
import {
  META_MAX_CITIES_PER_AD_SET,
  META_MAX_COUNTRIES_PER_AD_SET,
  findAdSetLocationProblems,
  findAdSetLocationWarnings,
  groupToGeo,
  locationsToGeo,
  resolveAdSetGeoLocations,
  withGroupTier,
} from "../../meta/location-targeting.ts";
import { validateStep } from "../../validation.ts";
import {
  applyExclusionsToAdSets,
  applyLocationsToAdSets,
  locationIdsForQuickPick,
  locationOptions,
  setAdSetLocations,
  splitAdSetByLocation,
} from "../adset-suggestions.ts";
import { generateSuggestions, geoFingerprint } from "../generate-adset-suggestions.ts";
import type {
  AdSetSuggestion,
  AudienceSettings,
  BudgetScheduleSettings,
  CampaignDraft,
  LocationSelection,
  LocationTargetingGroup,
} from "../../types.ts";

function city(id: string, label: string, key: string, radius: number, countryCode?: string): LocationTargetingGroup {
  return {
    id,
    label,
    source: "manual",
    selections: [
      { id: `sel_${id}`, source: "search", label, mode: "include", locationType: "city", locationKey: key, radius, distanceUnit: "kilometer", countryCode },
    ],
  };
}

const NEWCASTLE = city("grp_newcastle", "Newcastle upon Tyne, England, United Kingdom (+200 km)", "111", 200, "GB");
const BELFAST = city("grp_belfast", "Belfast, Northern Ireland, United Kingdom (+40 km)", "222", 40, "GB");
const LONDON = city("grp_london", "London, England, United Kingdom (+40 km)", "2421178", 40);

const UK: LocationTargetingGroup = {
  id: "preset_gb_nationwide",
  label: "UK (nationwide)",
  source: "preset",
  selections: [{ id: "gb", source: "preset", label: "United Kingdom", mode: "include", locationType: "country", countryCode: "GB" }],
};

const UK_EXCL_LONDON: LocationTargetingGroup = {
  id: "preset_uk_excl_london",
  label: "UK excluding London +40 km",
  source: "preset",
  selections: [
    { id: "gb_inc", source: "preset", label: "United Kingdom", mode: "include", locationType: "country", countryCode: "GB" },
    { id: "ldn_exc", source: "preset", label: "London, England, United Kingdom", mode: "exclude", locationType: "city", locationKey: "2421178", radius: 40, distanceUnit: "kilometer" },
  ],
};

const EXCL_LONDON: LocationSelection = {
  id: "ex_london", source: "search", label: "London, England, United Kingdom", mode: "exclude", locationType: "city", locationKey: "2421178", radius: 40, distanceUnit: "kilometer", countryCode: "GB",
};
const EXCL_SCOTLAND: LocationSelection = {
  id: "ex_scotland", source: "search", label: "Scotland, United Kingdom", mode: "exclude", locationType: "region", locationKey: "3866", countryCode: "GB",
};
const EXCL_IRELAND: LocationSelection = {
  id: "ex_ie", source: "search", label: "Ireland", mode: "exclude", locationType: "country", countryCode: "IE",
};

const audiences = {
  pageGroups: [1, 2, 3, 4, 5].map((n) => ({ id: `pg${n}`, name: `Pages ${n}`, pageIds: [`p${n}`], lookalike: false })),
  customAudienceGroups: [],
  savedAudiences: { audienceIds: [] },
  interestGroups: [],
  selectedPagesLookalikeGroups: [],
} as unknown as AudienceSettings;

function row(overrides: Partial<AdSetSuggestion> = {}): AdSetSuggestion {
  return {
    id: "as1",
    name: "Pages 1",
    sourceType: "interest_group",
    sourceId: "g1",
    sourceName: "Pages 1",
    ageMin: 18,
    ageMax: 45,
    budgetPerDay: 20,
    advantagePlus: false,
    enabled: true,
    ...overrides,
  };
}

const emptyAudiences = {
  interestGroups: [], customAudienceGroups: [], pageGroups: [], savedAudiences: { audienceIds: [] }, selectedPagesLookalikeGroups: [],
} as unknown as AudienceSettings;

function draftWith(adSetSuggestions: AdSetSuggestion[], bs: Partial<BudgetScheduleSettings>): CampaignDraft {
  return migrateDraft({
    settings: { objective: "traffic", wizardMode: "new", campaignName: "Test campaign" },
    budgetSchedule: {
      budgetLevel: "ad_set", budgetType: "daily", budgetAmount: 100, currency: "GBP",
      startDate: "2026-10-01", endDate: "2026-10-10", timezone: "Europe/London", ...bs,
    },
    adSetSuggestions,
  });
}

describe("tiers", () => {
  it("a location tagged Primary in the picker is picked by All primary from a row", () => {
    const groups = [withGroupTier(NEWCASTLE, "primary"), withGroupTier(BELFAST, "secondary"), LONDON];
    const options = locationOptions(groups);
    assert.deepEqual(locationIdsForQuickPick(options, "primary"), ["grp_newcastle"]);
    assert.deepEqual(locationIdsForQuickPick(options, "secondary"), ["grp_belfast"]);
    assert.deepEqual(locationIdsForQuickPick(options, "all"), ["grp_newcastle", "grp_belfast", "grp_london"]);
    assert.deepEqual(locationIdsForQuickPick(options, "none"), []);
  });

  it("the tier is stored on the selection and does not change what is sent to Meta", () => {
    const tagged = withGroupTier(NEWCASTLE, "primary");
    assert.equal(tagged.selections[0].tier, "primary");
    assert.deepEqual(groupToGeo(tagged), groupToGeo(NEWCASTLE));
  });
});

describe("generate: cities combine into one ad set per audience", () => {
  const rows = generateSuggestions(audiences, 100, [NEWCASTLE, BELFAST], UK);

  it("five audiences × two cities → five ad sets, not ten", () => {
    assert.equal(rows.length, 5);
    for (const r of rows) assert.deepEqual(r.locationGroupIds, ["grp_newcastle", "grp_belfast"]);
  });

  it("each ad set sends both cities in geo_locations.cities", () => {
    for (const r of rows) {
      const t = buildMetaTargeting(r, emptyAudiences, [NEWCASTLE, BELFAST]);
      assert.deepEqual(t.geo_locations.cities?.map((c) => c.key), ["111", "222"]);
    }
    assert.deepEqual(locationsToGeo([NEWCASTLE, BELFAST]).cities?.map((c) => c.key), ["111", "222"]);
  });

  it("names stay the audience name and the budget is split five ways", () => {
    assert.deepEqual(rows.map((r) => r.name), ["Pages 1", "Pages 2", "Pages 3", "Pages 4", "Pages 5"]);
    assert.ok(rows.every((r) => r.budgetPerDay === 20));
  });

  it("two different single-city groups are not deduplicated as the same location", () => {
    assert.notEqual(geoFingerprint(NEWCASTLE), geoFingerprint(BELFAST));
    assert.equal(geoFingerprint(NEWCASTLE), geoFingerprint({ ...NEWCASTLE, id: "copy", label: "Newcastle again" }));
  });

  it("with no locations configured, rows keep the UK fallback snapshot and no ids", () => {
    const fallback = generateSuggestions(audiences, 100, [], UK);
    assert.equal(fallback.length, 5);
    assert.ok(fallback.every((r) => r.locationGroupIds === undefined && r.geoLocations?.countries?.[0] === "GB"));
  });
});

describe("Split by city", () => {
  const groups = [NEWCASTLE, BELFAST];
  const combined = setAdSetLocations(row({ excludedLocationIds: ["ex_london"] }), ["grp_newcastle", "grp_belfast"], groups);
  const other = row({ id: "as2", name: "Pages 2" });
  const split = splitAdSetByLocation([combined, other], "as1", groups, [EXCL_LONDON]);

  it("turns one row into two, each with one city, in place", () => {
    assert.equal(split.length, 3);
    assert.deepEqual(split.slice(0, 2).map((r) => r.locationGroupIds), [["grp_newcastle"], ["grp_belfast"]]);
    assert.equal(split[2].id, "as2");
  });

  it("names each for its city, keeps exclusions, and keeps the budget total", () => {
    assert.deepEqual(split.slice(0, 2).map((r) => r.name), ["Pages 1 — Newcastle upon Tyne +200km", "Pages 1 — Belfast +40km"]);
    assert.ok(split.slice(0, 2).every((r) => r.excludedLocationIds?.[0] === "ex_london"));
    assert.equal(split[0].budgetPerDay + split[1].budgetPerDay, 20);
    assert.equal(new Set(split.map((r) => r.id)).size, 3);
  });

  it("a one-city row is left alone", () => {
    const single = setAdSetLocations(row(), ["grp_newcastle"], groups);
    assert.deepEqual(splitAdSetByLocation([single], "as1", groups), [single]);
  });

  it("moving a split row to another city renames it — no stale city in the name", () => {
    const moved = setAdSetLocations(split[0], ["grp_belfast"], groups);
    assert.equal(moved.name, "Pages 1 — Belfast +40km");
    const recombined = setAdSetLocations(split[0], ["grp_newcastle", "grp_belfast"], groups);
    assert.equal(recombined.name, "Pages 1");
  });
});

describe("zero locations is a blocker, never UK nationwide", () => {
  const emptied = setAdSetLocations(row({ name: "Headline fans" }), [], [NEWCASTLE]);

  it("validateStep blocks Step 5 and names the ad set", () => {
    const result = validateStep(5, draftWith([emptied], { locationGroups: [NEWCASTLE] }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('"Headline fans"') && e.includes("no locations")), result.errors.join("\n"));
  });

  it("an ad set whose only location was removed from the campaign is blocked too", () => {
    const orphan = setAdSetLocations(row({ name: "Belfast only" }), ["grp_belfast"], [NEWCASTLE, BELFAST]);
    const problems = findAdSetLocationProblems([orphan], { locationGroups: [NEWCASTLE] });
    assert.ok(problems[0]?.includes('"Belfast only" has no locations'));
  });

  it("buildMetaTargeting refuses it rather than defaulting to GB", () => {
    assert.throws(() => buildMetaTargeting(emptied, emptyAudiences, [NEWCASTLE]), /no included locations/);
  });

  it("disabled ad sets do not block", () => {
    const result = validateStep(5, draftWith([{ ...emptied, enabled: false }], { locationGroups: [NEWCASTLE] }));
    assert.equal(result.valid, true, result.errors.join("\n"));
  });
});

describe("exclusion pool", () => {
  const groups = [NEWCASTLE, BELFAST];
  const pool = [EXCL_LONDON, EXCL_SCOTLAND, EXCL_IRELAND];
  const rows = generateSuggestions(audiences, 100, groups, UK);
  const applied = applyExclusionsToAdSets(rows, [rows[1].id, rows[3].id], ["ex_london"], groups, pool);

  it("a pooled exclusion applied to two of five ad sets reaches exactly those two", () => {
    const excludedKeys = applied.map((r) =>
      buildMetaTargeting(r, emptyAudiences, groups, pool).excluded_geo_locations?.cities?.map((c) => c.key) ?? [],
    );
    assert.deepEqual(excludedKeys, [[], ["2421178"], [], ["2421178"], []]);
  });

  it("excluded regions and countries are honoured, not dropped", () => {
    const r = applyExclusionsToAdSets([rows[0]], [rows[0].id], ["ex_scotland", "ex_ie"], groups, pool)[0];
    const geo = resolveAdSetGeoLocations(r, groups, pool);
    assert.deepEqual(geo?.excluded_geo_locations?.regions, [{ key: "3866" }]);
    assert.deepEqual(geo?.excluded_geo_locations?.countries, ["IE"]);
    const t = buildMetaTargeting(r, emptyAudiences, groups, pool);
    assert.deepEqual(t.excluded_geo_locations?.countries, ["IE"]);
  });

  it("groupToGeo honours an excluded region or country inside a group", () => {
    const g: LocationTargetingGroup = { ...UK, id: "g", selections: [...UK.selections, EXCL_SCOTLAND] };
    assert.deepEqual(groupToGeo(g).excluded_geo_locations, { regions: [{ key: "3866" }] });
  });

  it("bulk-applying cities replaces them on the chosen rows only", () => {
    const next = applyLocationsToAdSets(rows, [rows[0].id], ["grp_belfast"], groups);
    assert.deepEqual(next[0].locationGroupIds, ["grp_belfast"]);
    assert.deepEqual(next[1].locationGroupIds, ["grp_newcastle", "grp_belfast"]);
  });
});

describe("preflight: an exclusion that empties the included area", () => {
  it("is refused, naming the include and the exclude", () => {
    const londonOnly = applyExclusionsToAdSets(
      [setAdSetLocations(row({ name: "London fans" }), ["grp_london"], [LONDON])],
      ["as1"], ["ex_london"], [LONDON], [EXCL_LONDON],
    );
    const problems = findAdSetLocationProblems(londonOnly, { locationGroups: [LONDON], excludedLocations: [EXCL_LONDON] });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /"London fans"/);
    assert.match(problems[0], /excluding "London, England, United Kingdom \+40km"/);
    assert.match(problems[0], /"London, England, United Kingdom \(\+40 km\)"/);
    assert.match(problems[0], /whole included area/);
  });

  it("an excluded country containing every included city is refused", () => {
    const gb: LocationSelection = { id: "ex_gb", source: "search", label: "United Kingdom", mode: "exclude", locationType: "country", countryCode: "GB" };
    const r = applyExclusionsToAdSets([setAdSetLocations(row(), ["grp_newcastle", "grp_belfast"], [NEWCASTLE, BELFAST])], ["as1"], ["ex_gb"], [NEWCASTLE, BELFAST], [gb]);
    const problems = findAdSetLocationProblems(r, { locationGroups: [NEWCASTLE, BELFAST], excludedLocations: [gb] });
    assert.equal(problems.length, 2);
    assert.ok(problems.every((p) => p.includes("whole included area")));
  });

  it("a doughnut (smaller exclusion radius on the same city) is allowed", () => {
    const inner: LocationSelection = { ...EXCL_LONDON, id: "ex_inner", radius: 10 };
    const r = applyExclusionsToAdSets([setAdSetLocations(row(), ["grp_london"], [LONDON])], ["as1"], ["ex_inner"], [LONDON], [inner]);
    assert.deepEqual(findAdSetLocationProblems(r, { locationGroups: [LONDON], excludedLocations: [inner] }), []);
  });

  it("UK excl London on its own is fine; combined with London +40km it names the overlap", () => {
    assert.deepEqual(findAdSetLocationProblems([row({ locationGroupIds: [UK_EXCL_LONDON.id] })], { locationGroups: [UK_EXCL_LONDON] }), []);
    const both = findAdSetLocationProblems(
      [row({ name: "Mixed", locationGroupIds: [UK_EXCL_LONDON.id, LONDON.id] })],
      { locationGroups: [UK_EXCL_LONDON, LONDON] },
    );
    assert.ok(both.some((p) => p.includes('"London, England, United Kingdom (+40 km)" is included and excluded')), both.join("\n"));
  });

  it("an included country that already contains an included city is a warning, not a blocker", () => {
    const broad = [row({ name: "Broad", locationGroupIds: [UK.id, NEWCASTLE.id] })];
    const schedule = { locationGroups: [UK, NEWCASTLE] };
    assert.deepEqual(findAdSetLocationProblems(broad, schedule), []);
    const warnings = findAdSetLocationWarnings(broad, schedule);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /"Broad"/);
    assert.match(warnings[0], /"UK \(nationwide\)" already contains "Newcastle upon Tyne/);

    const result = validateStep(5, draftWith(broad, schedule));
    assert.equal(result.valid, true, result.errors.join("\n"));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, warnings);
    const review = validateStep(7, draftWith(broad, schedule));
    assert.ok(!review.errors.some((e) => e.includes("already contains")), review.errors.join("\n"));
    assert.deepEqual(review.warnings, warnings);
  });

  it("blocks the launch gate: Review (step 7) carries the same problem, before any Meta call", () => {
    const londonOnly = applyExclusionsToAdSets(
      [setAdSetLocations(row({ name: "London fans" }), ["grp_london"], [LONDON])],
      ["as1"], ["ex_london"], [LONDON], [EXCL_LONDON],
    );
    const review = validateStep(7, draftWith(londonOnly, { locationGroups: [LONDON], excludedLocations: [EXCL_LONDON] }));
    assert.ok(review.errors.some((e) => e.includes('"London fans"') && e.includes("whole included area")), review.errors.join("\n"));
  });
});

describe("Meta's per-ad-set location caps block Step 5", () => {
  function manyCities(n: number, id = "grp_many", keyPrefix = "c"): LocationTargetingGroup {
    return {
      id,
      label: `${n} cities`,
      source: "manual",
      selections: Array.from({ length: n }, (_, i) => ({
        id: `${id}_${i}`, source: "search" as const, label: `City ${i}`, mode: "include" as const,
        locationType: "city" as const, locationKey: `${keyPrefix}${i}`, radius: 10, distanceUnit: "kilometer" as const, countryCode: "GB",
      })),
    };
  }
  function manyCountries(n: number): LocationTargetingGroup {
    return {
      id: "grp_countries",
      label: `${n} countries`,
      source: "manual",
      selections: Array.from({ length: n }, (_, i) => ({
        id: `cc_${i}`, source: "search" as const, label: `Country ${i}`, mode: "include" as const,
        locationType: "country" as const, countryCode: `C${i}`,
      })),
    };
  }
  function check(groups: LocationTargetingGroup[]) {
    const rows = [row({ name: "Everywhere", locationGroupIds: groups.map((g) => g.id) })];
    return validateStep(5, draftWith(rows, { locationGroups: groups }));
  }

  it("the limits are Meta's documented 250 cities and 25 countries", () => {
    assert.equal(META_MAX_CITIES_PER_AD_SET, 250);
    assert.equal(META_MAX_COUNTRIES_PER_AD_SET, 25);
  });

  it("251 cities blocks, naming the ad set, the count and the limit; 250 passes", () => {
    const over = check([manyCities(251)]);
    assert.equal(over.valid, false);
    assert.ok(
      over.errors.some((e) => e.includes('"Everywhere"') && e.includes("251 cities") && e.includes("at most 250")),
      over.errors.join("\n"),
    );
    const atLimit = check([manyCities(250)]);
    assert.equal(atLimit.valid, true, atLimit.errors.join("\n"));
  });

  it("26 countries blocks, naming the ad set, the count and the limit; 25 passes", () => {
    const over = check([manyCountries(26)]);
    assert.equal(over.valid, false);
    assert.ok(
      over.errors.some((e) => e.includes('"Everywhere"') && e.includes("26 countries") && e.includes("at most 25")),
      over.errors.join("\n"),
    );
    const atLimit = check([manyCountries(25)]);
    assert.equal(atLimit.valid, true, atLimit.errors.join("\n"));
  });

  it("counts what is sent to Meta: a city in two chosen locations counts once", () => {
    assert.equal(check([manyCities(250), manyCities(1, "grp_repeat")]).valid, true);
  });

  it("bulk Apply to crosses the cap on every ad set it reaches, and each is named", () => {
    const groups = [manyCities(200, "grp_a", "a"), manyCities(60, "grp_b", "b")];
    const rows = applyLocationsToAdSets(
      [row({ id: "r1", name: "One" }), row({ id: "r2", name: "Two" })],
      ["r1", "r2"], ["grp_a", "grp_b"], groups,
    );
    const problems = findAdSetLocationProblems(rows, { locationGroups: groups });
    assert.equal(problems.length, 2);
    assert.match(problems[0], /"One" targets 260 cities/);
    assert.match(problems[1], /"Two" targets 260 cities/);
  });
});

describe("REGRESSION: a draft persisted in the old one-group shape", () => {
  const schedule = { locationGroups: [NEWCASTLE, UK_EXCL_LONDON] };
  const oldRows: AdSetSuggestion[] = [
    row({ id: "a", name: "Pages — Newcastle", locationGroupId: NEWCASTLE.id, locationLabel: NEWCASTLE.label, geoLocations: groupToGeo(NEWCASTLE) }),
    row({ id: "b", name: "Pages — UK excl", locationGroupId: UK_EXCL_LONDON.id, locationLabel: UK_EXCL_LONDON.label, geoLocations: groupToGeo(UK_EXCL_LONDON) }),
    row({ id: "c", name: "Dangling", locationGroupId: "grp_gone", geoLocations: { cities: [{ key: "999", radius: 20, distance_unit: "mile" }] } }),
    row({ id: "d", name: "Pre-#118", geoLocations: { countries: ["GB"] }, locationLabel: "UK" }),
    row({ id: "e", name: "Nothing at all" }),
  ];
  const before = oldRows.map((r) => resolveAdSetGeoLocations(r, schedule.locationGroups));
  const loaded = draftWith(oldRows, schedule);
  const bs = loaded.budgetSchedule;

  it("loads, and every row resolves to the geo it resolved to before", () => {
    const after = loaded.adSetSuggestions.map((r) => resolveAdSetGeoLocations(r, bs.locationGroups, bs.excludedLocations));
    assert.deepEqual(after, before);
  });

  it("only rows whose group still exists gain locationGroupIds; the rest are untouched", () => {
    assert.deepEqual(loaded.adSetSuggestions.map((r) => r.locationGroupIds), [["grp_newcastle"], ["preset_uk_excl_london"], undefined, undefined, undefined]);
    assert.deepEqual(loaded.adSetSuggestions.map((r) => r.name), oldRows.map((r) => r.name));
  });

  it("launches the same targeting payload as before, and validates", () => {
    for (const [i, r] of loaded.adSetSuggestions.entries()) {
      const oldPayload = buildAdSetPayload(oldRows[i], "cam", emptyAudiences, schedule as BudgetScheduleSettings, "link_clicks", "traffic");
      const newPayload = buildAdSetPayload(r, "cam", emptyAudiences, bs, "link_clicks", "traffic");
      assert.deepEqual(newPayload.targeting, oldPayload.targeting, `row ${r.id}`);
    }
    assert.deepEqual(validateStep(5, loaded).errors, []);
  });

  it("an old exclusion-only group moves to the pool; its ad sets are named as having no locations", () => {
    const exclOnly: LocationTargetingGroup = { id: "manual_excl", label: "London (+40 km)", source: "manual", selections: [EXCL_LONDON] };
    const d = draftWith(
      [row({ name: "Excl only", locationGroupId: "manual_excl", geoLocations: groupToGeo(exclOnly) }), row({ id: "z", locationGroupId: NEWCASTLE.id })],
      { locationGroups: [NEWCASTLE, exclOnly] },
    );
    assert.deepEqual(d.budgetSchedule.locationGroups?.map((g) => g.id), ["grp_newcastle"]);
    assert.deepEqual(d.budgetSchedule.excludedLocations?.map((e) => e.id), ["ex_london"]);
    assert.deepEqual(d.adSetSuggestions[0].locationGroupIds, []);
    assert.deepEqual(d.adSetSuggestions[0].excludedLocationIds, ["ex_london"]);
    const errors = validateStep(5, d).errors;
    assert.ok(errors.some((e) => e.includes('"Excl only" has no locations')), errors.join("\n"));
  });

  it("migrating twice changes nothing", () => {
    const twice = migrateDraft(JSON.parse(JSON.stringify(loaded)));
    assert.deepEqual(twice.adSetSuggestions, loaded.adSetSuggestions);
    assert.deepEqual(twice.budgetSchedule, loaded.budgetSchedule);
  });
});
