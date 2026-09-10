/**
 * Initiate checkout is a sixth internal objective bundle, not a sixth Meta
 * objective. Campaign payload stays OUTCOME_SALES (identical to purchase).
 * The ad-set promoted_object.custom_event_type is INITIATED_CHECKOUT —
 * confirmed against Meta 2026-09-10 (INITIATE_CHECKOUT is rejected, code 100).
 *
 * Existing objectives are pinned field-for-field so this addition cannot
 * change purchase / registration / traffic / awareness / engagement payloads.
 *
 * Run: node --experimental-strip-types --test lib/meta/__tests__/initiate-checkout-objective.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  AdSetSuggestion,
  AudienceSettings,
  BudgetScheduleSettings,
  CampaignObjective,
  OptimisationGoal,
} from "../../types.ts";
import { buildAdSetPayload } from "../adset.ts";
import {
  buildCampaignPayload,
  mapMetaObjectiveToInternal,
  mapObjectiveToMeta,
  META_INITIATE_CHECKOUT_EVENT,
} from "../campaign.ts";

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

const GOAL_BY_OBJECTIVE = {
  purchase: "conversions",
  initiate_checkout: "conversions",
  registration: "conversions",
  traffic: "landing_page_views",
  awareness: "reach",
  engagement: "post_engagement",
} as const satisfies Record<CampaignObjective, OptimisationGoal>;

const EXISTING_OBJECTIVES = [
  "purchase",
  "registration",
  "traffic",
  "awareness",
  "engagement",
] as const satisfies readonly Exclude<CampaignObjective, "initiate_checkout">[];

function campaignPayload(objective: CampaignObjective) {
  return buildCampaignPayload({
    name: "Fixture Campaign",
    objective,
    status: "ACTIVE",
  });
}

function adSetPayload(objective: CampaignObjective) {
  return buildAdSetPayload(
    makeAdSet(),
    "cam_001",
    emptyAudiences,
    schedule,
    GOAL_BY_OBJECTIVE[objective],
    objective,
    "pixel_fixture",
  );
}

const SHARED_TARGETING = {
  geo_locations: { countries: ["GB"] },
  targeting_automation: {
    advantage_audience: 1,
    individual_setting: { age_min: 18, age_max: 65 },
  },
};

const PINNED_CAMPAIGNS = {
  purchase: {
    name: "Fixture Campaign",
    objective: "OUTCOME_SALES",
    buying_type: "AUCTION",
    status: "ACTIVE",
    is_adset_budget_sharing_enabled: false,
    special_ad_categories: [],
  },
  registration: {
    name: "Fixture Campaign",
    objective: "OUTCOME_LEADS",
    buying_type: "AUCTION",
    status: "ACTIVE",
    is_adset_budget_sharing_enabled: false,
    special_ad_categories: [],
  },
  traffic: {
    name: "Fixture Campaign",
    objective: "OUTCOME_TRAFFIC",
    buying_type: "AUCTION",
    status: "ACTIVE",
    is_adset_budget_sharing_enabled: false,
    special_ad_categories: [],
  },
  awareness: {
    name: "Fixture Campaign",
    objective: "OUTCOME_AWARENESS",
    buying_type: "AUCTION",
    status: "ACTIVE",
    is_adset_budget_sharing_enabled: false,
    special_ad_categories: [],
  },
  engagement: {
    name: "Fixture Campaign",
    objective: "OUTCOME_ENGAGEMENT",
    buying_type: "AUCTION",
    status: "ACTIVE",
    is_adset_budget_sharing_enabled: false,
    special_ad_categories: [],
  },
} as const;

const PINNED_AD_SETS = {
  purchase: {
    name: "Fixture Ad Set",
    campaign_id: "cam_001",
    daily_budget: 1000,
    billing_event: "IMPRESSIONS",
    optimization_goal: "OFFSITE_CONVERSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: SHARED_TARGETING,
    status: "ACTIVE",
    promoted_object: {
      pixel_id: "pixel_fixture",
      custom_event_type: "PURCHASE",
    },
  },
  registration: {
    name: "Fixture Ad Set",
    campaign_id: "cam_001",
    daily_budget: 1000,
    billing_event: "IMPRESSIONS",
    optimization_goal: "OFFSITE_CONVERSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: SHARED_TARGETING,
    status: "ACTIVE",
    promoted_object: {
      pixel_id: "pixel_fixture",
      custom_event_type: "COMPLETE_REGISTRATION",
    },
    destination_type: "WEBSITE",
  },
  traffic: {
    name: "Fixture Ad Set",
    campaign_id: "cam_001",
    daily_budget: 1000,
    billing_event: "IMPRESSIONS",
    optimization_goal: "LANDING_PAGE_VIEWS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: SHARED_TARGETING,
    status: "ACTIVE",
    destination_type: "WEBSITE",
  },
  awareness: {
    name: "Fixture Ad Set",
    campaign_id: "cam_001",
    daily_budget: 1000,
    billing_event: "IMPRESSIONS",
    optimization_goal: "REACH",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: SHARED_TARGETING,
    status: "ACTIVE",
  },
  engagement: {
    name: "Fixture Ad Set",
    campaign_id: "cam_001",
    daily_budget: 1000,
    billing_event: "IMPRESSIONS",
    optimization_goal: "POST_ENGAGEMENT",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: SHARED_TARGETING,
    status: "ACTIVE",
  },
} as const;

describe("existing objectives stay byte-identical", () => {
  for (const objective of EXISTING_OBJECTIVES) {
    it(`${objective} campaign payload is unchanged`, () => {
      assert.deepEqual(campaignPayload(objective), PINNED_CAMPAIGNS[objective]);
    });

    it(`${objective} ad-set payload is unchanged`, () => {
      assert.deepEqual(adSetPayload(objective), PINNED_AD_SETS[objective]);
    });
  }
});

describe("initiate_checkout bundle", () => {
  it("maps to OUTCOME_SALES — the same Meta objective as purchase", () => {
    assert.equal(mapObjectiveToMeta("initiate_checkout"), "OUTCOME_SALES");
    assert.equal(mapObjectiveToMeta("initiate_checkout"), mapObjectiveToMeta("purchase"));
  });

  it("campaign payload is byte-identical to purchase", () => {
    assert.deepEqual(campaignPayload("initiate_checkout"), campaignPayload("purchase"));
    assert.deepEqual(campaignPayload("initiate_checkout"), PINNED_CAMPAIGNS.purchase);
  });

  it("ad-set payload is purchase plus INITIATED_CHECKOUT", () => {
    const checkout = adSetPayload("initiate_checkout");
    const purchase = adSetPayload("purchase");
    assert.equal(
      checkout.promoted_object?.custom_event_type,
      META_INITIATE_CHECKOUT_EVENT,
    );
    assert.equal(META_INITIATE_CHECKOUT_EVENT, "INITIATED_CHECKOUT");
    assert.notEqual(
      checkout.promoted_object?.custom_event_type,
      purchase.promoted_object?.custom_event_type,
    );
    assert.deepEqual(
      { ...checkout, promoted_object: { ...checkout.promoted_object, custom_event_type: "PURCHASE" } },
      purchase,
    );
  });
});

describe("mapMetaObjectiveToInternal — OUTCOME_SALES ambiguity", () => {
  it("defaults a live OUTCOME_SALES campaign to purchase when no event is available", () => {
    assert.equal(mapMetaObjectiveToInternal("OUTCOME_SALES"), "purchase");
    assert.equal(mapMetaObjectiveToInternal("OUTCOME_SALES", null), "purchase");
    assert.equal(mapMetaObjectiveToInternal("OUTCOME_SALES", ""), "purchase");
    assert.equal(mapMetaObjectiveToInternal("OUTCOME_SALES", "PURCHASE"), "purchase");
  });

  it("classifies INITIATED_CHECKOUT as initiate_checkout", () => {
    assert.equal(
      mapMetaObjectiveToInternal("OUTCOME_SALES", "INITIATED_CHECKOUT"),
      "initiate_checkout",
    );
    assert.equal(
      mapMetaObjectiveToInternal("CONVERSIONS", "initiated_checkout"),
      "initiate_checkout",
    );
  });

  it("does not treat the rejected INITIATE_CHECKOUT spelling as the checkout bundle", () => {
    assert.equal(
      mapMetaObjectiveToInternal("OUTCOME_SALES", "INITIATE_CHECKOUT"),
      "purchase",
    );
  });

  it("keeps the other objectives unambiguous", () => {
    assert.equal(mapMetaObjectiveToInternal("OUTCOME_LEADS"), "registration");
    assert.equal(mapMetaObjectiveToInternal("OUTCOME_TRAFFIC"), "traffic");
    assert.equal(mapMetaObjectiveToInternal("OUTCOME_AWARENESS"), "awareness");
    assert.equal(mapMetaObjectiveToInternal("OUTCOME_ENGAGEMENT"), "engagement");
    assert.equal(mapMetaObjectiveToInternal("APP_INSTALLS"), undefined);
  });
});
