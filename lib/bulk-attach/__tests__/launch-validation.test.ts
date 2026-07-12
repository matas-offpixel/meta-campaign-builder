import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultCreative } from "../../campaign-defaults.ts";
import {
  assessCreativeLaunchReadiness,
  parseLaunchValidationResponse,
  summariseRelaunchGuard,
  RELAUNCH_AD_COUNT_WARNING_THRESHOLD,
} from "../launch-validation.ts";
import type { AdSetGuardInfo } from "../../meta/client.ts";

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

describe("summariseRelaunchGuard", () => {
  function adSet(overrides: Partial<AdSetGuardInfo> = {}): AdSetGuardInfo {
    return { id: "as_1", isDynamicCreative: false, adCount: 0, ...overrides };
  }

  it("blocks when an ad set is Dynamic Creative and already has an ad", () => {
    const result = summariseRelaunchGuard(
      [adSet({ id: "as_dynamic", isDynamicCreative: true, adCount: 1 })],
      2,
    );
    assert.ok(result.blockedMessage);
    assert.match(result.blockedMessage!, /Dynamic Creative/);
    assert.match(result.blockedMessage!, /as_dynamic/);
  });

  it("does not block a Dynamic Creative ad set with zero ads yet", () => {
    const result = summariseRelaunchGuard(
      [adSet({ isDynamicCreative: true, adCount: 0 })],
      1,
    );
    assert.equal(result.blockedMessage, null);
  });

  it("does not block a non-dynamic ad set regardless of ad count", () => {
    const result = summariseRelaunchGuard(
      [adSet({ isDynamicCreative: false, adCount: 20 })],
      1,
    );
    assert.equal(result.blockedMessage, null);
  });

  it("warns (not blocks) when adding more ads pushes past the threshold", () => {
    const adCount = RELAUNCH_AD_COUNT_WARNING_THRESHOLD - 1;
    const result = summariseRelaunchGuard([adSet({ adCount })], 2);
    assert.equal(result.blockedMessage, null);
    assert.ok(result.warningMessage);
    assert.match(result.warningMessage!, new RegExp(`${RELAUNCH_AD_COUNT_WARNING_THRESHOLD}`));
  });

  it("does not warn when staying at or under the threshold", () => {
    const adCount = RELAUNCH_AD_COUNT_WARNING_THRESHOLD - 2;
    const result = summariseRelaunchGuard([adSet({ adCount })], 1);
    assert.equal(result.warningMessage, null);
  });

  it("returns no messages for an empty ad set list", () => {
    const result = summariseRelaunchGuard([], 5);
    assert.equal(result.blockedMessage, null);
    assert.equal(result.warningMessage, null);
  });
});
