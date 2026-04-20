import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { parseAdSheet } from "../ad.ts";

describe("parseAdSheet", () => {
  it("happy path — multiple ad rows in original order", () => {
    const rows = [
      [
        "Ad name",
        "Primary status",
        "Secondary status",
        "Cost",
        "Impressions",
        "Reach",
        "Frequency",
        "Clicks (all)",
        "CTR (all)",
        "Clicks (destination)",
        "CPC (destination)",
        "Secondary source",
        "Primary source",
        "Attribution source",
      ],
      [
        "POST 1",
        "Active",
        "--",
        "£500",
        "50,000",
        "40,000",
        "1.25",
        "2,000",
        "4.00%",
        "500",
        "£1.00",
        "Authorized by video code",
        "TikTok creator content",
        "Click",
      ],
      [
        "POST 2",
        "Not delivering",
        "Review not approved",
        "£0",
        "0",
        "0",
        "0",
        "0",
        "0%",
        "0",
        "--",
        "--",
        "--",
        "--",
      ],
    ];
    const out = parseAdSheet(rows);
    assert.equal(out.length, 2);
    assert.equal(out[0].ad_name, "POST 1");
    assert.equal(out[0].primary_status, "Active");
    assert.equal(out[0].secondary_status, "");
    assert.equal(out[0].cost, 500);
    assert.equal(out[0].secondary_source, "Authorized by video code");
    assert.equal(out[0].primary_source, "TikTok creator content");
    assert.equal(out[0].attribution_source, "Click");
    assert.equal(out[0].currency, "GBP");

    assert.equal(out[1].ad_name, "POST 2");
    assert.equal(out[1].primary_status, "Not delivering");
    assert.equal(out[1].secondary_status, "Review not approved");
    assert.equal(out[1].secondary_source, null);
    assert.equal(out[1].primary_source, null);
    assert.equal(out[1].attribution_source, null);
  });

  it("skips total / blank rows", () => {
    const rows = [
      ["Ad name", "Primary status", "Cost", "Impressions"],
      ["Total of 2 results", "", "£500", "50,000"],
      ["", "", "", ""],
      ["POST 1", "Active", "£500", "<5"],
    ];
    const out = parseAdSheet(rows);
    assert.equal(out.length, 1);
    assert.equal(out[0].ad_name, "POST 1");
    assert.equal(out[0].impressions, null);
    assert.equal(out[0].impressions_raw, "<5");
  });

  it("returns [] for empty / headerless sheets", () => {
    assert.deepEqual(parseAdSheet([]), []);
    assert.deepEqual(parseAdSheet([["Foo", "Bar"]]), []);
  });
});
