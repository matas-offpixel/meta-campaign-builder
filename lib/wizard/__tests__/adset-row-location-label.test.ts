/**
 * Step 5 ad-set row: the name input and the location badge share one line.
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
  ADSET_ROW_LOCATION_BADGE_CLASS,
  ADSET_ROW_MAIN_CLASS,
  ADSET_ROW_NAME_COLUMN_CLASS,
  ADSET_ROW_NAME_INPUT_CLASS,
  reassignAdSetLocationGroup,
  shortLocationLabel,
  stampLocationGroup,
} from "../adset-suggestions.ts";
import type { AdSetSuggestion, LocationTargetingGroup } from "../../types.ts";

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

  it("is shorter than the stored label it came from", () => {
    assert.ok(shortLocationLabel(NEWCASTLE_LABEL).length < NEWCASTLE_LABEL.length);
  });
});

describe("row layout: a 60-character location label cannot squeeze the name", () => {
  it("uses a label of at least 60 characters for the check", () => {
    const long = `${NEWCASTLE_LABEL} extra`;
    assert.ok(long.length >= 60);
    assert.ok(shortLocationLabel(long).length < 30);
  });

  it("the name input has a usable minimum width and no pseudo-truncate", () => {
    const min = minWidthRem(ADSET_ROW_NAME_INPUT_CLASS);
    assert.ok(min !== null && min >= 8, `name input min width ${min}rem`);
    assert.ok(!tokens(ADSET_ROW_NAME_INPUT_CLASS).includes("min-w-0"));
    assert.ok(
      !tokens(ADSET_ROW_NAME_INPUT_CLASS).includes("truncate"),
      "text-overflow does nothing on an <input>",
    );
  });

  it("the name column holds its minimum and the controls wrap under it instead", () => {
    const min = minWidthRem(ADSET_ROW_NAME_COLUMN_CLASS);
    assert.ok(min !== null && min >= 12, `name column min width ${min}rem`);
    assert.ok(tokens(ADSET_ROW_MAIN_CLASS).includes("flex-wrap"));
  });

  it("the location badge is capped, can shrink, and is not shrink-0", () => {
    const t = tokens(ADSET_ROW_LOCATION_BADGE_CLASS);
    assert.ok(t.includes("min-w-0"));
    assert.ok(t.some((c) => c.startsWith("max-w-")));
    assert.ok(!t.includes("shrink-0"));
  });
});

describe("generated names carry no location suffix", () => {
  it("two location groups: the name stays the audience name, the label is on the row for the badge", () => {
    const rows = [NEWCASTLE, BELFAST].map((g) =>
      stampLocationGroup(base, g, { groupCount: 2, configured: true }),
    );
    assert.deepEqual(rows.map((r) => r.name), ["Similar Pages", "Similar Pages"]);
    assert.deepEqual(rows.map((r) => r.locationLabel), [NEWCASTLE_LABEL, BELFAST.label]);
    assert.deepEqual(rows.map((r) => r.id), ["as_pg_1_grp_newcastle", "as_pg_1_grp_belfast"]);
    assert.equal(rows[0].geoLocations?.cities?.[0].key, "111");
  });

  it("one location group: no suffix and no id suffix, as before", () => {
    const row = stampLocationGroup(base, LONDON, { groupCount: 1, configured: true });
    assert.equal(row.name, "Similar Pages");
    assert.equal(row.id, "as_pg_1");
    assert.equal(row.locationGroupId, "grp_london");
  });

  it("the UK fallback is not a configured group and gets no FK", () => {
    const row = stampLocationGroup(base, LONDON, { groupCount: 1, configured: false });
    assert.equal(row.locationGroupId, undefined);
    assert.equal(row.locationLabel, "London +40km");
  });
});

describe("per-row location change leaves no stale location in the name", () => {
  it("a legacy name with the old suffix loses it when the row moves", () => {
    const legacy: AdSetSuggestion = {
      ...base,
      name: "Similar Pages — London +40km",
      locationGroupId: LONDON.id,
      locationLabel: LONDON.label,
      geoLocations: { cities: [{ key: "2421178", radius: 40, distance_unit: "kilometer" }] },
    };
    const moved = reassignAdSetLocationGroup(legacy, NEWCASTLE);
    assert.equal(moved.name, "Similar Pages");
    assert.ok(!moved.name.includes("London"));
    assert.equal(moved.locationGroupId, NEWCASTLE.id);
    assert.equal(moved.locationLabel, NEWCASTLE_LABEL);
    assert.equal(moved.geoLocations?.cities?.[0].key, "111");
  });

  it("an operator-typed name is left alone", () => {
    const row = stampLocationGroup({ ...base, name: "Headline — fans" }, LONDON, { groupCount: 2, configured: true });
    const moved = reassignAdSetLocationGroup(row, BELFAST);
    assert.equal(moved.name, "Headline — fans");
  });

  it("does not mutate the row it was given", () => {
    const row = stampLocationGroup(base, LONDON, { groupCount: 2, configured: true });
    const snapshot = JSON.parse(JSON.stringify(row));
    reassignAdSetLocationGroup(row, BELFAST);
    assert.deepEqual(row, snapshot);
  });
});
