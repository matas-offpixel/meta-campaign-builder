import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { parseGeoSheet } from "../geo.ts";

describe("parseGeoSheet", () => {
  it("infers 'country' region type from leftmost header", () => {
    const rows = [
      ["Country", "Cost", "Impressions"],
      ["United Kingdom", "£500", "100,000"],
      ["Ireland", "£100", "20,000"],
    ];
    const out = parseGeoSheet(rows);
    assert.equal(out.length, 2);
    assert.equal(out[0].region_type, "country");
    assert.equal(out[0].region_name, "United Kingdom");
    assert.equal(out[0].cost, 500);
    assert.equal(out[1].region_name, "Ireland");
  });

  it("infers 'region' from leftmost header", () => {
    const rows = [
      ["Region", "Cost"],
      ["England", "£100"],
    ];
    const out = parseGeoSheet(rows);
    assert.equal(out[0].region_type, "region");
    assert.equal(out[0].region_name, "England");
  });

  it("infers 'city' and skips total row", () => {
    const rows = [
      ["City", "Cost", "Impressions"],
      ["Total of 1 result", "£100", "10,000"],
      ["London", "£100", "<5"],
    ];
    const out = parseGeoSheet(rows);
    assert.equal(out.length, 1);
    assert.equal(out[0].region_type, "city");
    assert.equal(out[0].region_name, "London");
    assert.equal(out[0].impressions, null);
    assert.equal(out[0].impressions_raw, "<5");
  });

  it("returns [] for unknown leftmost header", () => {
    const rows = [
      ["Province", "Cost"],
      ["X", "£1"],
    ];
    assert.deepEqual(parseGeoSheet(rows), []);
  });

  it("accepts 'Audience' leftmost header → region type, verbatim name", () => {
    const rows = [
      ["Audience", "Cost", "Impressions"],
      ["England", "£500", "100,000"],
      ["Scotland", "£120", "30,000"],
      ["Northern Ireland", "£40", "8,000"],
      ["Unknown", "£10", "<5"],
    ];
    const out = parseGeoSheet(rows);
    assert.equal(out.length, 4);
    for (const row of out) {
      assert.equal(row.region_type, "region");
    }
    assert.equal(out[0].region_name, "England");
    assert.equal(out[0].cost, 500);
    assert.equal(out[3].region_name, "Unknown");
    assert.equal(out[3].impressions, null);
    assert.equal(out[3].impressions_raw, "<5");
  });
});
