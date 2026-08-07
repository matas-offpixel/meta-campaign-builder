/**
 * Unit tests for isObjectiveIncompatibilityError — surfaces a friendly
 * message when `attach_all_adsets` (task #114) attaches a shared creative
 * to an ad set whose campaign objective doesn't support it.
 *
 * Also covers isMissingAdvantageAudienceFlagError (task #122, FIX 2) —
 * Meta subcode 1870227, distinct from isInvalidTargetingAutomationError's
 * subcode 1870196 (which rejects advantage_audience=1 for the objective;
 * 1870227 rejects the flag being absent/unset at all).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isObjectiveIncompatibilityError,
  isMissingAdvantageAudienceFlagError,
} from "../error-classify.ts";

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

describe("isMissingAdvantageAudienceFlagError", () => {
  it("matches subcode 1870227 (missing advantage_audience flag)", () => {
    assert.equal(
      isMissingAdvantageAudienceFlagError({
        code: 100,
        subcode: 1870227,
        message: "Invalid parameter",
        userMsg: "advantage_audience must be explicitly set to 0 or 1 for this objective.",
      }),
      true,
    );
  });

  it("does not match a raw Graph body's error_subcode field — only `subcode` is read directly (message phrase is the fallback for that shape)", () => {
    assert.equal(
      isMissingAdvantageAudienceFlagError({
        code: 100,
        error_subcode: 1870227,
        message: "Invalid parameter",
      }),
      false,
    );
  });

  it("matches on message phrase even without the known subcode", () => {
    assert.equal(
      isMissingAdvantageAudienceFlagError({
        code: 100,
        subcode: 9999999,
        message: "The advantage_audience field is required for this ad set.",
      }),
      true,
    );
  });

  it("does not match subcode 1870196 (the sibling invalid-value refusal)", () => {
    assert.equal(
      isMissingAdvantageAudienceFlagError({
        code: 100,
        subcode: 1870196,
        message: "The targeting automation type passed is invalid.",
      }),
      false,
    );
  });

  it("does not match errors with an unrelated top-level code", () => {
    assert.equal(
      isMissingAdvantageAudienceFlagError({ code: 4, message: "Application request limit reached" }),
      false,
    );
  });

  it("does not match null/undefined/non-object input", () => {
    assert.equal(isMissingAdvantageAudienceFlagError(null), false);
    assert.equal(isMissingAdvantageAudienceFlagError(undefined), false);
    assert.equal(isMissingAdvantageAudienceFlagError("some string"), false);
  });
});
