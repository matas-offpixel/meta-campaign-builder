/**
 * Tests for resolveAdSetDestinationType / buildAdSetPayload destination_type
 * (Traffic Edit-UI "Facebook event" mis-default fix).
 *
 * Run: node --test lib/meta/__tests__/adset-destination-type.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAdSetPayload,
  resolveAdSetDestinationType,
} from "../adset.ts";
import type {
  AdSetSuggestion,
  AudienceSettings,
  BudgetScheduleSettings,
  CampaignObjective,
  OptimisationGoal,
} from "../../types.ts";

function makeAdSet(overrides: Partial<AdSetSuggestion> = {}): AdSetSuggestion {
  return {
    id: "s1",
    name: "Test Ad Set",
    sourceType: "blank",
    sourceId: "",
    sourceName: "Blank",
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
  savedAudiences: [],
  selectedPagesLookalikeGroups: [],
} as unknown as AudienceSettings;

const schedule: BudgetScheduleSettings = {
  startDate: "",
  endDate: "",
} as unknown as BudgetScheduleSettings;

function build(
  objective: CampaignObjective,
  goal: OptimisationGoal,
) {
  return buildAdSetPayload(
    makeAdSet(),
    "cam_001",
    emptyAudiences,
    schedule,
    goal,
    objective,
  );
}

describe("resolveAdSetDestinationType", () => {
  it("returns WEBSITE for every traffic optimisation goal (LPV / link clicks / reach / impressions)", () => {
    for (const goal of [
      "landing_page_views",
      "link_clicks",
      "reach",
      "impressions",
    ] as OptimisationGoal[]) {
      assert.equal(
        resolveAdSetDestinationType("traffic", goal),
        "WEBSITE",
        `traffic + ${goal}`,
      );
    }
  });

  it("returns WEBSITE for traffic even when the draft still carries a stale OFFSITE_CONVERSIONS-style goal", () => {
    // resolveOptimisationGoal would rewrite conversions → landing_page_views
    // before destination_type is resolved, but the helper itself is
    // objective-gated: any traffic objective is WEBSITE.
    assert.equal(resolveAdSetDestinationType("traffic", "conversions"), "WEBSITE");
  });

  it("returns WEBSITE for registration (OUTCOME_LEADS website Sign Up path, not Instant Forms / LEAD)", () => {
    assert.equal(resolveAdSetDestinationType("registration", "conversions"), "WEBSITE");
    assert.equal(
      resolveAdSetDestinationType("registration", "complete_registration"),
      "WEBSITE",
    );
  });

  it("returns undefined for awareness / engagement / purchase (Meta defaults correctly)", () => {
    assert.equal(resolveAdSetDestinationType("awareness", "reach"), undefined);
    assert.equal(resolveAdSetDestinationType("awareness", "video_views"), undefined);
    assert.equal(resolveAdSetDestinationType("engagement", "post_engagement"), undefined);
    assert.equal(resolveAdSetDestinationType("engagement", "video_views"), undefined);
    assert.equal(resolveAdSetDestinationType("purchase", "conversions"), undefined);
    assert.equal(resolveAdSetDestinationType("purchase", "value"), undefined);
  });
});

describe("buildAdSetPayload — destination_type", () => {
  it("sets destination_type=WEBSITE for OUTCOME_TRAFFIC + LANDING_PAGE_VIEWS", () => {
    const payload = build("traffic", "landing_page_views");
    assert.equal(payload.optimization_goal, "LANDING_PAGE_VIEWS");
    assert.equal(payload.destination_type, "WEBSITE");
  });

  it("sets destination_type=WEBSITE for OUTCOME_TRAFFIC + LINK_CLICKS", () => {
    const payload = build("traffic", "link_clicks");
    assert.equal(payload.optimization_goal, "LINK_CLICKS");
    assert.equal(payload.destination_type, "WEBSITE");
  });

  it("sets destination_type=WEBSITE for registration (OUTCOME_LEADS)", () => {
    const payload = build("registration", "conversions");
    assert.equal(payload.destination_type, "WEBSITE");
  });

  it("OMITS destination_type for awareness", () => {
    const payload = build("awareness", "reach");
    assert.equal(payload.destination_type, undefined);
    assert.ok(!("destination_type" in payload), "key must be absent, not null");
  });

  it("OMITS destination_type for engagement", () => {
    const payload = build("engagement", "post_engagement");
    assert.equal(payload.destination_type, undefined);
    assert.ok(!("destination_type" in payload));
  });

  it("OMITS destination_type for purchase", () => {
    const payload = build("purchase", "conversions");
    assert.equal(payload.destination_type, undefined);
  });

  it("still sets WEBSITE after correcting a stale traffic+conversions draft goal", () => {
    // Stale draft: objective=traffic, goal=conversions → corrected to LPV,
    // destination_type must still be WEBSITE (the Modern Funktion class of bug).
    const payload = build("traffic", "conversions");
    assert.equal(payload.optimization_goal, "LANDING_PAGE_VIEWS");
    assert.equal(payload.destination_type, "WEBSITE");
  });
});
