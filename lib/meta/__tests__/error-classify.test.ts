/**
 * Unit tests for isObjectiveIncompatibilityError — surfaces a friendly
 * message when `attach_all_adsets` (task #114) attaches a shared creative
 * to an ad set whose campaign objective doesn't support it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isObjectiveIncompatibilityError } from "../error-classify.ts";

describe("isObjectiveIncompatibilityError", () => {
  it("matches subcode 1815159 (Creative and objective mismatch)", () => {
    assert.equal(
      isObjectiveIncompatibilityError({
        code: 100,
        subcode: 1815159,
        message: "Invalid parameter",
        userMsg:
          "Please make sure that an objective is selected, and choose a creative type that matches the objective you've selected.",
      }),
      true,
    );
  });

  it("matches subcode 1487664 (Missing Call To Action Type)", () => {
    assert.equal(
      isObjectiveIncompatibilityError({
        code: 100,
        subcode: 1487664,
        message: "call_to_action_type field in creative is required in this ad",
      }),
      true,
    );
  });

  it("matches on message phrase even without a known subcode", () => {
    assert.equal(
      isObjectiveIncompatibilityError({
        code: 100,
        subcode: 9999999,
        message: "objective mismatch between ad set and creative",
      }),
      true,
    );
  });

  it("does not match unrelated code=100 errors", () => {
    assert.equal(
      isObjectiveIncompatibilityError({
        code: 100,
        subcode: 33,
        message: "Invalid targeting spec",
      }),
      false,
    );
  });

  it("does not match errors with an unrelated top-level code", () => {
    assert.equal(
      isObjectiveIncompatibilityError({
        code: 4,
        message: "Application request limit reached",
      }),
      false,
    );
  });

  it("does not match null/undefined/non-object input", () => {
    assert.equal(isObjectiveIncompatibilityError(null), false);
    assert.equal(isObjectiveIncompatibilityError(undefined), false);
    assert.equal(isObjectiveIncompatibilityError("some string"), false);
  });
});
