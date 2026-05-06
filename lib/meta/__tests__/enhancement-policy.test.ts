/**
 * Policy evaluation for Meta creative enhancement detector.
 *
 * Regression context (manual QA still applies on full pages):
 * - 4theFans / Louder / Junction 2 internal reports should keep HealthBadge
 *   behaviour on Active creatives; enhancement banner is additive (amber).
 * - BB26-KAYODE brand_campaign: banner stays hidden when this API returns
 *   total_open === 0 for the scoped eventIds query.
 * - Leeds FA Cup (4theFans): confirm venue report + client dashboard render.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateCreativeFeatures,
  getPolicyTier,
  HEAVY_WEIGHT_FEATURE_KEYS,
  isTrackedOnlyFlagSet,
  POLICY_BLOCKED_FEATURES,
  POLICY_TRACKED_FEATURES,
} from "../enhancement-policy.ts";

describe("evaluateCreativeFeatures", () => {
  it("returns empty when spec missing", () => {
    assert.deepEqual(evaluateCreativeFeatures(undefined), {
      flagged: {},
      severityScore: 0,
    });
  });

  it("scores standard_enhancements OPT_IN at 3", () => {
    const r = evaluateCreativeFeatures({
      standard_enhancements: { enroll_status: "OPT_IN" },
    });
    assert.equal(r.severityScore, 3);
    assert.equal(r.flagged.standard_enhancements, "OPT_IN");
  });

  it("flags inline_comment OPT_IN but severity stays 0 (tracked tier)", () => {
    const r = evaluateCreativeFeatures({
      inline_comment: { enroll_status: "OPT_IN" },
    });
    assert.equal(r.severityScore, 0);
    assert.equal(r.flagged.inline_comment, "OPT_IN");
    assert.ok(isTrackedOnlyFlagSet(r.flagged));
  });

  it("mixed blocked + tracked uses blocked-only severity", () => {
    const r = evaluateCreativeFeatures({
      inline_comment: { enroll_status: "OPT_IN" },
      text_optimizations: { enroll_status: "OPT_IN" },
    });
    assert.equal(r.severityScore, 3);
    assert.equal(r.flagged.inline_comment, "OPT_IN");
    assert.equal(r.flagged.text_optimizations, "OPT_IN");
    assert.equal(isTrackedOnlyFlagSet(r.flagged), false);
  });

  it("treats DEFAULT_OPT_IN as violation", () => {
    const r = evaluateCreativeFeatures({
      text_optimizations: { enroll_status: "DEFAULT_OPT_IN" },
    });
    assert.equal(r.flagged.text_optimizations, "DEFAULT_OPT_IN");
    assert.equal(r.severityScore, 3);
  });

  it("does not flag OPT_OUT", () => {
    const r = evaluateCreativeFeatures({
      standard_enhancements: { enroll_status: "OPT_OUT" },
    });
    assert.equal(Object.keys(r.flagged).length, 0);
  });
});

describe("getPolicyTier", () => {
  it("classifies blocked and tracked keys", () => {
    assert.equal(getPolicyTier("standard_enhancements"), "BLOCKED");
    assert.equal(getPolicyTier("inline_comment"), "TRACKED");
    assert.equal(getPolicyTier("unknown_feature_xyz"), null);
  });
});

describe("enhancement policy labels", () => {
  it("marks heavy-weight keys for dashboard pills", () => {
    assert.ok(HEAVY_WEIGHT_FEATURE_KEYS.has("standard_enhancements"));
    assert.ok(HEAVY_WEIGHT_FEATURE_KEYS.has("text_optimizations"));
  });

  it("keeps a non-trivial blocked-feature list", () => {
    assert.ok(POLICY_BLOCKED_FEATURES.length > 10);
  });

  it("lists tracked features separately", () => {
    assert.ok(POLICY_TRACKED_FEATURES.includes("inline_comment"));
  });
});
