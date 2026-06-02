import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  resolveGoalInfo,
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

  it("maps VIEW_CONTENT as engagement-style with correct labels", () => {
    const info = resolveGoalInfo("VIEW_CONTENT");
    assert.equal(info.resultKind, "engagement");
    assert.equal(info.resultsLabel, "View Content events");
    assert.equal(info.costPerLabel, "Cost per View Content");
  });

  it("maps CONVERT as conversion-style", () => {
    const info = resolveGoalInfo("CONVERT");
    assert.equal(info.resultKind, "conversion");
    assert.equal(info.resultsLabel, "Conversions");
  });
});
