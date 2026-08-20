import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assignTikTokCreativeToAllAdGroups,
  assignTikTokCreativesToAdGroup,
  assignTikTokEverything,
  clearTikTokAdGroupAssignments,
  clearTikTokCreativeFromAllAdGroups,
  clearTikTokEverything,
  toggleTikTokAssignment,
} from "../assign-creatives.ts";

const adGroups = ["ag-1", "ag-2", "ag-3"];
const creatives = ["c-1", "c-2", "c-3"];

describe("TikTok creative assignment map", () => {
  it("assign-all fills one ad group with every creative and leaves the others", () => {
    const current = {
      "ag-1": ["c-1"],
      "ag-2": ["c-2"],
    };
    const next = assignTikTokCreativesToAdGroup(current, "ag-2", creatives);
    assert.deepEqual(next, {
      "ag-1": ["c-1"],
      "ag-2": ["c-1", "c-2", "c-3"],
    });
    const cleared = clearTikTokAdGroupAssignments(next, "ag-2");
    assert.deepEqual(cleared, {
      "ag-1": ["c-1"],
      "ag-2": [],
    });
  });

  it("assign-row puts one creative on every ad group and the inverse removes it", () => {
    const current = {
      "ag-1": ["c-1"],
      "ag-2": [],
    };
    const next = assignTikTokCreativeToAllAdGroups(current, adGroups, "c-2");
    assert.deepEqual(next, {
      "ag-1": ["c-1", "c-2"],
      "ag-2": ["c-2"],
      "ag-3": ["c-2"],
    });
    const cleared = clearTikTokCreativeFromAllAdGroups(next, adGroups, "c-2");
    assert.deepEqual(cleared, {
      "ag-1": ["c-1"],
      "ag-2": [],
      "ag-3": [],
    });
  });

  it("assign-everything and clear-everything write the full persisted map", () => {
    const assigned = assignTikTokEverything(
      { "ag-stale": ["old"] },
      adGroups,
      creatives,
    );
    assert.deepEqual(assigned, {
      "ag-stale": ["old"],
      "ag-1": ["c-1", "c-2", "c-3"],
      "ag-2": ["c-1", "c-2", "c-3"],
      "ag-3": ["c-1", "c-2", "c-3"],
    });
    const cleared = clearTikTokEverything(assigned, adGroups);
    assert.deepEqual(cleared, {
      "ag-stale": ["old"],
      "ag-1": [],
      "ag-2": [],
      "ag-3": [],
    });
  });

  it("gives each ad group its own assignment array", () => {
    const everything = assignTikTokEverything({}, adGroups, creatives);
    assert.notEqual(everything["ag-1"], everything["ag-2"]);
    everything["ag-1"].push("mutated");
    assert.deepEqual(everything["ag-2"], creatives);

    const column = assignTikTokCreativesToAdGroup(everything, "ag-3", creatives);
    assert.notEqual(column["ag-3"], creatives);
    column["ag-3"].push("mutated");
    assert.deepEqual(creatives, ["c-1", "c-2", "c-3"]);

    const row = assignTikTokCreativeToAllAdGroups({}, adGroups, "c-1");
    assert.notEqual(row["ag-1"], row["ag-2"]);
    row["ag-1"].push("mutated");
    assert.deepEqual(row["ag-2"], ["c-1"]);

    const clearedColumn = clearTikTokAdGroupAssignments(row, "ag-1");
    const clearedRow = clearTikTokCreativeFromAllAdGroups(row, adGroups, "c-1");
    const clearedAll = clearTikTokEverything(everything, adGroups);
    assert.notEqual(clearedAll["ag-1"], clearedAll["ag-2"]);
    clearedAll["ag-1"].push("mutated");
    assert.deepEqual(clearedAll["ag-2"], []);
    assert.deepEqual(clearedColumn["ag-1"], []);
    assert.deepEqual(clearedRow["ag-2"], []);
  });

  it("keeps per-checkbox toggle behaviour", () => {
    const next = toggleTikTokAssignment({ "ag-1": ["c-1"] }, "ag-1", "c-2");
    assert.deepEqual(next, { "ag-1": ["c-1", "c-2"] });
    assert.deepEqual(toggleTikTokAssignment(next, "ag-1", "c-1"), {
      "ag-1": ["c-2"],
    });
  });
});
