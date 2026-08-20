import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import {
  TIKTOK_LOCATION_IDS_BY_CODE,
  buildTikTokAdGroupPayload,
  buildTikTokAdPayload,
  buildTikTokCampaignPayload,
  formatTikTokScheduleTime,
  mapTikTokAgeGroups,
  mapTikTokBidType,
  mapTikTokBillingEvent,
  mapTikTokBudgetMode,
  mapTikTokGender,
  mapTikTokIdentityType,
  mapTikTokLocationIds,
  mapTikTokObjectiveType,
  mapTikTokOptimizationGoal,
  mapTikTokPacing,
  mapTikTokPromotionType,
  mapTikTokScheduleType,
  tikTokAdGroupBudgetFloor,
} from "../write/mapping.ts";

describe("mapTikTokAgeGroups", () => {
  it("maps 18–65 onto the official AGE_ buckets that overlap that range", () => {
    const result = mapTikTokAgeGroups(18, 65);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value, [
        "AGE_18_24",
        "AGE_25_34",
        "AGE_35_44",
        "AGE_45_54",
        "AGE_55_100",
      ]);
    }
  });

  it("maps a single bucket and rejects an inverted range", () => {
    const single = mapTikTokAgeGroups(25, 30);
    assert.deepEqual(single.ok && single.value, ["AGE_25_34"]);
    const inverted = mapTikTokAgeGroups(40, 18);
    assert.equal(inverted.ok, false);
    if (!inverted.ok) assert.equal(inverted.error.field, "age_groups");
  });
});

describe("mapTikTokGender", () => {
  it("maps MALE/FEMALE/UNKNOWN onto official GENDER_ enums", () => {
    assert.equal(mapTikTokGender(["MALE"]).ok && mapTikTokGender(["MALE"]).ok, true);
    const male = mapTikTokGender(["MALE"]);
    const female = mapTikTokGender(["FEMALE"]);
    const unknown = mapTikTokGender(["UNKNOWN"]);
    const mixed = mapTikTokGender(["MALE", "FEMALE"]);
    const empty = mapTikTokGender([]);
    assert.equal(male.ok && male.value, "GENDER_MALE");
    assert.equal(female.ok && female.value, "GENDER_FEMALE");
    assert.equal(unknown.ok && unknown.value, "GENDER_UNLIMITED");
    assert.equal(mixed.ok && mixed.value, "GENDER_UNLIMITED");
    assert.equal(empty.ok && empty.value, "GENDER_UNLIMITED");
  });
});

describe("mapTikTokLocationIds", () => {
  it("maps wizard ISO codes to TikTok GeoNames location_ids", () => {
    const result = mapTikTokLocationIds(["GB", "IE"]);
    assert.deepEqual(result.ok && result.value, [
      TIKTOK_LOCATION_IDS_BY_CODE.GB,
      TIKTOK_LOCATION_IDS_BY_CODE.IE,
    ]);
  });

  it("fails with a named location_ids error for an unknown code", () => {
    const result = mapTikTokLocationIds(["ZZ"]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.field, "location_ids");
      assert.match(result.error.message, /ZZ/);
    }
  });

  it("passes numeric /search/region/ location_ids through", () => {
    const result = mapTikTokLocationIds(["2635167"]);
    assert.deepEqual(result.ok && result.value, ["2635167"]);
  });

  it("dedupes an ISO code against the matching /search/region/ location_id", () => {
    const result = mapTikTokLocationIds(["GB", "2635167"]);
    assert.deepEqual(result.ok && result.value, ["2635167"]);
  });
});

