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

  it("keeps per-checkbox toggle behaviour", () => {
    const next = toggleTikTokAssignment({ "ag-1": ["c-1"] }, "ag-1", "c-2");
    assert.deepEqual(next, { "ag-1": ["c-1", "c-2"] });
    assert.deepEqual(toggleTikTokAssignment(next, "ag-1", "c-1"), {
      "ag-1": ["c-2"],
    });
  });
});
