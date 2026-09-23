/**
 * Step 5 ad-set row: the name input and the location control share one row.
 * Matas, 23 Sept — on a 2-location campaign the full Meta label
 * ("Newcastle upon Tyne, England, United Kingdom (+200 km)") took the line and
 * the name input collapsed to "Newcast", and the same label was also written
 * into the name.
 *
 * Run: node --test lib/wizard/__tests__/adset-row-location-label.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ADSET_ROW_LOCATION_CONTROL_CLASS,
  ADSET_ROW_MAIN_CLASS,
  ADSET_ROW_NAME_COLUMN_CLASS,
  ADSET_ROW_NAME_INPUT_CLASS,
  adSetExclusionSummary,
  adSetLocationSummary,
  setAdSetLocations,
  shortLocationLabel,
  stampLocations,
} from "../adset-suggestions.ts";
import type { AdSetSuggestion, LocationSelection, LocationTargetingGroup } from "../../types.ts";

const NEWCASTLE_LABEL = "Newcastle upon Tyne, England, United Kingdom (+200 km)";

function group(id: string, label: string, key: string, radius = 40): LocationTargetingGroup {
  return {
    id,
    label,
    source: "manual",
    selections: [
      { id: `sel_${id}`, source: "search", label, mode: "include", locationType: "city", locationKey: key, radius, distanceUnit: "kilometer" },
    ],
  };
}

const NEWCASTLE = group("grp_newcastle", NEWCASTLE_LABEL, "111", 200);
const BELFAST = group("grp_belfast", "Belfast, Northern Ireland, United Kingdom (+40 km)", "222");
const LONDON = group("grp_london", "London +40km", "2421178");
const GROUPS = [NEWCASTLE, BELFAST, LONDON];

const base: Omit<AdSetSuggestion, "geoLocations" | "locationLabel"> = {
  id: "as_pg_1",
  name: "Similar Pages",
  sourceType: "page_group",
  sourceId: "pg1",
  sourceName: "Similar Pages (5 pages)",
  ageMin: 18,
  ageMax: 45,
  budgetPerDay: 10,
  advantagePlus: false,
  enabled: true,
};

/** Tailwind `min-w-[Nrem]` → N, or null when the class list sets no rem minimum. */
function minWidthRem(classes: string): number | null {
  const m = /(?:^|\s)min-w-\[(\d+(?:\.\d+)?)rem\](?:\s|$)/.exec(classes);
  return m ? Number(m[1]) : null;
}

function tokens(classes: string): string[] {
  return classes.split(/\s+/).filter(Boolean);
}

describe("shortLocationLabel", () => {
  it("drops region and country and keeps the radius", () => {
    assert.equal(shortLocationLabel(NEWCASTLE_LABEL), "Newcastle upon Tyne +200km");
    assert.equal(shortLocationLabel("Belfast, Northern Ireland, United Kingdom (+40 km)"), "Belfast +40km");
  });

  it("reads preset labels in either stored form", () => {
    assert.equal(shortLocationLabel("London, England +40 km"), "London +40km");
    assert.equal(shortLocationLabel("London +40km"), "London +40km");
    assert.equal(shortLocationLabel("UK excluding London +40 km"), "UK excluding London +40km");
    assert.equal(shortLocationLabel("UK (nationwide)"), "UK (nationwide)");
  });
});

describe("row layout: a 60-character location label cannot squeeze the name", () => {
  it("the name input has a usable minimum width and no pseudo-truncate", () => {
    const min = minWidthRem(ADSET_ROW_NAME_INPUT_CLASS);
    assert.ok(min !== null && min >= 8, `name input min width ${min}rem`);
    assert.ok(!tokens(ADSET_ROW_NAME_INPUT_CLASS).includes("min-w-0"));
    assert.ok(!tokens(ADSET_ROW_NAME_INPUT_CLASS).includes("truncate"), "text-overflow does nothing on an <input>");
  });

  it("the name column holds its minimum and the controls wrap under it instead", () => {
    const min = minWidthRem(ADSET_ROW_NAME_COLUMN_CLASS);
    assert.ok(min !== null && min >= 12, `name column min width ${min}rem`);
    assert.ok(tokens(ADSET_ROW_MAIN_CLASS).includes("flex-wrap"));
  });

  it("the location control is capped and can shrink", () => {
    const t = tokens(ADSET_ROW_LOCATION_CONTROL_CLASS);
    assert.ok(t.includes("min-w-0"));
    assert.ok(t.some((c) => c.startsWith("max-w-")));
    assert.ok(!t.includes("shrink-0"));
  });
});

