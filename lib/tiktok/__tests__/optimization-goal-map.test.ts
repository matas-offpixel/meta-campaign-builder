import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  resolveGoalInfo,
  resolveRollupCountsFromMetrics,
  FALLBACK_GOAL_INFO,
} from "../optimization-goal-map.ts";

describe("resolveGoalInfo", () => {
  it("maps COMPLETE_REGISTRATION to the registration metric and label", () => {
    const info = resolveGoalInfo("COMPLETE_REGISTRATION");
    assert.equal(info.metricKey, "complete_registration");
    assert.equal(info.label, "Registration");
  });

  it("maps COMPLETE_PAYMENT to the purchase metric and label", () => {
    const info = resolveGoalInfo("COMPLETE_PAYMENT");
    assert.equal(info.metricKey, "complete_payment");
    assert.equal(info.label, "Purchase");
  });

  it("maps ADD_TO_CART", () => {
    const info = resolveGoalInfo("ADD_TO_CART");
    assert.equal(info.metricKey, "add_to_cart");
    assert.equal(info.label, "Add to Cart");
  });

  it("maps INITIATE_CHECKOUT", () => {
    const info = resolveGoalInfo("INITIATE_CHECKOUT");
    assert.equal(info.metricKey, "initiate_checkout");
    assert.equal(info.label, "Initiate Checkout");
  });

  it("maps ADD_TO_WISHLIST", () => {
    const info = resolveGoalInfo("ADD_TO_WISHLIST");
    assert.equal(info.metricKey, "add_to_wishlist");
    assert.equal(info.label, "Add to Wishlist");
  });

  it("maps LEAD to the generic conversion metric", () => {
    const info = resolveGoalInfo("LEAD");
    assert.equal(info.metricKey, "conversion");
    assert.equal(info.label, "Lead");
  });

  it("maps CONVERT (generic) to the conversion metric", () => {
    const info = resolveGoalInfo("CONVERT");
    assert.equal(info.metricKey, "conversion");
    assert.equal(info.label, "Conversion");
  });

  it("maps REACH to the fallback view_content metric", () => {
    const info = resolveGoalInfo("REACH");
    assert.equal(info.metricKey, "view_content");
  });

  it("maps VIDEO_VIEW to view_content fallback", () => {
    const info = resolveGoalInfo("VIDEO_VIEW");
    assert.equal(info.metricKey, "view_content");
  });

  it("maps CLICK to view_content fallback", () => {
    const info = resolveGoalInfo("CLICK");
    assert.equal(info.metricKey, "view_content");
  });

  it("is case-insensitive — lowercased value resolves correctly", () => {
    const info = resolveGoalInfo("complete_payment");
    assert.equal(info.metricKey, "complete_payment");
    assert.equal(info.label, "Purchase");
  });

  it("returns fallback for an unrecognised custom-event goal", () => {
    const info = resolveGoalInfo("PIXEL_EVENT_CUSTOM_VENUE_INTEREST");
    assert.deepEqual(info, FALLBACK_GOAL_INFO);
  });

  it("returns fallback for null", () => {
    assert.deepEqual(resolveGoalInfo(null), FALLBACK_GOAL_INFO);
  });

  it("returns fallback for undefined", () => {
    assert.deepEqual(resolveGoalInfo(undefined), FALLBACK_GOAL_INFO);
  });

  it("maps VIEW_CONTENT with dual rollup keys (conversion + view_content)", () => {
    const info = resolveGoalInfo("VIEW_CONTENT");
    assert.equal(info.resultKind, "engagement");
    assert.equal(info.rollupConversionKey, "conversion");
    assert.equal(info.rollupEngagementKey, "view_content");
    assert.equal(info.resultsLabel, "Conversions");
  });

  it("maps CONVERT as conversion-style", () => {
    const info = resolveGoalInfo("CONVERT");
    assert.equal(info.resultKind, "conversion");
    assert.equal(info.resultsLabel, "Conversions");
  });
});

describe("resolveRollupCountsFromMetrics — Ironworks fixture", () => {
  // optimization_goal is never returned at campaign level, so all three IRWOHD
  // campaigns arrive with an empty goal; objective_type is the real signal.
  it("LEAD_GENERATION campaign: conversion → results, engagement 0", () => {
    const counts = resolveRollupCountsFromMetrics(
      "",
      { spend: "530.70", conversion: "109", view_content: "0", follows: "116" },
      "LEAD_GENERATION",
    );
    assert.equal(counts.conversionResults, 109);
    assert.equal(counts.engagementResults, 0);
  });

  it("ENGAGEMENT campaign: follows → engagement, conversion 0 (view_content is 0)", () => {
    const counts = resolveRollupCountsFromMetrics(
      "",
      { spend: "137.37", conversion: "0", view_content: "0", follows: "257" },
      "ENGAGEMENT",
    );
    assert.equal(counts.engagementResults, 257);
    assert.equal(counts.conversionResults, 0);
  });

  it("ENGAGEMENT campaign falls back to real_time_conversion for incidental results", () => {
    const counts = resolveRollupCountsFromMetrics(
      "",
      { conversion: "0", real_time_conversion: "4", follows: "30" },
      "ENGAGEMENT",
    );
    assert.equal(counts.conversionResults, 4);
    assert.equal(counts.engagementResults, 30);
  });

  it("no objective_type preserves prior fallback behavior (conversion + view_content)", () => {
    const counts = resolveRollupCountsFromMetrics("", {
      conversion: "65",
      view_content: "0",
      follows: "73",
    });
    assert.equal(counts.conversionResults, 65);
    assert.equal(counts.engagementResults, 0);
  });
});
