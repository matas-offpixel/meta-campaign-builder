import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultCreative } from "../../campaign-defaults.ts";
import {
  assessCreativeLaunchReadiness,
  parseLaunchValidationResponse,
} from "../launch-validation.ts";

describe("parseLaunchValidationResponse", () => {
  it("extracts message and details array from 400 body", () => {
    const parsed = parseLaunchValidationResponse({
      error: "Creative validation failed",
      details: ["Ad 1: Facebook page ID is required"],
    });
    assert.equal(parsed.message, "Creative validation failed");
    assert.deepEqual(parsed.details, ["Ad 1: Facebook page ID is required"]);
  });

  it("returns empty details when absent", () => {
    const parsed = parseLaunchValidationResponse({ error: "Launch failed" });
    assert.equal(parsed.details.length, 0);
  });
});

describe("assessCreativeLaunchReadiness", () => {
  it("blocks launch while pages are still loading", () => {
    const creative = createDefaultCreative();
    const result = assessCreativeLaunchReadiness([creative], {
      pagesLoading: true,
      pagesCount: 0,
    });
    assert.equal(result.pagesStillLoading, true);
    assert.equal(result.ready, false);
  });

  it("blocks launch when pageId is missing after pages load", () => {
    const creative = createDefaultCreative();
    creative.identity.pageId = "";
    const result = assessCreativeLaunchReadiness([creative], {
      pagesLoading: false,
      pagesCount: 3,
    });
    assert.equal(result.missingPageId, true);
    assert.equal(result.ready, false);
  });
});