describe("optimisation and bid mappings", () => {
  it("maps each optimisation goal and billing event", () => {
    assert.equal(
      mapTikTokOptimizationGoal("CONVERSION").ok &&
        mapTikTokOptimizationGoal("CONVERSION").ok,
      true,
    );
    const pairs: Array<[Parameters<typeof mapTikTokOptimizationGoal>[0], string, string]> = [
      ["CLICK", "CLICK", "CPC"],
      ["LANDING_PAGE_VIEW", "TRAFFIC_LANDING_PAGE_VIEW", "CPC"],
      ["CONVERSION", "CONVERT", "OCPM"],
      ["VALUE", "VALUE", "OCPM"],
      ["VIDEO_VIEW", "VIDEO_VIEW", "CPV"],
      ["VIEW_6_SECOND", "ENGAGED_VIEW", "CPV"],
      ["REACH", "REACH", "CPM"],
      ["SHOW", "SHOW", "CPM"],
      ["ENGAGEMENT", "ENGAGEMENT", "OCPM"],
    ];
    for (const [goal, optimization, billing] of pairs) {
      const mappedGoal = mapTikTokOptimizationGoal(goal);
      const mappedBilling = mapTikTokBillingEvent(goal);
      assert.equal(mappedGoal.ok && mappedGoal.value, optimization, goal ?? "");
      assert.equal(mappedBilling.ok && mappedBilling.value, billing, goal ?? "");
    }
  });

  it("maps bid strategy, pacing, budget mode, and schedule type", () => {
    const lowest = mapTikTokBidType("LOWEST_COST");
    const costCap = mapTikTokBidType("COST_CAP");
    assert.equal(lowest.ok, true);
    if (lowest.ok) assert.equal(lowest.value, "BID_TYPE_NO_BID");
    assert.equal(costCap.ok, true);
    if (costCap.ok) assert.equal(costCap.value, "BID_TYPE_CUSTOM");
    assert.equal(mapTikTokBidType("SMART_PLUS").ok, false);
    const smooth = mapTikTokPacing("STANDARD", "BID_TYPE_NO_BID");
    assert.equal(smooth.ok, true);
    if (smooth.ok) assert.equal(smooth.value, "PACING_MODE_SMOOTH");
    assert.equal(mapTikTokPacing("ACCELERATED", "BID_TYPE_NO_BID").ok, false);
    const fast = mapTikTokPacing("ACCELERATED", "BID_TYPE_CUSTOM");
    assert.equal(fast.ok, true);
    if (fast.ok) assert.equal(fast.value, "PACING_MODE_FAST");
    assert.equal(mapTikTokBudgetMode("DAILY"), "BUDGET_MODE_DAY");
    assert.equal(mapTikTokBudgetMode("LIFETIME"), "BUDGET_MODE_TOTAL");
    const ranged = mapTikTokScheduleType("2026-05-01T09:00:00Z", "2026-05-08T09:00:00Z");
    assert.equal(ranged.ok, true);
    if (ranged.ok) assert.equal(ranged.value, "SCHEDULE_START_END");
    const fromNow = mapTikTokScheduleType("2026-05-01T09:00:00Z", null);
    assert.equal(fromNow.ok, true);
    if (fromNow.ok) assert.equal(fromNow.value, "SCHEDULE_FROM_NOW");
    const formatted = formatTikTokScheduleTime("2026-05-01T09:00:00Z");
    assert.equal(formatted.ok, true);
    if (formatted.ok) assert.equal(formatted.value, "2026-05-01 09:00:00");
  });

  it("maps campaign objectives and identity types", () => {
    const conversions = mapTikTokObjectiveType("CONVERSIONS");
    assert.equal(conversions.ok, true);
    if (conversions.ok) assert.equal(conversions.value, "WEB_CONVERSIONS");
    assert.equal(mapTikTokObjectiveType("AWARENESS").ok, false);
    for (const objective of ["TRAFFIC", "VIDEO_VIEWS", "REACH", "ENGAGEMENT"] as const) {
      const mapped = mapTikTokObjectiveType(objective);
      assert.equal(mapped.ok && mapped.value, objective, objective);
    }
    const manual = mapTikTokIdentityType("MANUAL");
    const ttUser = mapTikTokIdentityType("TT_USER");
    assert.equal(manual.ok, false);
    if (!manual.ok) {
      assert.equal(manual.error.field, "identity_type");
      assert.match(manual.error.message, /MANUAL/);
    }
    assert.equal(ttUser.ok, true);
    if (ttUser.ok) assert.equal(ttUser.value, "TT_USER");
    const trafficPromo = mapTikTokPromotionType("TRAFFIC");
    const conversionsPromo = mapTikTokPromotionType("CONVERSIONS");
    assert.equal(trafficPromo.ok && trafficPromo.value, "WEBSITE");
    assert.equal(conversionsPromo.ok && conversionsPromo.value, "WEBSITE");
    assert.equal(mapTikTokPromotionType("VIDEO_VIEWS").ok, false);
    assert.equal(mapTikTokPromotionType("REACH").ok, false);
    assert.equal(mapTikTokPromotionType("AWARENESS").ok, false);
    assert.equal(mapTikTokPromotionType("ENGAGEMENT").ok, false);
  });
});

describe("write path never calls Smart+ endpoints", () => {
  it("does not mention /smart_plus/ in the write launcher", () => {
    const files = [
      "ad.ts",
      "adgroup.ts",
      "campaign.ts",
      "orchestrator.ts",
      "launch.ts",
      "request.ts",
    ];
    for (const file of files) {
      const source = readFileSync(
        new URL(`../write/${file}`, import.meta.url),
        "utf8",
      );
      assert.equal(
        source.includes("/smart_plus/"),
        false,
        `${file} must not call a Smart+ endpoint`,
      );
    }
  });
});

