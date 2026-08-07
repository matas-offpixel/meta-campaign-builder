/**
 * Unit tests for isInvalidTargetingAutomationError — surfaces Meta's
 * "targeting automation type ... invalid" refusal (subcode 1870196) so
 * launch-campaign/route.ts can retry without Advantage+ Audience instead of
 * failing the ad set outright (task #116).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { isInvalidTargetingAutomationError } from "../error-classify.ts";

/**
 * Anchored to the operator-reported East End Dubs Newcastle failure (task
 * #116) — see fixtures/targeting_automation_1870196.json for provenance.
 */
const REFUSAL = JSON.parse(
  readFileSync(new URL("./fixtures/targeting_automation_1870196.json", import.meta.url), "utf8"),
) as { error: { message: string; code: number; error_subcode: number } };

describe("fixture provenance", () => {
  it("the reported refusal really is code 100 / subcode 1870196", () => {
    assert.equal(REFUSAL.error.code, 100);
    assert.equal(REFUSAL.error.error_subcode, 1870196);
  });
});

describe("isInvalidTargetingAutomationError", () => {
  it("matches subcode 1870196 from a thrown MetaApiError shape", () => {
    assert.equal(
      isInvalidTargetingAutomationError({
        code: REFUSAL.error.code,
        subcode: REFUSAL.error.error_subcode,
        message: REFUSAL.error.message,
      }),
      true,
    );
  });

  it("matches on error_subcode from a raw Graph body", () => {
    assert.equal(isInvalidTargetingAutomationError(REFUSAL.error), true);
  });

  it("matches on Meta's wording when the transport lost the subcode", () => {
    assert.equal(isInvalidTargetingAutomationError(new Error(REFUSAL.error.message)), true);
  });

  it("matches on userMsg when message is generic", () => {
    assert.equal(
      isInvalidTargetingAutomationError({
        code: 100,
        message: "Invalid parameter",
        userMsg: "The targeting automation type passed is invalid. Please pass the correct one.",
      }),
      true,
    );
  });

  it("does not match unrelated code=100 errors", () => {
    assert.equal(
      isInvalidTargetingAutomationError({
        code: 100,
        subcode: 33,
        message: "Invalid targeting spec",
      }),
      false,
    );
  });

  it("does not match errors with an unrelated top-level code", () => {
    assert.equal(
      isInvalidTargetingAutomationError({
        code: 4,
        message: "Application request limit reached",
      }),
      false,
    );
  });

  it("does not match null/undefined/non-object input", () => {
    assert.equal(isInvalidTargetingAutomationError(null), false);
    assert.equal(isInvalidTargetingAutomationError(undefined), false);
    assert.equal(isInvalidTargetingAutomationError("some string"), false);
  });
});
