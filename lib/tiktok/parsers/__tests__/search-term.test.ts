import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { parseSearchTermSheet } from "../search-term.ts";

describe("parseSearchTermSheet", () => {
  it("happy path — preserves first-seen order", () => {
    const rows = [
      ["Search term", "Cost", "Impressions", "Clicks (destination)"],
      ["techno london", "£10", "1,000", "20"],
      ["dnb festival", "£5", "500", "8"],
    ];
    const out = parseSearchTermSheet(rows);
    assert.equal(out.length, 2);
    assert.equal(out[0].search_term, "techno london");
    assert.equal(out[0].cost, 10);
    assert.equal(out[1].search_term, "dnb festival");
  });

  it("aggregates exact-duplicate terms by summing cost / impressions / clicks and recomputing rates", () => {
    const rows = [
      ["Search term", "Cost", "Impressions", "Clicks (destination)"],
      ["house music", "£10", "1,000", "10"],
      ["house music", "£20", "1,000", "10"],
    ];
    const out = parseSearchTermSheet(rows);
    assert.equal(out.length, 1);
    const row = out[0];
    assert.equal(row.search_term, "house music");
    assert.equal(row.cost, 30);
    assert.equal(row.impressions, 2000);
    assert.equal(row.clicks_destination, 20);
    // CPM recomputed: 30 / 2000 * 1000 = 15
    assert.equal(row.cpm, 15);
    // CPC: 30 / 20 = 1.5
    assert.equal(row.cpc_destination, 1.5);
    // CTR: 20 / 2000 * 100 = 1
    assert.equal(row.ctr_destination, 1);
  });

  it("skips total / blank rows and preserves '<5' on first-seen mask", () => {
    const rows = [
      ["Search term", "Cost", "Impressions"],
      ["Total", "£0", "0"],
      ["", "", ""],
      ["garage", "£1", "<5"],
    ];
    const out = parseSearchTermSheet(rows);
    assert.equal(out.length, 1);
    assert.equal(out[0].search_term, "garage");
    assert.equal(out[0].impressions, null);
    assert.equal(out[0].impressions_raw, "<5");
  });
});
