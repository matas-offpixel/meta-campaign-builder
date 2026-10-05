/**
 * Attach mode inherits the conversion event the live ad sets already
 * optimise for. OUTCOME_SALES alone is purchase; the ad-set vote is what
 * makes a signup campaign Signup.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { AdSetSuggestion, AudienceSettings, BudgetScheduleSettings } from "../../types.ts";
import { buildAdSetPayload } from "../adset.ts";
import {
  assertAttachDraftObjective,
  attachChipLabel,
  attachObjectiveChipTitle,
  resolveAttachCampaign,
} from "../attach-objective.ts";

function rows(events: Array<string | null>, pixel = "px") {
  return {
    adsets: {
      data: events.map((event) => ({
        optimization_goal: "OFFSITE_CONVERSIONS",
        promoted_object: event
          ? { custom_event_type: event, pixel_id: pixel }
          : {},
      })),
    },
  };
}

function makeAdSet(): AdSetSuggestion {
  return {
    id: "s1",
    name: "Fixture Ad Set",
    sourceType: "blank",
    sourceId: "",
    sourceName: "Blank",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 10,
    advantagePlus: true,
    enabled: true,
  } as AdSetSuggestion;
}

const emptyAudiences = {
  interestGroups: [],
  customAudienceGroups: [],
  pageGroups: [],
  savedAudiences: [],
  selectedPagesLookalikeGroups: [],
} as unknown as AudienceSettings;

const schedule = {
  startDate: "",
  endDate: "",
  adSets: [],
} as unknown as BudgetScheduleSettings;

describe("resolveAttachCampaign", () => {
  it("OUTCOME_SALES + all ad sets COMPLETE_REGISTRATION is registration", () => {
    const resolved = resolveAttachCampaign({
      objective: "OUTCOME_SALES",
      ...rows(["COMPLETE_REGISTRATION", "COMPLETE_REGISTRATION"]),
    });
    assert.equal(resolved.objective, "registration");
    assert.deepEqual(resolved.minorityEvents, []);
    assert.equal(resolved.objectiveSource, "adsets");
    assert.equal(resolved.conversionEvent, "Complete registration");
  });

  it("OUTCOME_SALES + 2 purchase / 1 registration is purchase with the minority noted", () => {
    const resolved = resolveAttachCampaign({
      objective: "OUTCOME_SALES",
      ...rows(["PURCHASE", "PURCHASE", "COMPLETE_REGISTRATION"]),
    });
    assert.equal(resolved.objective, "purchase");
    assert.deepEqual(resolved.minorityEvents, ["COMPLETE_REGISTRATION"]);
    assert.equal(resolved.conversionEvent, "Purchase");
  });

  it("no ad sets falls back to the campaign objective", () => {
    const resolved = resolveAttachCampaign({ objective: "OUTCOME_SALES" });
    assert.equal(resolved.objective, "purchase");
    assert.equal(resolved.objectiveSource, "campaign");
    assert.equal(resolved.adSetCount, 0);
    assert.equal(resolved.conversionEvent, null);
    assert.equal(
      attachObjectiveChipTitle(resolved.objectiveSource, resolved.adSetCount),
      "No ad sets yet — from the campaign objective",
    );
  });

  it("OUTCOME_LEADS ignores events", () => {
    const resolved = resolveAttachCampaign({
      objective: "OUTCOME_LEADS",
      ...rows(["PURCHASE", "PURCHASE"]),
    });
    assert.equal(resolved.objective, "registration");
    assert.deepEqual(resolved.minorityEvents, []);
    assert.equal(resolved.conversionEvent, null);
    assert.equal(resolved.objectiveSource, "adsets");
  });
});

describe("assertSameObjective", () => {
  it("registration draft + signup target passes", () => {
    const result = assertAttachDraftObjective({
      draftObjective: "registration",
      campaignName: "DAN SHAKE - Signup",
      resolvedObjective: "registration",
    });
    assert.deepEqual(result, { ok: true });
  });

  it("registration draft + purchase target refuses with the event named", () => {
    const result = assertAttachDraftObjective({
      draftObjective: "registration",
      campaignName: "DAN SHAKE - Purchase",
      resolvedObjective: "purchase",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(
      result.message,
      "DAN SHAKE - Purchase optimises for Purchase; this draft is set to Signup. Change the draft's objective on the Campaign step.",
    );
  });

  it("purchase draft + signup target names Complete registration", () => {
    const result = assertAttachDraftObjective({
      draftObjective: "purchase",
      campaignName: "DAN SHAKE - Signup",
      resolvedObjective: "registration",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(
      result.message,
      "DAN SHAKE - Signup optimises for Complete registration; this draft is set to Purchase. Change the draft's objective on the Campaign step.",
    );
  });
});

describe("picker chip", () => {
  it("chip label from the fixture is Signup", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("../__fixtures__/attach-objective/120250922487440239.json", import.meta.url),
        "utf8",
      ),
    ) as { response: { objective: string; adsets: { data: unknown[] } } };
    const resolved = resolveAttachCampaign(fixture.response);
    assert.equal(resolved.adSetCount, 6);
    assert.equal(attachChipLabel(resolved.objective!), "Signup");
    const events = fixture.response.adsets.data.map(
      (row) =>
        (row as { promoted_object?: { custom_event_type?: string } }).promoted_object
          ?.custom_event_type,
    );
    assert.deepEqual(events, Array(6).fill("COMPLETE_REGISTRATION"));
  });
});

describe("attach_campaign payload", () => {
  it("emits COMPLETE_REGISTRATION and the voted pixel under a signup target", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("../__fixtures__/attach-objective/120250922487440239.json", import.meta.url),
        "utf8",
      ),
    ) as {
      response: {
        objective: string;
        adsets: { data: Array<{ promoted_object?: { custom_event_type?: string; pixel_id?: string } }> };
      };
    };
    const resolved = resolveAttachCampaign(fixture.response);
    assert.equal(resolved.objective, "registration");
    assert.equal(resolved.pixelId, "2261755947685271");
    assert.equal(attachChipLabel(resolved.objective!), "Signup");
    assert.equal(
      attachObjectiveChipTitle(resolved.objectiveSource, resolved.adSetCount),
      "Resolved from 6 ad sets' conversion event",
    );

    const payload = buildAdSetPayload(
      makeAdSet(),
      "120250922487440239",
      emptyAudiences,
      schedule,
      "conversions",
      resolved.objective!,
      resolved.pixelId!,
    );
    assert.equal(payload.promoted_object?.custom_event_type, "COMPLETE_REGISTRATION");
    assert.equal(payload.promoted_object?.pixel_id, "2261755947685271");
  });
});
