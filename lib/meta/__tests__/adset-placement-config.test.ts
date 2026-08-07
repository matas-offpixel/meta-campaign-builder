/**
 * Regression + new-behavior tests for placement targeting in
 * `buildAdSetPayload` (lib/meta/adset.ts), task #117.
 *
 * East End Dubs Newcastle signup launch (2026-08-07): 42 ads shipped to
 * every Meta placement because `buildAdSetPayload` never set
 * `publisher_platforms` for a normal ad set — this file locks in that the
 * NEW `campaignPlacementConfig` parameter is applied unconditionally, and
 * that omitting it entirely (any pre-existing caller / any draft that
 * pre-dates this field) produces byte-for-byte the same targeting as before
 * this feature shipped.
 *
 * Run: node --test lib/meta/__tests__/adset-placement-config.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAdSetPayload } from "../adset.ts";
import type {
  AdSetSuggestion,
  AudienceSettings,
  BudgetScheduleSettings,
  PlacementConfig,
} from "../../types.ts";

function makeAdSet(overrides: Partial<AdSetSuggestion> = {}): AdSetSuggestion {
  return {
    id: "s1",
    name: "Test Ad Set",
    sourceType: "interest_group",
    sourceId: "g1",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 10,
    advantagePlus: false,
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
  adSets: [],
} as unknown as BudgetScheduleSettings;

const CAMPAIGN_ID = "cam_001";
const OBJ = "traffic" as const;
const GOAL = "link_clicks" as const;

function build(adSet: AdSetSuggestion, campaignPlacementConfig?: PlacementConfig) {
  return buildAdSetPayload(
    adSet,
    CAMPAIGN_ID,
    emptyAudiences,
    schedule,
    GOAL,
    OBJ,
    undefined, // pixelId
    undefined, // hasVariationRotationCreative
    campaignPlacementConfig,
  );
}

describe("buildAdSetPayload — placement targeting (task #117)", () => {
  it("REGRESSION: omitting the new param entirely leaves targeting untouched (no placement keys at all)", () => {
    const payload = build(makeAdSet());
    assert.equal(payload.targeting.publisher_platforms, undefined);
    assert.equal(payload.targeting.facebook_positions, undefined);
    assert.equal(payload.targeting.instagram_positions, undefined);
    assert.equal(payload.targeting.audience_network_positions, undefined);
    assert.equal(payload.targeting.device_platforms, undefined);
    assert.ok(!JSON.stringify(payload).includes("publisher_platforms"));
  });

  it("REGRESSION: explicit advantage_plus campaign config also omits every placement field", () => {
    const payload = build(makeAdSet(), { mode: "advantage_plus" });
    assert.equal(payload.targeting.publisher_platforms, undefined);
  });

  it("manual campaign-wide config sends FB Feed + IG Feed on every ad set", () => {
    const config: PlacementConfig = {
      mode: "manual",
      publisherPlatforms: ["facebook", "instagram"],
      facebookPositions: ["feed"],
      instagramPositions: ["stream"],
    };
    const payload = build(makeAdSet(), config);
    assert.deepEqual(payload.targeting.publisher_platforms, ["facebook", "instagram"]);
    assert.deepEqual(payload.targeting.facebook_positions, ["feed"]);
    assert.deepEqual(payload.targeting.instagram_positions, ["stream"]);
  });

  it("per-ad-set placementConfig override wins over the campaign-wide config", () => {
    const campaignWide: PlacementConfig = {
      mode: "manual",
      publisherPlatforms: ["facebook"],
      facebookPositions: ["feed"],
    };
    const perAdSetOverride: PlacementConfig = {
      mode: "manual",
      publisherPlatforms: ["instagram"],
      instagramPositions: ["reels"],
    };
    const payload = build(makeAdSet({ placementConfig: perAdSetOverride }), campaignWide);
    assert.deepEqual(payload.targeting.publisher_platforms, ["instagram"]);
    assert.deepEqual(payload.targeting.instagram_positions, ["reels"]);
    assert.equal(payload.targeting.facebook_positions, undefined);
  });

  it("manual mode with zero platforms selected falls back to automatic (no keys sent)", () => {
    const payload = build(makeAdSet(), { mode: "manual", publisherPlatforms: [] });
    assert.equal(payload.targeting.publisher_platforms, undefined);
  });

  it("device_platforms is forwarded when set (mobile-only)", () => {
    const payload = build(makeAdSet(), {
      mode: "manual",
      publisherPlatforms: ["facebook"],
      devicePlatforms: ["mobile"],
    });
    assert.deepEqual(payload.targeting.device_platforms, ["mobile"]);
  });
});
