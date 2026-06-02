/**
 * lib/tiktok/__tests__/insights-metric-build.test.ts
 *
 * Unit tests for buildMetricsForCampaign() — verifies that each
 * optimization goal gets exactly the right metric list, no more and no less.
 *
 * Key invariants:
 *   - video_play_actions is always included (NOT video_play)
 *   - video_play is NEVER included
 *   - Goal-specific pixel metrics are included only for matching goals
 *   - BASE_METRICS are always present regardless of goal
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMetricsForCampaign,
  BASE_METRICS,
} from "../insights.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const baseSet = new Set<string>(BASE_METRICS);

function assertContains(metrics: string[], field: string): void {
  assert.ok(metrics.includes(field), `Metric list should include '${field}': [${metrics.join(", ")}]`);
}

function assertNotContains(metrics: string[], field: string): void {
  assert.ok(!metrics.includes(field), `Metric list should NOT include '${field}' (invalid field rejected by TikTok API): [${metrics.join(", ")}]`);
}

// ─── BASE_METRICS invariants ──────────────────────────────────────────────────

describe("BASE_METRICS", () => {
  it("contains video_play_actions (correct field name)", () => {
    assert.ok(baseSet.has("video_play_actions"), "BASE_METRICS must contain video_play_actions");
  });

  it("does NOT contain video_play (deprecated field that causes API rejection)", () => {
    assert.ok(!baseSet.has("video_play"), "BASE_METRICS must NOT contain video_play");
  });

  it("contains all universal spend + reach metrics", () => {
    for (const field of ["spend", "impressions", "reach", "clicks", "ctr", "cpm"]) {
      assert.ok(baseSet.has(field), `BASE_METRICS should include '${field}'`);
    }
  });

  it("contains generic conversion metrics (valid for all objectives)", () => {
    for (const field of ["conversion", "cost_per_conversion", "conversion_rate"]) {
      assert.ok(baseSet.has(field), `BASE_METRICS should include '${field}'`);
    }
  });

  it("contains view_content (fallback metric for awareness/unknown goals)", () => {
    assert.ok(baseSet.has("view_content"), "BASE_METRICS should include view_content as fallback");
  });
});

// ─── buildMetricsForCampaign ──────────────────────────────────────────────────

describe("buildMetricsForCampaign", () => {
  it("always includes all BASE_METRICS", () => {
    const goals = [
      "COMPLETE_REGISTRATION", "COMPLETE_PAYMENT", "ADD_TO_CART",
      "LEAD", "REACH", null, undefined, "UNKNOWN_FUTURE_GOAL",
    ];
    for (const goal of goals) {
      const metrics = buildMetricsForCampaign(goal);
      for (const base of BASE_METRICS) {
        assert.ok(
          metrics.includes(base),
          `Goal ${goal}: metric list should include base metric '${base}'`,
        );
      }
    }
  });

  it("never includes video_play (deprecated field) for ANY goal", () => {
    const goals = [
      "COMPLETE_REGISTRATION", "COMPLETE_PAYMENT", "VIDEO_VIEW",
      "REACH", "LEAD", null, undefined,
    ];
    for (const goal of goals) {
      assertNotContains(buildMetricsForCampaign(goal), "video_play");
    }
  });

  it("COMPLETE_REGISTRATION: includes registration-specific metrics", () => {
    const metrics = buildMetricsForCampaign("COMPLETE_REGISTRATION");
    assertContains(metrics, "complete_registration");
    assertContains(metrics, "cost_per_complete_registration");
  });

  it("COMPLETE_REGISTRATION: does NOT include add_to_cart (wrong goal)", () => {
    const metrics = buildMetricsForCampaign("COMPLETE_REGISTRATION");
    assertNotContains(metrics, "add_to_cart");
    assertNotContains(metrics, "cost_per_add_to_cart");
  });

  it("COMPLETE_PAYMENT: includes payment-specific metrics", () => {
    const metrics = buildMetricsForCampaign("COMPLETE_PAYMENT");
    assertContains(metrics, "complete_payment");
    assertContains(metrics, "cost_per_complete_payment");
    assertContains(metrics, "complete_payment_roas");
  });

  it("COMPLETE_PAYMENT: does NOT include complete_registration", () => {
    const metrics = buildMetricsForCampaign("COMPLETE_PAYMENT");
    assertNotContains(metrics, "complete_registration");
    assertNotContains(metrics, "cost_per_complete_registration");
  });

  it("ADD_TO_CART: includes cart-specific metrics", () => {
    const metrics = buildMetricsForCampaign("ADD_TO_CART");
    assertContains(metrics, "add_to_cart");
    assertContains(metrics, "cost_per_add_to_cart");
  });

  it("INITIATE_CHECKOUT: includes checkout-specific metrics", () => {
    const metrics = buildMetricsForCampaign("INITIATE_CHECKOUT");
    assertContains(metrics, "initiate_checkout");
    assertContains(metrics, "cost_per_initiate_checkout");
  });

  it("ADD_TO_WISHLIST: includes wishlist-specific metrics", () => {
    const metrics = buildMetricsForCampaign("ADD_TO_WISHLIST");
    assertContains(metrics, "add_to_wishlist");
    assertContains(metrics, "cost_per_add_to_wishlist");
  });

  it("LEAD goal: only BASE_METRICS (uses generic conversion metrics)", () => {
    const metrics = buildMetricsForCampaign("LEAD");
    // LEAD uses 'conversion' from BASE_METRICS — no goal-specific extras needed
    assertContains(metrics, "conversion");
    assertNotContains(metrics, "complete_registration");
    assertNotContains(metrics, "add_to_cart");
    assertNotContains(metrics, "complete_payment");
    assert.deepEqual(metrics, buildMetricsForCampaign("LEAD"),
      "LEAD metrics should equal base metrics only");
  });

  it("VIEW_CONTENT: includes complete_registration for signup rollup", () => {
    const metrics = buildMetricsForCampaign("VIEW_CONTENT");
    assertContains(metrics, "complete_registration");
    assertContains(metrics, "view_content");
    assertContains(metrics, "conversion");
  });

  it("REACH goal: only BASE_METRICS (awareness — uses view_content fallback)", () => {
    const metrics = buildMetricsForCampaign("REACH");
    assertContains(metrics, "view_content");
    assertNotContains(metrics, "complete_registration");
    assertNotContains(metrics, "add_to_cart");
  });

  it("null/undefined goal: only BASE_METRICS (safe universal set)", () => {
    const metricsNull = buildMetricsForCampaign(null);
    const metricsUndefined = buildMetricsForCampaign(undefined);
    assert.deepEqual(metricsNull, metricsUndefined);
    assertNotContains(metricsNull, "complete_registration");
    assertNotContains(metricsNull, "add_to_cart");
  });

  it("goal matching is case-insensitive", () => {
    const upper = buildMetricsForCampaign("COMPLETE_REGISTRATION");
    const lower = buildMetricsForCampaign("complete_registration");
    const mixed = buildMetricsForCampaign("Complete_Registration");
    assert.deepEqual(upper, lower);
    assert.deepEqual(upper, mixed);
  });

  it("Ironworks scenario: LEAD_GENERATION goal uses only BASE_METRICS (no rejected fields)", () => {
    // IRWOHD campaigns use LEAD_GENERATION objective.
    // The exact TikTok goal string returned by /campaign/get/ for these campaigns.
    const metrics = buildMetricsForCampaign("LEAD_GENERATION");
    // Must NOT include the fields that caused the API error in PR #497:
    assertNotContains(metrics, "video_play");                      // wrong field name
    assertNotContains(metrics, "add_to_cart");                     // wrong objective
    assertNotContains(metrics, "complete_registration");           // wrong objective
    assertNotContains(metrics, "cost_per_add_to_cart");            // wrong objective
    assertNotContains(metrics, "cost_per_complete_registration");  // wrong objective
    // Must include the fields needed for LEAD_GENERATION:
    assertContains(metrics, "conversion");
    assertContains(metrics, "video_play_actions");
  });
});
