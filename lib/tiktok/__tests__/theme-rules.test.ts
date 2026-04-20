import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { THEME_RULES, bucketSearchTerm } from "../theme-rules.ts";

describe("bucketSearchTerm", () => {
  it("buckets drum & bass aliases", () => {
    assert.equal(bucketSearchTerm("drum and bass london"), "drum & bass");
    assert.equal(bucketSearchTerm("dnb event"), "drum & bass");
    assert.equal(bucketSearchTerm("d&b party"), "drum & bass");
  });

  it("buckets techno", () => {
    assert.equal(bucketSearchTerm("techno"), "techno");
    assert.equal(bucketSearchTerm("melodic techno warehouse"), "techno");
  });

  it("buckets house variants", () => {
    assert.equal(bucketSearchTerm("house music"), "house");
    assert.equal(bucketSearchTerm("afro house london"), "house");
    assert.equal(bucketSearchTerm("deep house"), "house");
    assert.equal(bucketSearchTerm("tech house"), "house");
  });

  it("buckets festival", () => {
    assert.equal(bucketSearchTerm("summer festival 2026"), "festival");
    assert.equal(bucketSearchTerm("fest tickets"), "festival");
  });

  it("buckets r&b / soul", () => {
    assert.equal(bucketSearchTerm("rnb night"), "r&b / soul");
    assert.equal(bucketSearchTerm("r&b classics"), "r&b / soul");
    assert.equal(bucketSearchTerm("soul music"), "r&b / soul");
  });

  it("buckets rap / hip-hop", () => {
    assert.equal(bucketSearchTerm("rap concert"), "rap / hip-hop");
    assert.equal(bucketSearchTerm("hip hop london"), "rap / hip-hop");
    assert.equal(bucketSearchTerm("hip-hop night"), "rap / hip-hop");
  });

  it("buckets garage", () => {
    assert.equal(bucketSearchTerm("uk garage"), "garage");
    assert.equal(bucketSearchTerm("garage music"), "garage");
  });

  it("buckets nightlife terms", () => {
    assert.equal(bucketSearchTerm("club night"), "nightlife");
    assert.equal(bucketSearchTerm("nightlife near me"), "nightlife");
    assert.equal(bucketSearchTerm("party tickets"), "nightlife");
  });

  it("returns null for unbucketed terms", () => {
    assert.equal(bucketSearchTerm("yoga class"), null);
    assert.equal(bucketSearchTerm("brunch london"), null);
    assert.equal(bucketSearchTerm(""), null);
    assert.equal(bucketSearchTerm("   "), null);
  });

  it("THEME_RULES has every documented bucket exactly once", () => {
    const buckets = THEME_RULES.map((r) => r.bucket);
    assert.deepEqual(
      [...new Set(buckets)].sort(),
      [
        "drum & bass",
        "festival",
        "garage",
        "house",
        "nightlife",
        "r&b / soul",
        "rap / hip-hop",
        "techno",
      ].sort(),
    );
  });
});
