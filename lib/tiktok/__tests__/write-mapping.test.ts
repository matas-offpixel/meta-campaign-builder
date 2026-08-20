import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import {
  TIKTOK_LOCATION_IDS_BY_CODE,
  buildTikTokAdPayload,
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
    const manual = mapTikTokIdentityType("MANUAL");
    const ttUser = mapTikTokIdentityType("TT_USER");
    assert.equal(manual.ok, true);
    if (manual.ok) assert.equal(manual.value, "CUSTOMIZED_USER");
    assert.equal(ttUser.ok, true);
    if (ttUser.ok) assert.equal(ttUser.value, "TT_USER");
    assert.equal(mapTikTokPromotionType(), "WEBSITE");
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
    const creatives = result.value.creatives as Array<Record<string, unknown>>;
    assert.equal(creatives[0].creative_authorized, false);
    assert.equal(creatives[0].identity_id, "identity_1");
    assert.equal(creatives[0].identity_type, "TT_USER");
  });
});
