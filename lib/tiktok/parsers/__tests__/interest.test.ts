import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { parseInterestSheet } from "../interest.ts";

describe("parseInterestSheet", () => {
  it("happy path — Audience column", () => {
    const rows = [
      ["Audience", "Cost", "Impressions"],
      ["Electronic Music", "£100", "10,000"],
      ["Streetwear", "£50", "5,000"],
    ];
    const out = parseInterestSheet(rows);
    assert.equal(out.length, 2);
    assert.equal(out[0].audience_label, "Electronic Music");
    assert.equal(out[0].cost, 100);
    // vertical comes from the stub classifyVertical → null until commit 3.
    assert.equal(typeof out[0].vertical, "object");
  });

  it("accepts Interest column alias and skips total row", () => {
    const rows = [
      ["Interest", "Cost"],
      ["Total of 1 result", "£0"],
      ["Yoga", "<5"],
    ];
    const out = parseInterestSheet(rows);
    assert.equal(out.length, 1);
    assert.equal(out[0].audience_label, "Yoga");
  });
});
