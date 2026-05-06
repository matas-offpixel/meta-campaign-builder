import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mergeAndSortCampaignsBySpend,
  type CampaignWithSpend,
} from "../campaign-spend-merge.ts";

describe("mergeAndSortCampaignsBySpend", () => {
  const rows: CampaignWithSpend[] = [
    { id: "a", name: "Low", spend: 0 },
    { id: "b", name: "High", spend: 120.5 },
    { id: "c", name: "Mid", spend: 40 },
  ];

  it("orders by spend descending by default (includes zero-spend)", () => {
    const sorted = mergeAndSortCampaignsBySpend(rows);
    assert.deepEqual(sorted.map((r) => r.id), ["b", "c", "a"]);
  });

  it("excludes zero-spend campaigns when excludeZeroSpend is set", () => {
    const sorted = mergeAndSortCampaignsBySpend(rows, {
      excludeZeroSpend: true,
    });
    assert.deepEqual(sorted.map((r) => r.id), ["b", "c"]);
  });
});