describe("buildTikTokAdPayload enhancements", () => {
  it("sends is_aco and creative_authorized as false with identity_type", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    draft.accountSetup.identityId = "identity_1";
    draft.accountSetup.identityType = "TT_USER";
    draft.creatives.items = [
      {
        id: "creative-1",
        name: "Hero",
        mode: "VIDEO_REFERENCE",
        baseName: "Hero",
        videoId: "video_1",
        videoUrl: null,
        thumbnailUrl: null,
        durationSeconds: null,
        title: null,
        sparkPostId: null,
        caption: "",
        adText: "Ad text",
        displayName: "Off/Pixel",
        landingPageUrl: "https://example.com",
        cta: "LEARN_MORE",
        musicId: null,
      },
    ];
    const result = buildTikTokAdPayload({
      advertiserId: "adv-1",
      adGroupId: "ag-1",
      draft,
      creative: draft.creatives.items[0],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.is_aco, false);
    assert.equal(result.value.operation_status, "DISABLE");
    const creatives = result.value.creatives as Array<Record<string, unknown>>;
    assert.equal(creatives[0].creative_authorized, false);
    assert.equal(creatives[0].identity_id, "identity_1");
    assert.equal(creatives[0].identity_type, "TT_USER");
  });

  it("sends enhancements off even when the unused draft flag is false", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    draft.creativeIntegrityMode = false;
    draft.accountSetup.identityId = "identity_1";
    draft.accountSetup.identityType = "TT_USER";
    draft.creatives.items = [sampleCreative()];
    const result = buildTikTokAdPayload({
      advertiserId: "adv-1",
      adGroupId: "ag-1",
      draft,
      creative: draft.creatives.items[0],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.is_aco, false);
    const creatives = result.value.creatives as Array<Record<string, unknown>>;
    assert.equal(creatives[0].creative_authorized, false);
  });
});

