/**
 * Tests for resolveAdSetDestinationType / buildAdSetPayload destination_type
 * (Traffic Edit-UI "Facebook event" mis-default fix — PR #770) and the
 * existing-post boost compatibility guard (task #132 / subcode 1815676).
 *
 * Run: node --test lib/meta/__tests__/adset-destination-type.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAdSetPayload,
  resolveAdSetDestinationType,
  adSetHasBoostCreative,
  findAdSetsWithMixedBoostAndLinkCreatives,
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
  hasBoostCreative?: boolean,
) {
  return buildAdSetPayload(
    makeAdSet(),
    "cam_001",
    emptyAudiences,
    schedule,
    goal,
    objective,
    undefined,
    undefined,
    undefined,
    hasBoostCreative,
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

  it("returns WEBSITE for registration (OUTCOME_LEADS website Sign Up path, not Instant Forms / LEAD)", () => {
    assert.equal(resolveAdSetDestinationType("registration", "conversions"), "WEBSITE");
    assert.equal(
      resolveAdSetDestinationType("registration", "complete_registration"),
      "WEBSITE",
    );
  });

  it("returns undefined for awareness / engagement / purchase (Meta defaults correctly)", () => {
    assert.equal(resolveAdSetDestinationType("awareness", "reach"), undefined);
    assert.equal(resolveAdSetDestinationType("engagement", "post_engagement"), undefined);
    assert.equal(resolveAdSetDestinationType("purchase", "conversions"), undefined);
  });

  it("OMITS WEBSITE when hasBoostCreative is true (task #132 / subcode 1815676)", () => {
    assert.equal(resolveAdSetDestinationType("traffic", "landing_page_views", true), undefined);
    assert.equal(resolveAdSetDestinationType("registration", "conversions", true), undefined);
  });
});

describe("buildAdSetPayload — destination_type", () => {
  it("sets destination_type=WEBSITE for OUTCOME_TRAFFIC + all-link creatives", () => {
    const payload = build("traffic", "landing_page_views", false);
    assert.equal(payload.optimization_goal, "LANDING_PAGE_VIEWS");
    assert.equal(payload.destination_type, "WEBSITE");
  });

  it("sets destination_type=WEBSITE for OUTCOME_TRAFFIC + LINK_CLICKS", () => {
    const payload = build("traffic", "link_clicks");
    assert.equal(payload.optimization_goal, "LINK_CLICKS");
    assert.equal(payload.destination_type, "WEBSITE");
  });

  it("OMITS destination_type for traffic when any boost creative is assigned", () => {
    const payload = build("traffic", "landing_page_views", true);
    assert.equal(payload.destination_type, undefined);
    assert.ok(!("destination_type" in payload), "key must be absent so Meta accepts object_story_id boosts");
  });

  it("OMITS destination_type for registration when a boost creative is assigned", () => {
    const payload = build("registration", "conversions", true);
    assert.equal(payload.destination_type, undefined);
  });

  it("OMITS destination_type for awareness / engagement / purchase", () => {
    assert.equal(build("awareness", "reach").destination_type, undefined);
    assert.equal(build("engagement", "post_engagement").destination_type, undefined);
    assert.equal(build("purchase", "conversions").destination_type, undefined);
  });
});

describe("adSetHasBoostCreative", () => {
  const creatives = [
    { id: "cr_link", sourceType: "new" },
    { id: "cr_boost", sourceType: "existing_post" },
  ];

  it("returns true when the ad set has an existing_post creative assigned", () => {
    assert.equal(
      adSetHasBoostCreative("as1", { as1: ["cr_link", "cr_boost"] }, creatives),
      true,
    );
  });

  it("returns false when every assigned creative is a new/link creative", () => {
    assert.equal(
      adSetHasBoostCreative("as1", { as1: ["cr_link"] }, creatives),
      false,
    );
  });

  it("returns false when the ad set has no assignments", () => {
    assert.equal(adSetHasBoostCreative("as1", {}, creatives), false);
  });
});

describe("findAdSetsWithMixedBoostAndLinkCreatives", () => {
  it("flags ad sets that mix a boost with a link creative", () => {
    const mixed = findAdSetsWithMixedBoostAndLinkCreatives(
      { as1: ["cr_link", "cr_boost"], as2: ["cr_link"] },
      [
        { id: "cr_link", name: "Ad1", sourceType: "new" },
        { id: "cr_boost", name: "Ad3", sourceType: "existing_post" },
      ],
      [
        { id: "as1", name: "Wide" },
        { id: "as2", name: "Retargeting" },
      ],
    );
    assert.deepEqual(mixed, [{ adSetId: "as1", adSetName: "Wide" }]);
  });
});
