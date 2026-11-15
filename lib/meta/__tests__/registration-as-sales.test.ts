/**
 * Registration launches as OUTCOME_SALES. The ad set keeps
 * OFFSITE_CONVERSIONS + COMPLETE_REGISTRATION + WEBSITE. Reporting and
 * the importer tell signup from purchase by that event, not by the
 * campaign objective. OUTCOME_LEADS stays signup — those campaigns
 * already exist and their objective cannot change.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { classifySignupSalesStage } from "../../dashboard/funnel-stage-classifier.ts";
import { groupForObjective } from "../../intelligence/objective-metrics.ts";
import { CTA_OPTIONS } from "../../mock-data.ts";
import type {
  AdSetSuggestion,
  AudienceSettings,
  BudgetScheduleSettings,
} from "../../types.ts";
import { isAdvantageAudienceSupportedForObjective } from "../advantage-plus-compat.ts";
import { buildAdSetPayload } from "../adset.ts";
import { buildCampaignPayload, mapObjectiveToMeta } from "../campaign.ts";
import { mapMetaLiveCampaign } from "../import/map.ts";
import type { MetaLiveCampaignBundle } from "../import/types.ts";

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

function salesBundle(
  objective: string,
  events: Array<string | null>,
): MetaLiveCampaignBundle {
  return {
    campaign: { id: "c1", name: "Fixture", objective },
    adSets: events.map((event, index) => ({
      id: `as-${index}`,
      name: `Ad set ${index}`,
      targeting: { geo_locations: { countries: ["GB"] } },
      ...(event
        ? { promoted_object: { pixel_id: "pixel_fixture", custom_event_type: event } }
        : {}),
    })),
    ads: [],
    creatives: {},
  };
}

function imported(objective: string, events: Array<string | null>) {
  return mapMetaLiveCampaign({
    bundle: salesBundle(objective, events),
    adAccountId: "act_1",
    carry: [],
    availability: [],
    now: "2026-09-30T12:00:00.000Z",
    draftId: "00000000-0000-4000-8000-000000000001",
  });
}

describe("registration launches as OUTCOME_SALES", () => {
  it("sends OUTCOME_SALES on the campaign and COMPLETE_REGISTRATION on the ad set", () => {
    assert.equal(mapObjectiveToMeta("registration"), "OUTCOME_SALES");
    const campaign = buildCampaignPayload({
      name: "Fixture Campaign",
      objective: "registration",
      status: "PAUSED",
    });
    assert.equal(campaign.objective, "OUTCOME_SALES");

    const adSet = buildAdSetPayload(
      makeAdSet(),
      "cam_001",
      emptyAudiences,
      schedule,
      "conversions",
      "registration",
      "pixel_fixture",
    );
    assert.equal(adSet.optimization_goal, "OFFSITE_CONVERSIONS");
    assert.equal(adSet.destination_type, "WEBSITE");
    assert.deepEqual(adSet.promoted_object, {
      pixel_id: "pixel_fixture",
      custom_event_type: "COMPLETE_REGISTRATION",
    });
  });

  it("offers Advantage+ for a registration draft", () => {
    assert.equal(
      isAdvantageAudienceSupportedForObjective("registration", "conversions"),
      true,
    );
    assert.equal(
      isAdvantageAudienceSupportedForObjective("registration", "complete_registration"),
      true,
    );
  });

  it("still offers SIGN_UP — the CTA list is not gated on the Meta objective", () => {
    assert.equal(CTA_OPTIONS.some((option) => option.value === "sign_up"), true);
    const creatives = readFileSync(
      new URL("../../../components/steps/creatives.tsx", import.meta.url),
      "utf8",
    );
    assert.match(creatives, /options=\{CTA_OPTIONS\}/);
    assert.equal(creatives.includes("OUTCOME_LEADS"), false);
    assert.equal(creatives.includes("OUTCOME_SALES"), false);
  });
});

describe("signup versus sales classification", () => {
  it("OUTCOME_SALES + COMPLETE_REGISTRATION is signup", () => {
    assert.equal(
      classifySignupSalesStage({
        objective: "OUTCOME_SALES",
        customEventType: "COMPLETE_REGISTRATION",
      }),
      "signup",
    );
    assert.equal(
      groupForObjective("OUTCOME_SALES", "COMPLETE_REGISTRATION"),
      "leads",
    );
  });

  it("OUTCOME_SALES + PURCHASE is sales", () => {
    assert.equal(
      classifySignupSalesStage({
        objective: "OUTCOME_SALES",
        customEventType: "PURCHASE",
      }),
      "sales",
    );
    assert.equal(groupForObjective("OUTCOME_SALES", "PURCHASE"), "sales");
  });

  it("OUTCOME_LEADS stays signup", () => {
    assert.equal(
      classifySignupSalesStage({ objective: "OUTCOME_LEADS" }),
      "signup",
    );
    assert.equal(groupForObjective("OUTCOME_LEADS"), "leads");
  });
});

describe("importer round-trip", () => {
  it("imports OUTCOME_SALES + COMPLETE_REGISTRATION as registration", () => {
    const draft = imported("OUTCOME_SALES", ["COMPLETE_REGISTRATION", "COMPLETE_REGISTRATION"]);
    assert.equal(draft.settings.objective, "registration");
    assert.equal(
      draft.importMeta?.dropped.some((row) => row.field === "objective_event_mixed"),
      false,
    );
  });

  it("imports OUTCOME_SALES + PURCHASE as purchase", () => {
    const draft = imported("OUTCOME_SALES", ["PURCHASE"]);
    assert.equal(draft.settings.objective, "purchase");
  });

  it("imports OUTCOME_SALES + INITIATED_CHECKOUT as initiate_checkout", () => {
    const draft = imported("OUTCOME_SALES", ["INITIATED_CHECKOUT"]);
    assert.equal(draft.settings.objective, "initiate_checkout");
  });

  it("keeps OUTCOME_LEADS as registration", () => {
    const draft = imported("OUTCOME_LEADS", ["PURCHASE"]);
    assert.equal(draft.settings.objective, "registration");
    assert.equal(
      draft.importMeta?.dropped.some((row) => row.field === "objective_event_mixed"),
      false,
    );
  });

  it("takes the majority event and names the rest on dropped[]", () => {
    const draft = imported("OUTCOME_SALES", [
      "COMPLETE_REGISTRATION",
      "COMPLETE_REGISTRATION",
      "PURCHASE",
    ]);
    assert.equal(draft.settings.objective, "registration");
    const mixed = (draft.importMeta?.dropped ?? []).filter(
      (row) => row.field === "objective_event_mixed",
    );
    assert.equal(mixed.length, 1);
    assert.equal(mixed[0]?.adSetName, "Ad set 2");
    assert.deepEqual(mixed[0]?.value, { event: "PURCHASE", kept: "registration" });
  });
});