describe("ad group targeting from interest groups", () => {
  it("maps per-group category, keyword, hashtag, and behaviour ids", () => {
    const draft = payloadDraft();
    draft.audiences.interestGroups = [
      {
        id: "g-house",
        name: "House",
        interestIds: [
          { id: "cat-1", name: "Dance", kind: "category" },
          {
            id: "kw-1",
            name: "house music",
            kind: "keyword",
            audienceType: "GENERAL_INTEREST",
          },
          {
            id: "kw-buy",
            name: "tickets",
            kind: "keyword",
            audienceType: "PURCHASE_INTENTION",
          },
        ],
        hashtagIds: [{ id: "hash-1", name: "housemusic", kind: "keyword" }],
        behaviourIds: [{ id: "beh-1", name: "Creators", kind: "category" }],
      },
    ];
    const result = buildTikTokAdGroupPayload({
      advertiserId: "adv-1",
      campaignId: "camp-1",
      draft,
      adGroup: {
        id: "ig_g-house",
        name: "House",
        budget: 50,
        startAt: null,
        endAt: null,
        interestGroupId: "g-house",
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.interest_category_ids, ["cat-1"]);
    assert.deepEqual(result.value.interest_keyword_ids, ["kw-1", "hash-1"]);
    assert.deepEqual(result.value.purchase_intention_keyword_ids, ["kw-buy"]);
    assert.deepEqual(result.value.actions, [{ action_category_ids: ["beh-1"] }]);
    assert.equal("hashtag_ids" in result.value, false);
  });

  it("keeps a category with PURCHASE_INTENTION out of purchase_intention_keyword_ids", () => {
    const draft = payloadDraft();
    draft.audiences.interestGroups = [
      {
        id: "g-lost-kind",
        name: "Lost kind",
        interestIds: [
          {
            id: "cat-buy",
            name: "Tickets",
            kind: "category",
            audienceType: "PURCHASE_INTENTION",
          },
        ],
        hashtagIds: [],
        behaviourIds: [],
      },
    ];
    const result = buildTikTokAdGroupPayload({
      advertiserId: "adv-1",
      campaignId: "camp-1",
      draft,
      adGroup: {
        id: "ig_g-lost-kind",
        name: "Lost kind",
        budget: 50,
        startAt: null,
        endAt: null,
        interestGroupId: "g-lost-kind",
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.interest_category_ids, ["cat-buy"]);
    assert.equal("purchase_intention_keyword_ids" in result.value, false);
  });
});

describe("paused payloads at every level", () => {
  it("sets operation_status DISABLE on campaign, ad group, and ad", () => {
    const draft = payloadDraft();
    const campaign = buildTikTokCampaignPayload({
      advertiserId: "adv-1",
      draft,
    });
    const adGroup = buildTikTokAdGroupPayload({
      advertiserId: "adv-1",
      campaignId: "camp-1",
      draft,
      adGroup: draft.budgetSchedule.adGroups[0],
    });
    const ad = buildTikTokAdPayload({
      advertiserId: "adv-1",
      adGroupId: "ag-1",
      draft,
      creative: draft.creatives.items[0],
    });
    assert.equal(campaign.ok && campaign.value.operation_status, "DISABLE");
    assert.equal(adGroup.ok && adGroup.value.operation_status, "DISABLE");
    assert.equal(ad.ok && ad.value.operation_status, "DISABLE");
  });
});

describe("conversions payload", () => {
  it("emits WEB_CONVERSIONS with pixel_id, CONVERT, and the pixel event", () => {
    const draft = payloadDraft();
    draft.campaignSetup.objective = "CONVERSIONS";
    draft.campaignSetup.optimisationGoal = "CONVERSION";
    draft.accountSetup.pixelId = "px-1";
    draft.accountSetup.optimisationEvent = "COMPLETE_REGISTRATION";
    const campaign = buildTikTokCampaignPayload({
      advertiserId: "adv-1",
      draft,
    });
    const adGroup = buildTikTokAdGroupPayload({
      advertiserId: "adv-1",
      campaignId: "camp-1",
      draft,
      adGroup: draft.budgetSchedule.adGroups[0],
    });
    assert.equal(campaign.ok && campaign.value.objective_type, "WEB_CONVERSIONS");
    assert.equal(adGroup.ok, true);
    if (!adGroup.ok) return;
    assert.equal(adGroup.value.optimization_goal, "CONVERT");
    assert.equal(adGroup.value.pixel_id, "px-1");
    assert.equal(adGroup.value.optimization_event, "COMPLETE_REGISTRATION");
  });

  it("does not attach pixel_id on TRAFFIC", () => {
    const draft = payloadDraft();
    draft.accountSetup.pixelId = "px-1";
    draft.accountSetup.optimisationEvent = "COMPLETE_REGISTRATION";
    const adGroup = buildTikTokAdGroupPayload({
      advertiserId: "adv-1",
      campaignId: "camp-1",
      draft,
      adGroup: draft.budgetSchedule.adGroups[0],
    });
    assert.equal(adGroup.ok, true);
    if (!adGroup.ok) return;
    assert.equal(adGroup.value.pixel_id, undefined);
    assert.equal(adGroup.value.optimization_event, undefined);
  });
});

describe("tikTokAdGroupBudgetFloor", () => {
  it("uses 20 daily and 20 × scheduled days for lifetime", () => {
    const daily = tikTokAdGroupBudgetFloor({
      budgetMode: "DAILY",
      startAt: "2026-05-01T09:00:00Z",
      endAt: "2026-05-08T09:00:00Z",
    });
    const lifetime = tikTokAdGroupBudgetFloor({
      budgetMode: "LIFETIME",
      startAt: "2026-05-01T09:00:00Z",
      endAt: "2026-05-08T09:00:00Z",
    });
    const missingEnd = tikTokAdGroupBudgetFloor({
      budgetMode: "LIFETIME",
      startAt: "2026-05-01T09:00:00Z",
      endAt: null,
    });
    assert.equal(daily.ok && daily.value, 20);
    assert.equal(lifetime.ok && lifetime.value, 140);
    assert.equal(missingEnd.ok, false);
  });
});

function sampleCreative() {
  return {
    id: "creative-1",
    name: "Hero",
    mode: "VIDEO_REFERENCE" as const,
    baseName: "Hero",
    videoId: "video_1",
    videoUrl: null,
    thumbnailUrl: null,
    durationSeconds: null,
    title: null,
    sparkPostId: null,
    caption: "",
    adText: "Ad text",
    displayName: "Off/Pixel",
    landingPageUrl: "https://example.com",
    cta: "LEARN_MORE",
    musicId: null,
  };
}

function payloadDraft() {
  const draft = createDefaultTikTokDraft("draft-1");
  draft.accountSetup.advertiserId = "adv-1";
  draft.accountSetup.identityId = "identity_1";
  draft.accountSetup.identityType = "TT_USER";
  draft.accountSetup.currency = "GBP";
  draft.campaignSetup.campaignName = "Campaign";
  draft.campaignSetup.objective = "TRAFFIC";
  draft.campaignSetup.optimisationGoal = "CLICK";
  draft.budgetSchedule.budgetMode = "DAILY";
  draft.budgetSchedule.budgetAmount = 50;
  draft.budgetSchedule.scheduleStartAt = "2026-05-01T09:00:00Z";
  draft.budgetSchedule.scheduleEndAt = "2026-05-08T09:00:00Z";
  draft.budgetSchedule.adGroups = [
    { id: "ag-1", name: "Prospecting", budget: 50, startAt: null, endAt: null },
  ];
  draft.creatives.items = [sampleCreative()];
  return draft;
}
