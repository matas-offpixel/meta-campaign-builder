/**
 * Tests for lib/optimisation/live-metric.ts — task #120 PR A.
 *
 * Run: node --test lib/optimisation/__tests__/live-metric.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolvePrimaryLiveMetric, windowToDatePreset, type AdSetInsightMetrics } from "../live-metric.ts";

function metrics(overrides: Partial<AdSetInsightMetrics> = {}): AdSetInsightMetrics {
  return {
    impressions: 1000,
    cpc: null,
    cpm: null,
    ctr: null,
    costPerActionType: {},
    ...overrides,
  };
}

describe("resolvePrimaryLiveMetric", () => {
  it("registration objective resolves cpr from cost_per_action_type", () => {
    const result = resolvePrimaryLiveMetric(
      "registration",
      metrics({ costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 1.25 } }),
      "24h",
    );
    assert.deepEqual(result, { name: "cpr", value: 1.25, window: "24h" });
  });

  it("registration objective falls back through candidate action types in order", () => {
    const result = resolvePrimaryLiveMetric(
      "registration",
      metrics({ costPerActionType: { complete_registration: 2.5 } }),
      "24h",
    );
    assert.deepEqual(result, { name: "cpr", value: 2.5, window: "24h" });
  });

  it("registration objective with no matching action type returns null (not 0)", () => {
    const result = resolvePrimaryLiveMetric("registration", metrics({ costPerActionType: {} }), "24h");
    assert.equal(result, null);
  });

  it("traffic objective resolves lpv_cost from landing_page_view", () => {
    const result = resolvePrimaryLiveMetric(
      "traffic",
      metrics({ costPerActionType: { landing_page_view: 0.3 } }),
      "24h",
    );
    assert.deepEqual(result, { name: "lpv_cost", value: 0.3, window: "24h" });
  });

  it("purchase objective resolves cpa (never the secondary roas metric)", () => {
    const result = resolvePrimaryLiveMetric(
      "purchase",
      metrics({ costPerActionType: { purchase: 15 } }),
      "3d",
    );
    assert.deepEqual(result, { name: "cpa", value: 15, window: "3d" });
  });

  it("awareness objective resolves cpm directly (no action_type lookup)", () => {
    const result = resolvePrimaryLiveMetric("awareness", metrics({ cpm: 4.2 }), "24h");
    assert.deepEqual(result, { name: "cpm", value: 4.2, window: "24h" });
  });

  it("engagement objective resolves cpc directly", () => {
    const result = resolvePrimaryLiveMetric("engagement", metrics({ cpc: 0.08 }), "24h");
    assert.deepEqual(result, { name: "cpc", value: 0.08, window: "24h" });
  });

  it("direct-field metric with a null value returns null", () => {
    const result = resolvePrimaryLiveMetric("engagement", metrics({ cpc: null }), "24h");
    assert.equal(result, null);
  });
});

describe("windowToDatePreset", () => {
  it("maps every RuleTimeWindow to its Meta date_preset", () => {
    assert.equal(windowToDatePreset("24h"), "last_1d");
    assert.equal(windowToDatePreset("3d"), "last_3d");
    assert.equal(windowToDatePreset("7d"), "last_7d");
  });
});
