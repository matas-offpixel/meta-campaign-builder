import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALL_AUDIENCE_DIMENSIONS_FAILED,
  readAudienceCatalogState,
  readAudienceDimensionFailed,
} from "../audience-response.ts";

describe("readAudienceCatalogState", () => {
  it("surfaces ok:false with no failed field as an error, not empty data", () => {
    const state = readAudienceCatalogState({
      ok: false,
      error: "TikTok credentials missing",
    });
    assert.deepEqual(state.catalogFailed, ALL_AUDIENCE_DIMENSIONS_FAILED);
    assert.equal(state.warning, "TikTok credentials missing");
  });

  it("reads per-dimension flags when ok is not false", () => {
    const state = readAudienceCatalogState({
      ok: true,
      failed: { interests: true },
    });
    assert.equal(state.catalogFailed.interests, true);
    assert.equal(state.catalogFailed.behaviours, false);
    assert.equal(state.warning, null);
  });
});

describe("readAudienceDimensionFailed", () => {
  it("treats ok:false without a failed field as a failed dimension", () => {
    const state = readAudienceDimensionFailed({
      ok: false,
      error: "Not signed in",
    });
    assert.equal(state.failed, true);
    assert.equal(state.error, "Not signed in");
  });
});
