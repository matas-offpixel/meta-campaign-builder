/**
 * Tests for lib/optimisation/live-metric.ts — task #120 PR A.
 *
 * Run: node --test lib/optimisation/__tests__/live-metric.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RuleTimeWindow } from "../../types.ts";
import { resolvePrimaryLiveMetric, windowToDatePreset, type AdSetInsightMetrics } from "../live-metric.ts";

/**
 * Meta Insights `date_preset` allow-list, copied from Graph error (#100)
 * captured live at 2026-08-18 09:29 UTC when `windowToDatePreset("24h")`
 * returned the invalid `"last_1d"` and the optimisation-tick shadow cron
 * errored every run with zero decisions (task #120 / IPC v4). Keep this
 * list in sync with Meta's error message — it is the source of truth that
 * stops a future RuleTimeWindow addition from reintroducing an invalid
 * preset.
 */
const META_VALID_DATE_PRESETS = new Set([
  "today",
  "yesterday",
  "this_month",
  "last_month",
  "this_quarter",
  "maximum",
  "data_maximum",
  "last_3d",
  "last_7d",
  "last_14d",
  "last_28d",
  "last_30d",
  "last_90d",
  "last_week_mon_sun",
  "last_week_sun_sat",
  "last_quarter",
  "last_year",
  "this_week_mon_today",
  "this_week_sun_today",
  "this_year",
]);

/** Exhaustive RuleTimeWindow list — TS fails if the union grows without an update. */
const ALL_RULE_TIME_WINDOWS = ["24h", "3d", "7d"] as const satisfies readonly RuleTimeWindow[];

function metrics(overrides: Partial<AdSetInsightMetrics> = {}): AdSetInsightMetrics {
  return {
    impressions: 1000,
    cpc: null,
    cpm: null,
    ctr: null,
    costPerActionType: {},
    actionCountByType: {},
    ...overrides,
  };
}

describe("resolvePrimaryLiveMetric", () => {
  it("registration objective resolves cpr from cost_per_action_type, resultCount from actions", () => {
    const result = resolvePrimaryLiveMetric(
      "registration",
      metrics({
        costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 1.25 },
        actionCountByType: { "offsite_conversion.fb_pixel_complete_registration": 7 },
      }),
      "24h",
    );
    assert.deepEqual(result, { name: "cpr", value: 1.25, window: "24h", resultCount: 7 });
  });

  it("resultCount is null when actions has no matching entry for the resolved action_type", () => {
    const result = resolvePrimaryLiveMetric(
      "registration",
      metrics({
        costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 1.25 },
        actionCountByType: {}, // no matching entry
      }),
      "24h",
    );
    assert.equal(result?.resultCount, null);
  });

  it("registration objective falls back through candidate action types in order", () => {
    const result = resolvePrimaryLiveMetric(
      "registration",
      metrics({
        costPerActionType: { complete_registration: 2.5 },
        actionCountByType: { complete_registration: 3 },
      }),
      "24h",
    );
    assert.deepEqual(result, { name: "cpr", value: 2.5, window: "24h", resultCount: 3 });
  });

  it("registration objective with no matching action type returns null (not 0)", () => {
    const result = resolvePrimaryLiveMetric("registration", metrics({ costPerActionType: {} }), "24h");
    assert.equal(result, null);
  });

  it("traffic objective resolves lpv_cost from landing_page_view, resultCount null (direct-field style)", () => {
    const result = resolvePrimaryLiveMetric(
      "traffic",
      metrics({
        costPerActionType: { landing_page_view: 0.3 },
        actionCountByType: { landing_page_view: 42 },
      }),
      "24h",
    );
    // lpv_cost resolved from ACTION_TYPE_CANDIDATES, not DIRECT_FIELD —
    // resultCount comes from actionCountByType for it.
    assert.equal(result?.name, "lpv_cost");
    assert.equal(result?.value, 0.3);
    assert.equal(result?.resultCount, 42);
  });

  it("purchase objective resolves cpa (never the secondary roas metric)", () => {
    const result = resolvePrimaryLiveMetric(
      "purchase",
      metrics({ costPerActionType: { purchase: 15 }, actionCountByType: { purchase: 2 } }),
      "3d",
    );
    assert.deepEqual(result, { name: "cpa", value: 15, window: "3d", resultCount: 2 });
  });

  it("awareness objective resolves cpm directly — resultCount is null", () => {
    const result = resolvePrimaryLiveMetric("awareness", metrics({ cpm: 4.2 }), "24h");
    assert.deepEqual(result, { name: "cpm", value: 4.2, window: "24h", resultCount: null });
  });

  it("engagement objective resolves cpc directly — resultCount is null", () => {
    const result = resolvePrimaryLiveMetric("engagement", metrics({ cpc: 0.08 }), "24h");
    assert.deepEqual(result, { name: "cpc", value: 0.08, window: "24h", resultCount: null });
  });

  it("direct-field metric with a null value returns null", () => {
    const result = resolvePrimaryLiveMetric("engagement", metrics({ cpc: null }), "24h");
    assert.equal(result, null);
  });
});

describe("windowToDatePreset", () => {
  it("maps every RuleTimeWindow to a Meta-valid date_preset (2026-08-18 last_1d incident)", () => {
    for (const window of ALL_RULE_TIME_WINDOWS) {
      const preset = windowToDatePreset(window);
      assert.ok(
        META_VALID_DATE_PRESETS.has(preset),
        `windowToDatePreset(${JSON.stringify(window)}) → ${JSON.stringify(preset)} is not in Meta's date_preset allow-list`,
      );
    }
    assert.equal(windowToDatePreset("24h"), "yesterday");
    assert.equal(windowToDatePreset("3d"), "last_3d");
    assert.equal(windowToDatePreset("7d"), "last_7d");
  });
});
