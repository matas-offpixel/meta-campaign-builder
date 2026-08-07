/**
 * Tests for the "+ Blank ad set" refinement (Step 5 refinement pack,
 * operator ask 2026-08-07): an ad set with NO audience source, always
 * launching with Advantage+ Audience ON.
 *
 * Run: node --test lib/meta/__tests__/blank-adset.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAdSetPayload, buildMetaTargeting, hasAudienceTargeting, buildEmptyTargetingReason } from "../adset.ts";
import type { AdSetSuggestion, AudienceSettings, BudgetScheduleSettings } from "../../types.ts";

function makeBlankAdSet(overrides: Partial<AdSetSuggestion> = {}): AdSetSuggestion {
  return {
    id: "s_blank",
    name: "Blank (no audience)",
    sourceType: "blank",
    sourceId: "",
    sourceName: "No audience source",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 10,
    advantagePlus: true,
    enabled: true,
    ...overrides,
  } as AdSetSuggestion;
}

const emptyAudiences: AudienceSettings = {
  interestGroups: [],
  customAudienceGroups: [],
  pageGroups: [],
  savedAudiences: { audienceIds: [] },
  selectedPagesLookalikeGroups: [],
} as unknown as AudienceSettings;

const schedule: BudgetScheduleSettings = {
  startDate: "",
  endDate: "",
} as unknown as BudgetScheduleSettings;

const CAMPAIGN_ID = "cam_001";
const OBJ = "traffic" as const;
const GOAL = "link_clicks" as const;

function build(adSet: AdSetSuggestion) {
  return buildAdSetPayload(adSet, CAMPAIGN_ID, emptyAudiences, schedule, GOAL, OBJ);
}

describe("blank ad set — buildMetaTargeting / buildAdSetPayload", () => {
  it("never sets custom_audiences or interests", () => {
    const payload = build(makeBlankAdSet());
    assert.equal(payload.targeting.custom_audiences, undefined);
    assert.equal(payload.targeting.interests, undefined);
  });

  it("forces targeting_automation.advantage_audience = 1 even when advantagePlus is (incorrectly) false", () => {
    const payload = build(makeBlankAdSet({ advantagePlus: false }));
    assert.equal(payload.targeting.targeting_automation?.advantage_audience, 1);
    // Advantage+ shape: no top-level strict age, age sent as individual_setting suggestion.
    assert.equal(payload.targeting.age_min, undefined);
    assert.equal(payload.targeting.age_max, undefined);
    assert.deepEqual(payload.targeting.targeting_automation?.individual_setting, {
      age_min: 18,
      age_max: 65,
    });
  });

  it("also forces Advantage+ when advantagePlus is (correctly) true — same result either way", () => {
    const payload = build(makeBlankAdSet({ advantagePlus: true }));
    assert.equal(payload.targeting.targeting_automation?.advantage_audience, 1);
  });

  it("defaults geo to GB when no geoLocations/locationGroupId set, like any other ad set", () => {
    const payload = build(makeBlankAdSet());
    assert.deepEqual(payload.targeting.geo_locations, { countries: ["GB"] });
  });
});

describe("blank ad set — hard targeting validation (launch-campaign preflight)", () => {
  it("hasAudienceTargeting returns true for a blank ad set even with fully empty targeting", () => {
    const targeting = buildMetaTargeting(makeBlankAdSet(), emptyAudiences);
    assert.equal(targeting.custom_audiences, undefined);
    assert.equal(targeting.interests, undefined);
    assert.equal(hasAudienceTargeting(targeting, makeBlankAdSet()), true);
  });

  it("REGRESSION: without the adSet argument, hasAudienceTargeting still treats truly-empty targeting as invalid", () => {
    // Guards against ever reverting to unconditionally allowing empty targeting.
    assert.equal(hasAudienceTargeting({ geo_locations: { countries: ["GB"] } }), false);
  });

  it("a non-blank ad set with empty targeting is still rejected (no accidental broadening)", () => {
    const targeting = buildMetaTargeting(
      { ...makeBlankAdSet(), sourceType: "interest_group", sourceId: "missing_group" },
      emptyAudiences,
    );
    assert.equal(hasAudienceTargeting(targeting, { ...makeBlankAdSet(), sourceType: "interest_group" }), false);
  });

  it("buildEmptyTargetingReason has a defensive explainer for blank (unreachable in practice)", () => {
    const reason = buildEmptyTargetingReason(makeBlankAdSet(), emptyAudiences);
    assert.match(reason, /intentionally blank/i);
  });
});
