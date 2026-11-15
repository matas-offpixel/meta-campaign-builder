/**
 * Tests for resolveAdSetDestinationType / buildAdSetPayload destination_type
 * and the website-destination preflight.
 *
 * The expectations here are pinned to live Graph probes run 2026-09-30 on
 * act_932846012721428 (create PAUSED → read back → delete, per objective and
 * per valid optimisation goal):
 *
 *   traffic, registration, purchase, initiate_checkout, awareness
 *                                     → destination_type=WEBSITE ACCEPTED
 *   engagement (post_engagement, video_views)
 *                                     → REJECTED code=100 subcode=2490408,
 *                                       while the same ad set without the
 *                                       field is ACCEPTED (matched control)
 *
 * Boosts were probed separately on the real DHB page: object_story_id and
 * source_instagram_media_id creatives, each with and without #983's
 * call_to_action.value.link, all attached to a destination_type=WEBSITE ad set
 * with no subcode 1815676. #777's whole-ad-set downgrade is therefore gone.
 *
 * Run: node --test lib/meta/__tests__/adset-destination-type.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAdSetPayload,
  findAdSetsWithoutWebsiteDestination,
  isWebsiteDestinationObjective,
  resolveAdSetDestinationType,
  websiteDestinationRefusalMessage,
  WEBSITE_DESTINATION_OBJECTIVES,
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

function build(objective: CampaignObjective, goal: OptimisationGoal) {
  return buildAdSetPayload(
    makeAdSet(),
    "cam_001",
    emptyAudiences,
    schedule,
    goal,
    objective,
  );
}

/** Every goal the wizard accepts per objective (VALID_GOALS_BY_OBJECTIVE). */
const GOALS_BY_OBJECTIVE: Record<CampaignObjective, OptimisationGoal[]> = {
  traffic: ["landing_page_views", "link_clicks", "reach", "impressions"],
  purchase: ["conversions", "value"],
  initiate_checkout: ["conversions", "value"],
  registration: ["conversions", "complete_registration"],
  awareness: ["reach", "impressions", "video_views"],
  engagement: ["post_engagement", "video_views"],
};

describe("resolveAdSetDestinationType — golden per objective", () => {
  it("returns WEBSITE for every website-bound objective, on every valid goal", () => {
    for (const objective of WEBSITE_DESTINATION_OBJECTIVES) {
      for (const goal of GOALS_BY_OBJECTIVE[objective]) {
        assert.equal(
          resolveAdSetDestinationType(objective, goal),
          "WEBSITE",
          `${objective} + ${goal} must resolve to WEBSITE`,
        );
      }
    }
  });

  it("covers traffic, registration, purchase, initiate_checkout and awareness", () => {
    assert.deepEqual([...WEBSITE_DESTINATION_OBJECTIVES].sort(), [
      "awareness",
      "initiate_checkout",
      "purchase",
      "registration",
      "traffic",
    ]);
  });

  it("returns undefined for engagement on every goal (Meta rejects WEBSITE, subcode 2490408)", () => {
    for (const goal of GOALS_BY_OBJECTIVE.engagement) {
      assert.equal(
        resolveAdSetDestinationType("engagement", goal),
        undefined,
        `engagement + ${goal} must stay unset`,
      );
    }
    assert.equal(isWebsiteDestinationObjective("engagement"), false);
  });
});

describe("buildAdSetPayload — destination_type", () => {
  it("sets destination_type=WEBSITE on every website-bound objective", () => {
    for (const objective of WEBSITE_DESTINATION_OBJECTIVES) {
      for (const goal of GOALS_BY_OBJECTIVE[objective]) {
        assert.equal(
          build(objective, goal).destination_type,
          "WEBSITE",
          `${objective} + ${goal}`,
        );
      }
    }
  });

  it("On Sale ad sets now carry a destination (the regression this PR fixes)", () => {
    assert.equal(build("purchase", "conversions").destination_type, "WEBSITE");
    assert.equal(
      build("initiate_checkout", "conversions").destination_type,
      "WEBSITE",
    );
  });

  it("omits the key entirely for engagement — never sends an empty value", () => {
    const payload = build("engagement", "post_engagement");
    assert.equal(payload.destination_type, undefined);
    assert.ok(
      !("destination_type" in payload),
      "key must be absent, not undefined — Meta rejects WEBSITE here",
    );
  });

  it("a boost assigned to the ad set no longer changes the payload", () => {
    // #777 threaded a hasBoostCreative flag as a 10th positional argument and
    // dropped the field when it was true. The parameter is gone; a stray extra
    // argument must not resurrect the behaviour.
    const withStrayFlag = (
      buildAdSetPayload as unknown as (
        ...args: unknown[]
      ) => ReturnType<typeof buildAdSetPayload>
    )(
      makeAdSet(),
      "cam_001",
      emptyAudiences,
      schedule,
      "landing_page_views",
      "traffic",
      undefined,
      undefined,
      undefined,
      true,
    );
    assert.equal(withStrayFlag.destination_type, "WEBSITE");
  });
});

