import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detectAssetScope } from "../copy-generator.ts";

describe("detectAssetScope", () => {
  it("detects venue-wide loading bar assets", () => {
    assert.equal(detectAssetScope("Bournemouth Tickets Loading Bar"), "venue-wide");
    assert.equal(detectAssetScope("Newcastle Tickets Sale"), "venue-wide");
  });

  it("defaults to fixture-specific for named assets", () => {
    assert.equal(detectAssetScope("Craig Levein Morocco"), "fixture-specific");
    assert.equal(detectAssetScope("England v Ghana Promo"), "fixture-specific");
  });
});
