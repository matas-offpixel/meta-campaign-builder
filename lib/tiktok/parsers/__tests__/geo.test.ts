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
});