describe("findAdSetsWithoutWebsiteDestination", () => {
  it("passes ad sets that carry WEBSITE", () => {
    assert.deepEqual(
      findAdSetsWithoutWebsiteDestination("traffic", [
        { id: "1", name: "Wide", destinationType: "WEBSITE" },
      ]),
      [],
    );
  });

  it("refuses Meta's literal UNDEFINED", () => {
    const refusals = findAdSetsWithoutWebsiteDestination("purchase", [
      { id: "120249993287300453", name: "DHB", destinationType: "UNDEFINED" },
    ]);
    assert.deepEqual(refusals, [
      { adSetId: "120249993287300453", adSetName: "DHB", found: "UNDEFINED" },
    ]);
  });

  it("treats an absent value as no destination", () => {
    for (const destinationType of [undefined, null, ""]) {
      const refusals = findAdSetsWithoutWebsiteDestination("traffic", [
        { id: "1", name: "Wide", destinationType },
      ]);
      assert.equal(refusals.length, 1);
      assert.equal(refusals[0].found, "UNDEFINED");
    }
  });

  it("refuses a Facebook event destination by name", () => {
    const refusals = findAdSetsWithoutWebsiteDestination("traffic", [
      { id: "1", name: "DHB Primary 2", destinationType: "FACEBOOK_EVENT" },
    ]);
    assert.deepEqual(refusals, [
      { adSetId: "1", adSetName: "DHB Primary 2", found: "FACEBOOK_EVENT" },
    ]);
  });

  it("never refuses an engagement ad set — it cannot carry WEBSITE", () => {
    assert.deepEqual(
      findAdSetsWithoutWebsiteDestination("engagement", [
        { id: "1", name: "DHB Fans", destinationType: "ON_POST" },
        { id: "2", name: "Wide", destinationType: "UNDEFINED" },
      ]),
      [],
    );
  });

  it("reports every offending ad set, not just the first", () => {
    const refusals = findAdSetsWithoutWebsiteDestination("purchase", [
      { id: "1", name: "DHB", destinationType: "UNDEFINED" },
      { id: "2", name: "DHB 1% LL", destinationType: "WEBSITE" },
      { id: "3", name: "DHB Adv+", destinationType: "UNDEFINED" },
    ]);
    assert.deepEqual(
      refusals.map((r) => r.adSetName),
      ["DHB", "DHB Adv+"],
    );
  });
});

describe("websiteDestinationRefusalMessage", () => {
  it("names the ad set, its id, and what it carries instead", () => {
    const message = websiteDestinationRefusalMessage("traffic", [
      { adSetId: "120250102006540453", adSetName: "DHB Primary 2", found: "UNDEFINED" },
    ]);
    assert.match(message, /DHB Primary 2/);
    assert.match(message, /120250102006540453/);
    assert.match(message, /UNDEFINED/);
    assert.match(message, /traffic/);
  });

  it("names every ad set when several are refused", () => {
    const message = websiteDestinationRefusalMessage("purchase", [
      { adSetId: "1", adSetName: "DHB", found: "UNDEFINED" },
      { adSetId: "2", adSetName: "DHB Adv+", found: "UNDEFINED" },
    ]);
    assert.match(message, /DHB"/);
    assert.match(message, /DHB Adv\+/);
    assert.match(message, /2 ad sets do not carry/);
  });
});
