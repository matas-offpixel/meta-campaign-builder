/**
 * Tests for lib/wizard/adset-suggestions.ts — the Step 5 "Ad Sets"
 * refinement pack (operator ask 2026-08-07): blank ad set creation,
 * duplicate, delete, bulk age/budget edits, and the "Generate audience
 * set × location" bonus.
 *
 * Run: node --test lib/wizard/__tests__/adset-suggestions.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createBlankAdSetSuggestion,
  defaultBlankAdSetBudget,
  duplicateAdSetSuggestion,
  resolveDuplicateAdSetName,
  clearUnsupportedAdvantagePlus,
  deleteAdSetSuggestion,
  applyBulkAgeRange,
  applyBulkDailyBudget,
  duplicateSuggestionsUnderLocationGroup,
  MAX_ADSET_NAME_LENGTH,
} from "../adset-suggestions.ts";
import type { AdSetSuggestion, LocationTargetingGroup } from "../../types.ts";

const FALLBACK_UK: LocationTargetingGroup = {
  id: "preset_gb_nationwide",
  label: "UK (nationwide)",
  source: "preset",
  selections: [{ id: "gb", source: "preset", label: "United Kingdom", mode: "include", locationType: "country", countryCode: "GB" }],
};

const NEWCASTLE: LocationTargetingGroup = {
  id: "grp_newcastle",
  label: "Newcastle +40km",
  source: "manual",
  selections: [{ id: "sel1", source: "search", label: "Newcastle", mode: "include", locationType: "city", locationKey: "111", radius: 40, distanceUnit: "kilometer" }],
};

const MANCHESTER: LocationTargetingGroup = {
  id: "grp_manchester",
  label: "Manchester +30km",
  source: "manual",
  selections: [{ id: "sel2", source: "search", label: "Manchester", mode: "include", locationType: "city", locationKey: "222", radius: 30, distanceUnit: "kilometer" }],
};

function makeSuggestion(overrides: Partial<AdSetSuggestion> = {}): AdSetSuggestion {
  return {
    id: "s1",
    name: "Page Group",
    sourceType: "page_group",
    sourceId: "pg1",
    sourceName: "Page Group (3 pages)",
    ageMin: 21,
    ageMax: 45,
    budgetPerDay: 12.5,
    advantagePlus: false,
    enabled: true,
    locationLabel: "Newcastle +40km",
    locationGroupId: "grp_newcastle",
    placementConfig: { mode: "manual", publisherPlatforms: ["facebook"] },
    ...overrides,
  };
}

describe("createBlankAdSetSuggestion", () => {
  it("has sourceType 'blank', empty sourceId, advantagePlus true, and no audience source", () => {
    const blank = createBlankAdSetSuggestion([], FALLBACK_UK);
    assert.equal(blank.sourceType, "blank");
    assert.equal(blank.sourceId, "");
    assert.equal(blank.advantagePlus, true);
    assert.equal(blank.enabled, true);
  });

  it("defaults location to the first configured location group when present", () => {
    const blank = createBlankAdSetSuggestion([NEWCASTLE, MANCHESTER], FALLBACK_UK);
    assert.equal(blank.locationGroupId, "grp_newcastle");
    assert.equal(blank.locationLabel, "Newcastle +40km");
  });

  it("falls back to the UK-nationwide fallback group when no location groups are configured", () => {
    const blank = createBlankAdSetSuggestion([], FALLBACK_UK);
    assert.equal(blank.locationGroupId, undefined);
    assert.equal(blank.locationLabel, "UK (nationwide)");
    assert.deepEqual(blank.geoLocations?.countries, ["GB"]);
  });

  // task #122 (FIX 3) — Meta rejects ad set creation outright (subcode
  // 1885272) when daily_budget is 0. createBlankAdSetSuggestion used to
  // hardcode budgetPerDay: 0 (reproducer: IPC Newcastle signup v2 launch,
  // 2026-08-07).
  it("never defaults budgetPerDay to 0 — falls back to 100 when no default is passed", () => {
    const blank = createBlankAdSetSuggestion([], FALLBACK_UK);
    assert.equal(blank.budgetPerDay, 100);
  });

  it("uses the explicit defaultBudgetPerDay argument when passed", () => {
    const blank = createBlankAdSetSuggestion([], FALLBACK_UK, 42.5);
    assert.equal(blank.budgetPerDay, 42.5);
  });

  it("clamps a passed-in 0/negative defaultBudgetPerDay up to 100 (belt-and-braces)", () => {
    assert.equal(createBlankAdSetSuggestion([], FALLBACK_UK, 0).budgetPerDay, 100);
    assert.equal(createBlankAdSetSuggestion([], FALLBACK_UK, -5).budgetPerDay, 100);
  });
});

describe("defaultBlankAdSetBudget", () => {
  it("returns the hard floor of 100 when there are no existing suggestions and no campaign default", () => {
    assert.equal(defaultBlankAdSetBudget([], 0), 100);
  });

  it("uses the median of existing suggestions' budgetPerDay when it exceeds 100 and the campaign default", () => {
    const suggestions = [
      makeSuggestion({ id: "s1", budgetPerDay: 150 }),
      makeSuggestion({ id: "s2", budgetPerDay: 200 }),
      makeSuggestion({ id: "s3", budgetPerDay: 250 }),
    ];
    assert.equal(defaultBlankAdSetBudget(suggestions, 20), 200);
  });

  it("uses the campaign default when it exceeds the median and the floor", () => {
    const suggestions = [
      makeSuggestion({ id: "s1", budgetPerDay: 10 }),
      makeSuggestion({ id: "s2", budgetPerDay: 20 }),
    ];
    assert.equal(defaultBlankAdSetBudget(suggestions, 500), 500);
  });

  it("falls back to the 100 floor when both median and campaign default are 0 (e.g. every existing suggestion is a prior 0-budget blank row)", () => {
    const suggestions = [
      makeSuggestion({ id: "s1", budgetPerDay: 0 }),
      makeSuggestion({ id: "s2", budgetPerDay: 0 }),
    ];
    assert.equal(defaultBlankAdSetBudget(suggestions, 0), 100);
  });

  it("computes an even-count median as the average of the two middle values", () => {
    const suggestions = [
      makeSuggestion({ id: "s1", budgetPerDay: 100 }),
      makeSuggestion({ id: "s2", budgetPerDay: 300 }),
    ];
    // median of [100, 300] = 200, which beats the 100 floor and a 0 campaign default.
    assert.equal(defaultBlankAdSetBudget(suggestions, 0), 200);
  });

  it("ignores non-finite budgetPerDay values defensively", () => {
    const suggestions = [
      makeSuggestion({ id: "s1", budgetPerDay: Number.NaN }),
      makeSuggestion({ id: "s2", budgetPerDay: 150 }),
    ];
    assert.equal(defaultBlankAdSetBudget(suggestions, 0), 150);
  });
});

describe("duplicateAdSetSuggestion", () => {
  it("clones every field verbatim except name + advantagePlus, which flip to differentiate the A/B pair", () => {
    const source = makeSuggestion({ advantagePlus: false });
    const next = duplicateAdSetSuggestion([source], "s1");
    assert.equal(next.length, 2);
    const clone = next[1];
    // Source was strict; default (advantagePlusSupported: true) flips the copy to Adv+.
    assert.equal(clone.advantagePlus, true);
    assert.equal(clone.name, "Page Group – Adv+");
    assert.notEqual(clone.id, source.id);
    // Every other field copied verbatim.
    assert.equal(clone.sourceType, source.sourceType);
    assert.equal(clone.sourceId, source.sourceId);
    assert.equal(clone.ageMin, source.ageMin);
    assert.equal(clone.ageMax, source.ageMax);
    assert.equal(clone.budgetPerDay, source.budgetPerDay);
    assert.equal(clone.locationGroupId, source.locationGroupId);
    assert.deepEqual(clone.placementConfig, source.placementConfig);
  });

  it("flips an Advantage+ source to a strict copy, named '... – Strict'", () => {
    const source = makeSuggestion({ advantagePlus: true });
    const next = duplicateAdSetSuggestion([source], "s1");
    assert.equal(next[1].advantagePlus, false);
    assert.equal(next[1].name, "Page Group – Strict");
  });

  it("keeps the copy identical (name + advantagePlus) when advantagePlusSupported is false", () => {
    const source = makeSuggestion({ advantagePlus: false });
    const next = duplicateAdSetSuggestion([source], "s1", false);
    assert.equal(next[1].advantagePlus, false);
    assert.equal(next[1].name, "Page Group (copy)");
  });

  it("never flips advantagePlus for a blank ad set (always locked ON)", () => {
    const source = makeSuggestion({ sourceType: "blank", advantagePlus: true, name: "Blank (no audience)" });
    const next = duplicateAdSetSuggestion([source], "s1", true);
    assert.equal(next[1].advantagePlus, true);
    assert.equal(next[1].name, "Blank (no audience) (copy)");
  });

  it("inserts the clone directly under the source row, not at the end", () => {
    const rows = [makeSuggestion({ id: "a" }), makeSuggestion({ id: "b" }), makeSuggestion({ id: "c" })];
    const next = duplicateAdSetSuggestion(rows, "a");
    assert.equal(next.length, 4);
    assert.equal(next[0].id, "a");
    assert.match(next[1].id, /^a_copy_/);
    assert.equal(next[2].id, "b");
    assert.equal(next[3].id, "c");
  });

  it("returns the original array unchanged when the id isn't found", () => {
    const rows = [makeSuggestion({ id: "a" })];
    assert.equal(duplicateAdSetSuggestion(rows, "missing"), rows);
  });
});

describe("resolveDuplicateAdSetName", () => {
  it("appends ' – Strict' when the source is Advantage+ and the copy is strict", () => {
    assert.equal(resolveDuplicateAdSetName({ name: "Similar Pages", advantagePlus: true }, false), "Similar Pages – Strict");
  });

  it("appends ' – Adv+' when the source is strict and the copy is Advantage+", () => {
    assert.equal(resolveDuplicateAdSetName({ name: "Similar Pages", advantagePlus: false }, true), "Similar Pages – Adv+");
  });

  it("falls back to ' (copy)' when the mode is unchanged (both strict)", () => {
    assert.equal(resolveDuplicateAdSetName({ name: "Similar Pages", advantagePlus: false }, false), "Similar Pages (copy)");
  });

  it("falls back to ' (copy)' when the mode is unchanged (both Advantage+)", () => {
    assert.equal(resolveDuplicateAdSetName({ name: "Similar Pages", advantagePlus: true }, true), "Similar Pages (copy)");
  });

  it("truncates a long name with an ellipsis so the result stays within MAX_ADSET_NAME_LENGTH", () => {
    const longName = "A".repeat(50);
    const result = resolveDuplicateAdSetName({ name: longName, advantagePlus: false }, true);
    assert.ok(result.length <= MAX_ADSET_NAME_LENGTH, `expected length <= ${MAX_ADSET_NAME_LENGTH}, got ${result.length}`);
    assert.ok(result.endsWith(" – Adv+"));
    assert.ok(result.includes("…"));
  });
});

describe("clearUnsupportedAdvantagePlus", () => {
  it("clears advantagePlus on every row that has it set, leaving others untouched", () => {
    const rows = [
      makeSuggestion({ id: "a", advantagePlus: true }),
      makeSuggestion({ id: "b", advantagePlus: false }),
      makeSuggestion({ id: "c", advantagePlus: true }),
    ];
    const { suggestions, clearedCount } = clearUnsupportedAdvantagePlus(rows);
    assert.equal(clearedCount, 2);
    assert.equal(suggestions.find((s) => s.id === "a")?.advantagePlus, false);
    assert.equal(suggestions.find((s) => s.id === "b")?.advantagePlus, false);
    assert.equal(suggestions.find((s) => s.id === "c")?.advantagePlus, false);
  });

  it("clears blank ad sets too — they'd otherwise be permanently stuck (no UI control to turn the toggle off)", () => {
    const rows = [makeSuggestion({ id: "blank1", sourceType: "blank", advantagePlus: true })];
    const { suggestions, clearedCount } = clearUnsupportedAdvantagePlus(rows);
    assert.equal(clearedCount, 1);
    assert.equal(suggestions[0].advantagePlus, false);
  });

  it("is a no-op (clearedCount 0) when nothing has advantagePlus set", () => {
    const rows = [makeSuggestion({ id: "a", advantagePlus: false }), makeSuggestion({ id: "b", advantagePlus: false })];
    const { suggestions, clearedCount } = clearUnsupportedAdvantagePlus(rows);
    assert.equal(clearedCount, 0);
    assert.deepEqual(suggestions, rows);
  });

  it("does not mutate the original array", () => {
    const rows = [makeSuggestion({ id: "a", advantagePlus: true })];
    clearUnsupportedAdvantagePlus(rows);
    assert.equal(rows[0].advantagePlus, true);
  });
});

describe("deleteAdSetSuggestion", () => {
  it("removes only the targeted row", () => {
    const rows = [makeSuggestion({ id: "a" }), makeSuggestion({ id: "b" })];
    const next = deleteAdSetSuggestion(rows, "a");
    assert.equal(next.length, 1);
    assert.equal(next[0].id, "b");
  });
});

describe("applyBulkAgeRange / applyBulkDailyBudget", () => {
  it("writes the same age range onto every row", () => {
    const rows = [makeSuggestion({ id: "a", ageMin: 18, ageMax: 24 }), makeSuggestion({ id: "b", ageMin: 30, ageMax: 40 })];
    const next = applyBulkAgeRange(rows, 25, 55);
    assert.ok(next.every((s) => s.ageMin === 25 && s.ageMax === 55));
    assert.equal(next.length, rows.length);
  });

  it("writes the same daily budget onto every row, including disabled ones", () => {
    const rows = [makeSuggestion({ id: "a", enabled: true, budgetPerDay: 5 }), makeSuggestion({ id: "b", enabled: false, budgetPerDay: 0 })];
    const next = applyBulkDailyBudget(rows, 20);
    assert.ok(next.every((s) => s.budgetPerDay === 20));
  });

  it("does not mutate the original array (undo relies on the caller's snapshot staying intact)", () => {
    const rows = [makeSuggestion({ id: "a", ageMin: 18, ageMax: 24 })];
    const snapshot = JSON.parse(JSON.stringify(rows));
    applyBulkAgeRange(rows, 99, 99);
    assert.deepEqual(rows, snapshot);
  });
});

describe("duplicateSuggestionsUnderLocationGroup", () => {
  it("duplicates every enabled row not already assigned to the target group", () => {
    const rows = [
      makeSuggestion({ id: "a", enabled: true, locationGroupId: "grp_newcastle", locationLabel: "Newcastle +40km" }),
      makeSuggestion({ id: "b", enabled: false, locationGroupId: "grp_newcastle", locationLabel: "Newcastle +40km" }),
    ];
    const newRows = duplicateSuggestionsUnderLocationGroup(rows, MANCHESTER);
    assert.equal(newRows.length, 1); // "b" is disabled, skipped
    assert.equal(newRows[0].locationGroupId, "grp_manchester");
    assert.equal(newRows[0].locationLabel, "Manchester +30km");
    assert.equal(newRows[0].name, "Page Group — Manchester +30km");
  });

  it("skips rows already assigned to the target group (no-op duplication)", () => {
    const rows = [makeSuggestion({ id: "a", enabled: true, locationGroupId: "grp_manchester" })];
    const newRows = duplicateSuggestionsUnderLocationGroup(rows, MANCHESTER);
    assert.equal(newRows.length, 0);
  });

  it("strips a prior location suffix before appending the new one (no suffix chaining)", () => {
    const rows = [
      makeSuggestion({
        id: "a",
        enabled: true,
        name: "Page Group — Newcastle +40km",
        locationGroupId: "grp_newcastle",
        locationLabel: "Newcastle +40km",
      }),
    ];
    const newRows = duplicateSuggestionsUnderLocationGroup(rows, MANCHESTER);
    assert.equal(newRows[0].name, "Page Group — Manchester +30km");
  });

  it("returns only new rows — caller is responsible for appending", () => {
    const rows = [makeSuggestion({ id: "a", enabled: true })];
    const newRows = duplicateSuggestionsUnderLocationGroup(rows, MANCHESTER);
    assert.equal(rows.length, 1);
    assert.equal(newRows.length, 1);
  });
});
