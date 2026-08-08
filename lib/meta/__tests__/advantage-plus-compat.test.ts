/**
 * Unit tests for isAdvantageAudienceSupportedForObjective — the source of
 * truth for whether Meta will accept `targeting_automation.advantage_audience`
 * for a given campaign objective / optimisation goal (task #126).
 *
 * Run: node --experimental-strip-types --test lib/meta/__tests__/advantage-plus-compat.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isAdvantageAudienceSupportedForObjective,
  objectiveDisplayName,
  advantageAudienceObjectiveMismatchMessage,
} from "../advantage-plus-compat.ts";
import type { CampaignObjective, OptimisationGoal } from "../../types.ts";

const ALL_OBJECTIVES: CampaignObjective[] = [
  "purchase",
  "registration",
  "traffic",
  "awareness",
  "engagement",
];

const ALL_GOALS: OptimisationGoal[] = [
  "conversions",
  "value",
  "complete_registration",
  "landing_page_views",
  "link_clicks",
  "reach",
  "impressions",
  "post_engagement",
  "video_views",
];

describe("isAdvantageAudienceSupportedForObjective — supported objectives", () => {
  it("supports every optimisation goal under 'purchase' (OUTCOME_SALES)", () => {
    for (const goal of ALL_GOALS) {
      assert.equal(isAdvantageAudienceSupportedForObjective("purchase", goal), true, goal);
    }
  });

  it("supports every optimisation goal under 'traffic' (OUTCOME_TRAFFIC)", () => {
    for (const goal of ALL_GOALS) {
      assert.equal(isAdvantageAudienceSupportedForObjective("traffic", goal), true, goal);
    }
  });

  it("supports every optimisation goal under 'engagement' (OUTCOME_ENGAGEMENT)", () => {
    for (const goal of ALL_GOALS) {
      assert.equal(isAdvantageAudienceSupportedForObjective("engagement", goal), true, goal);
    }
  });
});

describe("isAdvantageAudienceSupportedForObjective — unsupported objectives", () => {
  it("blocks every optimisation goal under 'awareness' (OUTCOME_AWARENESS)", () => {
    for (const goal of ALL_GOALS) {
      assert.equal(isAdvantageAudienceSupportedForObjective("awareness", goal), false, goal);
    }
  });

  it("blocks every optimisation goal under 'registration' (OUTCOME_LEADS), reproducing subcode 1870196", () => {
    for (const goal of ALL_GOALS) {
      assert.equal(isAdvantageAudienceSupportedForObjective("registration", goal), false, goal);
    }
  });

  it("blocks the exact East End Dubs Newcastle reproducer combo (registration + conversions)", () => {
    assert.equal(isAdvantageAudienceSupportedForObjective("registration", "conversions"), false);
  });

  it("blocks registration + complete_registration too (the objective's other valid goal)", () => {
    assert.equal(isAdvantageAudienceSupportedForObjective("registration", "complete_registration"), false);
  });
});

describe("isAdvantageAudienceSupportedForObjective — full matrix sanity (all 5 objectives x 9 goals)", () => {
  it("every combo returns a boolean and matches the objective-level expectation", () => {
    const unsupported = new Set<CampaignObjective>(["awareness", "registration"]);
    for (const objective of ALL_OBJECTIVES) {
      for (const goal of ALL_GOALS) {
        const result = isAdvantageAudienceSupportedForObjective(objective, goal);
        assert.equal(typeof result, "boolean");
        assert.equal(result, !unsupported.has(objective), `${objective}/${goal}`);
      }
    }
  });
});

describe("advantageAudienceObjectiveMismatchMessage", () => {
  it("names the ad set and the objective in the message", () => {
    const message = advantageAudienceObjectiveMismatchMessage("Similar Pages", "registration");
    assert.match(message, /Similar Pages/);
    assert.match(message, /Registration/);
    assert.match(message, /1870196/);
  });
});

describe("objectiveDisplayName", () => {
  it("returns a human-readable label for every objective", () => {
    assert.equal(objectiveDisplayName("registration"), "Registration");
    assert.equal(objectiveDisplayName("awareness"), "Awareness");
    assert.equal(objectiveDisplayName("purchase"), "Purchase");
    assert.equal(objectiveDisplayName("traffic"), "Traffic");
    assert.equal(objectiveDisplayName("engagement"), "Engagement");
  });
});
