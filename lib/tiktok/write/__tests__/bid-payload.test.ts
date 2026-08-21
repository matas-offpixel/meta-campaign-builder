import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultTikTokDraft } from "../../../types/tiktok-draft.ts";
import { buildTikTokAdGroupPayload } from "../mapping.ts";
import { collectTikTokLaunchPreflight } from "../preflight.ts";

describe("TikTok ad-group bid payload", () => {
  it("sends conversion_bid_price for COST_CAP + CONVERT", () => {
    const draft = conversionDraft();
    draft.campaignSetup.bidStrategy = "COST_CAP";
    draft.optimisation.bidStrategy = "COST_CAP";
    draft.optimisation.targetCostPerResult = 1.5;
    draft.optimisation.benchmarkCpc = 9.99;

    const result = buildTikTokAdGroupPayload({
      advertiserId: "adv-1",
      campaignId: "camp-1",
      draft,
      adGroup: draft.budgetSchedule.adGroups[0],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.bid_type, "BID_TYPE_CUSTOM");
    assert.equal(result.value.conversion_bid_price, 1.5);
    assert.equal(result.value.bid_price, undefined);
  });

  it("sends bid_price for COST_CAP + CLICK, not conversion_bid_price", () => {
    const draft = clickDraft();
    draft.campaignSetup.bidStrategy = "COST_CAP";
    draft.optimisation.bidStrategy = "COST_CAP";
    draft.optimisation.benchmarkCpc = 1.5;
    draft.optimisation.targetCostPerResult = 9.99;

    const result = buildTikTokAdGroupPayload({
      advertiserId: "adv-1",
      campaignId: "camp-1",
      draft,
      adGroup: draft.budgetSchedule.adGroups[0],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.bid_type, "BID_TYPE_CUSTOM");
    assert.equal(result.value.bid_price, 1.5);
    assert.equal(result.value.conversion_bid_price, undefined);
  });

  it("blocks launch when bidStrategy is null", () => {
    const draft = clickDraft();
    draft.campaignSetup.bidStrategy = null;
    draft.optimisation.bidStrategy = null;

    const result = collectTikTokLaunchPreflight(draft);
    assert.equal(result.ok, false);
    const issue = result.issues.find((entry) => entry.id === "bid-strategy");
    assert.ok(issue);
    assert.equal(issue.field, "bidStrategy");
    assert.match(issue.message, /no bid/i);
  });

  it("sends BID_TYPE_NO_BID for LOWEST_COST with neither bid field", () => {
    const draft = clickDraft();
    draft.campaignSetup.bidStrategy = "LOWEST_COST";
    draft.optimisation.bidStrategy = "LOWEST_COST";
    draft.optimisation.benchmarkCpc = 1.5;
    draft.optimisation.targetCostPerResult = 1.5;

    const result = buildTikTokAdGroupPayload({
      advertiserId: "adv-1",
      campaignId: "camp-1",
      draft,
      adGroup: draft.budgetSchedule.adGroups[0],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.bid_type, "BID_TYPE_NO_BID");
    assert.equal(result.value.bid_price, undefined);
    assert.equal(result.value.conversion_bid_price, undefined);
  });
});

function clickDraft() {
  const draft = createDefaultTikTokDraft("draft-1");
  draft.eventId = "00000000-0000-0000-0000-000000000002";
  draft.accountSetup.advertiserId = "adv-1";
  draft.accountSetup.identityId = "identity_1";
  draft.accountSetup.identityType = "TT_USER";
  draft.accountSetup.currency = "GBP";
  draft.accountSetup.timezone = "America/New_York";
  draft.campaignSetup.campaignName = "Campaign";
  draft.campaignSetup.objective = "TRAFFIC";
  draft.campaignSetup.optimisationGoal = "CLICK";
  draft.campaignSetup.bidStrategy = "LOWEST_COST";
  draft.optimisation.bidStrategy = "LOWEST_COST";
  draft.budgetSchedule.budgetMode = "DAILY";
  draft.budgetSchedule.budgetAmount = 50;
  draft.budgetSchedule.scheduleStartAt = "2027-09-01T09:00:00Z";
  draft.budgetSchedule.scheduleEndAt = "2027-09-08T09:00:00Z";
  draft.budgetSchedule.adGroups = [
    { id: "ag-1", name: "Prospecting", budget: 50, startAt: null, endAt: null },
  ];
  draft.creatives.items = [sampleCreative()];
  draft.creativeAssignments.byAdGroupId = { "ag-1": ["creative-1"] };
  return draft;
}

function conversionDraft() {
  const draft = clickDraft();
  draft.campaignSetup.objective = "LEAD_GENERATION";
  draft.campaignSetup.optimisationGoal = "CONVERSION";
  draft.accountSetup.pixelId = "px-1";
  draft.accountSetup.optimisationEvent = "ON_WEB_REGISTER";
  return draft;
}

function sampleCreative() {
  return {
    id: "creative-1",
    name: "Hero",
    mode: "VIDEO_REFERENCE" as const,
    baseName: "Hero",
    videoId: "video_1",
    videoUrl: null,
    thumbnailUrl: null,
    coverImageId: "img_hero_1",
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