describe("closed control summary survives a long list", () => {
  it("one location reads as its short label, the full label in the tooltip", () => {
    const r = setAdSetLocations(base as AdSetSuggestion, ["grp_newcastle"], GROUPS);
    const s = adSetLocationSummary(r, GROUPS);
    assert.equal(s.text, "Newcastle upon Tyne +200km");
    assert.equal(s.title, NEWCASTLE_LABEL);
    assert.ok(NEWCASTLE_LABEL.length >= 50 && s.text.length < 30);
  });

  it("three cities read as a count, names in the tooltip — not three chips", () => {
    const r = setAdSetLocations(base as AdSetSuggestion, GROUPS.map((g) => g.id), GROUPS);
    const s = adSetLocationSummary(r, GROUPS);
    assert.equal(s.text, "3 cities");
    assert.deepEqual(s.title.split("\n"), GROUPS.map((g) => g.label));
  });

  it("an emptied row says so", () => {
    const r = setAdSetLocations(base as AdSetSuggestion, [], GROUPS);
    assert.deepEqual(adSetLocationSummary(r, GROUPS).empty, true);
  });

  it("exclusions summarise the same way", () => {
    const ex: LocationSelection = { id: "x", source: "search", label: "London, England, United Kingdom", mode: "exclude", locationType: "city", locationKey: "2421178", radius: 40, distanceUnit: "kilometer" };
    assert.equal(adSetExclusionSummary(base as AdSetSuggestion, [ex]).text, "Excl: none");
    assert.equal(adSetExclusionSummary({ ...(base as AdSetSuggestion), excludedLocationIds: ["x"] }, [ex]).text, "Excl: London +40km");
  });
});

describe("names carry no stale location", () => {
  it("generated rows are named for the audience", () => {
    assert.equal(stampLocations(base, [NEWCASTLE, BELFAST], { configured: true }).name, "Similar Pages");
    assert.equal(stampLocations(base, [LONDON], { configured: true }).name, "Similar Pages");
  });

  it("a legacy name with the old full-label suffix loses it when the row moves", () => {
    const legacy: AdSetSuggestion = {
      ...(base as AdSetSuggestion),
      name: "Similar Pages — London +40km",
      locationGroupId: LONDON.id,
      locationLabel: LONDON.label,
    };
    const toTwo = setAdSetLocations(legacy, ["grp_newcastle", "grp_belfast"], GROUPS);
    assert.equal(toTwo.name, "Similar Pages");
    const toOne = setAdSetLocations(legacy, ["grp_belfast"], GROUPS);
    assert.equal(toOne.name, "Similar Pages — Belfast +40km");
    assert.ok(!toOne.name.includes("London"));
    assert.equal(toOne.locationGroupId, undefined, "the superseded FK can't disagree with the ids");
  });

  it("a long location still fits the 40-character name cap by shortening the audience name", () => {
    const legacy: AdSetSuggestion = { ...(base as AdSetSuggestion), name: "Similar Pages — London +40km", locationLabel: LONDON.label };
    const r = setAdSetLocations(legacy, ["grp_newcastle"], GROUPS);
    assert.ok(r.name.length <= 40);
    assert.ok(r.name.endsWith(" — Newcastle upon Tyne +200km"));
  });

  it("an operator-typed name is left alone", () => {
    const r = setAdSetLocations({ ...(base as AdSetSuggestion), name: "Headline — fans" }, ["grp_belfast"], GROUPS);
    assert.equal(r.name, "Headline — fans");
  });
});
