/**
 * Advantage+ Audience age: control + suggestion, never hard targeting.
 *
 * ES27-ENZOSIRAGUSA arm B (25 Nov 2026): "Broad + suggestions" (18–45,
 * Advantage+, 126 suggestion audiences) was sent with
 * `individual_setting: { age_min, age_max }`, which is not a shape Meta
 * documents. Meta refused it (subcode 1870196) and the old salvage retry
 * relaunched it strict, so its suggestions became hard targeting.
 *
 * With advantage_audience 1, Meta allows only age_min as a control (≤ 25)
 * and age_max must be 65; a narrower range goes as the age suggestion:
 * top-level `age_range` + `targeting_automation.individual_setting.age = 1`
 * (Meta, Advanced targeting, "Age as a suggestion").
 *
 * Run: node --conditions react-server --experimental-strip-types --test lib/meta/__tests__/advantage-audience-age.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { advantageAudienceAgeTargeting, buildAdSetPayload, buildMetaTargeting } from "../adset.ts";
import type { AdSetSuggestion, AudienceSettings, BudgetScheduleSettings } from "../../types.ts";

const SUGGESTION_IDS = ["120250923818990239", "120250923819000239", "120250923819010239"];

const audiences = {
  interestGroups: [],
  customAudienceGroups: [
    { id: "cag_crossover", name: "Crossover pages", audienceIds: SUGGESTION_IDS, suggestionsOnly: true },
  ],
  pageGroups: [],
  savedAudiences: { audienceIds: [] },
  selectedPagesLookalikeGroups: [],
} as unknown as AudienceSettings;

const schedule = { startDate: "", endDate: "" } as unknown as BudgetScheduleSettings;

function adSet(overrides: Partial<AdSetSuggestion> = {}): AdSetSuggestion {
  return {
    id: "as_b_suggestions",
    name: "Broad + suggestions",
    sourceType: "custom_group",
    sourceId: "cag_crossover",
    sourceName: "Crossover pages",
    ageMin: 18,
    ageMax: 45,
    budgetPerDay: 40,
    advantagePlus: true,
    enabled: true,
    geoLocations: { countries: ["GB"] },
    ...overrides,
  } as AdSetSuggestion;
}

describe("Advantage+ Audience age — payload snapshot", () => {
  it("18–45 Advantage+ with suggestion audiences: age_max 65 control, 18–45 as the age suggestion, audiences as suggestions", () => {
    const payload = buildAdSetPayload(adSet(), "cam_armB", audiences, schedule, "conversions", "registration", "pixel_1");
    // As it goes on the wire (JSON drops undefined keys).
    const wire = JSON.parse(JSON.stringify(payload.targeting));
    assert.deepEqual(wire, {
      age_min: 18,
      age_max: 65,
      age_range: [18, 45],
      targeting_automation: { advantage_audience: 1, individual_setting: { age: 1 } },
      geo_locations: { countries: ["GB"] },
      custom_audiences: SUGGESTION_IDS.map((id) => ({ id })),
    });
  });

  it("never sends the old undocumented individual_setting { age_min, age_max }", () => {
    const t = buildMetaTargeting(adSet(), audiences);
    const individual = t.targeting_automation?.individual_setting as Record<string, unknown> | undefined;
    assert.equal(individual?.age_min, undefined);
    assert.equal(individual?.age_max, undefined);
  });
});

describe("advantageAudienceAgeTargeting", () => {
  it("full range 18–65: control 18, age_max 65, no suggestion", () => {
    assert.deepEqual(advantageAudienceAgeTargeting(18, 65), {
      age_min: 18,
      age_max: 65,
      targeting_automation: { advantage_audience: 1 },
    });
  });

  it("a minimum above 25 is capped as the control and kept in the suggestion", () => {
    assert.deepEqual(advantageAudienceAgeTargeting(30, 65), {
      age_min: 25,
      age_max: 65,
      age_range: [30, 65],
      targeting_automation: { advantage_audience: 1, individual_setting: { age: 1 } },
    });
  });

  it("21–35: control 21, suggestion 21–35", () => {
    const t = advantageAudienceAgeTargeting(21, 35);
    assert.equal(t.age_min, 21);
    assert.equal(t.age_max, 65);
    assert.deepEqual(t.age_range, [21, 35]);
  });

  it("age_max is never below 65 on an Advantage+ ad set", () => {
    for (const [lo, hi] of [[18, 24], [18, 45], [25, 54], [35, 64]] as const) {
      assert.equal(advantageAudienceAgeTargeting(lo, hi).age_max, 65);
    }
  });
});

describe("strict ad sets are unchanged", () => {
  it("Advantage+ off: draft ages are hard limits, advantage_audience 0, no suggestion", () => {
    const t = buildMetaTargeting(adSet({ advantagePlus: false, sourceType: "interest_group", sourceId: "x" }), audiences);
    assert.equal(t.age_min, 18);
    assert.equal(t.age_max, 45);
    assert.equal(t.age_range, undefined);
    assert.deepEqual(t.targeting_automation, { advantage_audience: 0 });
  });

  it("suggestions-only audiences still refuse strict targeting", () => {
    assert.throws(() => buildMetaTargeting(adSet({ advantagePlus: false }), audiences), /Advantage\+ suggestions only/);
  });
});
