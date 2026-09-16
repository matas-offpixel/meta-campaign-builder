import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import {
  buildTikTokAdGroupPayload,
  buildTikTokAdPayload,
  buildTikTokCampaignPayload,
  resolveTikTokLaunchOperationStatus,
  tikTokScheduledDays,
} from "../../tiktok/write/mapping.ts";
import {
  formatTikTokLaunchClock,
  isTikTokLaunchPaused,
  parseTikTokLaunchPaused,
  tikTokLaunchButtonLabel,
  tikTokLaunchConfirmMessage,
  tikTokLaunchLiveFacts,
  tikTokLaunchLiveSuccessDescription,
  tikTokLaunchPausedConfirmMessage,
  tikTokLaunchPausedSuccessDescription,
  tikTokLaunchWasDeliveredPaused,
} from "../launch-live.ts";

function ironworksDraft() {
  const draft = createDefaultTikTokDraft("tiktok-launch-live");
  draft.accountSetup.advertiserId = "7639802149165301776";
  draft.accountSetup.identityId = "identity_1";
  draft.accountSetup.identityDisplayName = "Ironworks";
  draft.accountSetup.identityType = "TT_USER";
  draft.accountSetup.currency = "GBP";
  draft.accountSetup.timezone = "Etc/GMT";
  draft.accountSetup.pixelId = "px-1";
  draft.accountSetup.optimisationEvent = "SHOPPING";
  draft.campaignSetup.campaignName = "[IRW0001] On Sale";
  draft.campaignSetup.objective = "CONVERSIONS";
  draft.campaignSetup.optimisationGoal = "CONVERSION";
  draft.campaignSetup.bidStrategy = "LOWEST_COST";
  draft.optimisation.bidStrategy = "LOWEST_COST";
  draft.budgetSchedule.budgetMode = "DAILY";
  draft.budgetSchedule.budgetAmount = 50;
  draft.budgetSchedule.scheduleStartAt = "2026-09-17T09:00";
  draft.budgetSchedule.scheduleEndAt = "2026-10-04T09:00";
  draft.budgetSchedule.adGroups = [
    { id: "ag-1", name: "London", budget: 50, startAt: null, endAt: null },
  ];
  draft.creatives.items = [
    creative("c-1", "Hero"),
    creative("c-2", "Overlay"),
  ];
  draft.creativeAssignments.byAdGroupId = { "ag-1": ["c-1", "c-2"] };
  return draft;
}

function creative(id: string, name: string) {
  return {
    id,
    name,
    mode: "VIDEO_REFERENCE" as const,
    baseName: name,
    videoId: `video-${id}`,
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
    cta: "LEARN_MORE" as const,
    musicId: null,
  };
}

describe("TikTok launch live vs paused", () => {
  it("a live launch sends ENABLE at campaign, ad group, and ad separately", () => {
    const draft = ironworksDraft();
    draft.launchPaused = false;
    const campaign = buildTikTokCampaignPayload({
      advertiserId: "7639802149165301776",
      draft,
    });
    const adGroup = buildTikTokAdGroupPayload({
      advertiserId: "7639802149165301776",
      campaignId: "camp-1",
      draft,
      adGroup: draft.budgetSchedule.adGroups[0],
    });
    const ad = buildTikTokAdPayload({
      advertiserId: "7639802149165301776",
      adGroupId: "ag-1",
      draft,
      creative: draft.creatives.items[0],
    });
    assert.equal(campaign.ok, true, campaign.ok ? "" : campaign.error.message);
    assert.equal(campaign.value.operation_status, "ENABLE");
    assert.equal(adGroup.ok, true, adGroup.ok ? "" : adGroup.error.message);
    assert.equal(adGroup.value.operation_status, "ENABLE");
    assert.equal(ad.ok, true, ad.ok ? "" : ad.error.message);
    assert.equal(ad.value.operation_status, "ENABLE");
  });

  it("a paused launch sends DISABLE at all three, matching today's status", () => {
    const draft = ironworksDraft();
    draft.launchPaused = true;
    const campaign = buildTikTokCampaignPayload({
      advertiserId: "7639802149165301776",
      draft,
    });
    const adGroup = buildTikTokAdGroupPayload({
      advertiserId: "7639802149165301776",
      campaignId: "camp-1",
      draft,
      adGroup: draft.budgetSchedule.adGroups[0],
    });
    const ad = buildTikTokAdPayload({
      advertiserId: "7639802149165301776",
      adGroupId: "ag-1",
      draft,
      creative: draft.creatives.items[0],
    });
    assert.equal(campaign.ok, true, campaign.ok ? "" : campaign.error.message);
    assert.equal(campaign.value.operation_status, "DISABLE");
    assert.equal(adGroup.ok, true, adGroup.ok ? "" : adGroup.error.message);
    assert.equal(adGroup.value.operation_status, "DISABLE");
    assert.equal(ad.ok, true, ad.ok ? "" : ad.error.message);
    assert.equal(ad.value.operation_status, "DISABLE");
  });

  it("a draft with no stored choice launches live", () => {
    const draft = ironworksDraft();
    assert.equal(draft.launchPaused, undefined);
    assert.equal(isTikTokLaunchPaused(draft), false);
    assert.equal(resolveTikTokLaunchOperationStatus(draft), "ENABLE");
    assert.equal(tikTokLaunchButtonLabel(false), "Launch live on TikTok");
    assert.equal(tikTokLaunchButtonLabel(true), "Launch paused on TikTok");
  });

  it("the confirmation sentence is budget × days, advertiser timezone, and assignment count", () => {
    const draft = ironworksDraft();
    const facts = tikTokLaunchLiveFacts(draft, { advertiserName: "Ironworks" });
    const days = tikTokScheduledDays(
      draft.budgetSchedule.scheduleStartAt,
      draft.budgetSchedule.scheduleEndAt,
    );
    assert.equal(days, 17);
    assert.equal(facts.days, 17);
    assert.equal(facts.dailyBudget, 50);
    assert.equal(facts.ceiling, 50 * 17);
    assert.equal(facts.timezone, "Etc/GMT");
    assert.equal(facts.startClock, "17 Sept 09:00 Etc/GMT");
    assert.equal(facts.adGroupCount, 1);
    assert.equal(facts.adCount, 2);
    assert.equal(facts.adCount, draft.creativeAssignments.byAdGroupId["ag-1"]?.length);
    const message = tikTokLaunchConfirmMessage(draft, {
      advertiserName: "Ironworks",
    });
    assert.equal(
      message,
      "Up to £850 over 17 days (£50 daily) on Ironworks (7639802149165301776), starting 17 Sept 09:00 Etc/GMT. 1 ad group and 2 ads start delivering at the start time.",
    );
    draft.launchPaused = true;
    assert.equal(
      tikTokLaunchConfirmMessage(draft),
      tikTokLaunchPausedConfirmMessage(),
    );
  });

  it("historical published drafts without a stored choice keep paused success copy", () => {
    const draft = ironworksDraft();
    draft.publishedIds = {
      campaignId: "1874142286754113",
      adgroupIds: ["ag"],
      adIds: ["ad"],
      launchedAt: "2026-08-21T00:00:00.000Z",
    };
    assert.equal(tikTokLaunchWasDeliveredPaused(draft), true);
    draft.launchPaused = false;
    assert.equal(tikTokLaunchWasDeliveredPaused(draft), false);
    assert.match(
      tikTokLaunchLiveSuccessDescription({
        scheduleStartAt: draft.budgetSchedule.scheduleStartAt,
        timezone: draft.accountSetup.timezone,
      }),
      /Delivery starts 17 Sept 09:00 Etc\/GMT/,
    );
    assert.match(
      tikTokLaunchPausedSuccessDescription(),
      /Nothing will deliver until it is enabled in Ads Manager/,
    );
  });

  it("operation_status is a decision, not a hard-coded literal", () => {
    const mapping = readFileSync("lib/tiktok/write/mapping.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(
      mapping,
      /operation_status:\s*["'](?:ENABLE|DISABLE)["']/,
    );
    const uses =
      mapping.match(/operation_status:\s*resolveTikTokLaunchOperationStatus\(/g) ??
      [];
    assert.equal(uses.length, 3);
  });

  it("Review confirms before the write and the button names the mode", () => {
    const source = readFileSync(
      "components/tiktok-wizard/steps/review-launch.tsx",
      "utf8",
    );
    assert.match(source, /window\.confirm\(launchConfirmMessage\)/);
    assert.match(source, /tikTokLaunchButtonLabel\(launchPaused\)/);
    assert.match(source, /persistLaunchPaused/);
    assert.doesNotMatch(source, /Launch on TikTok/);
  });

  it("formats the advertiser wall clock without converting it", () => {
    assert.equal(
      formatTikTokLaunchClock("2026-09-17T09:00", "Etc/GMT"),
      "17 Sept 09:00 Etc/GMT",
    );
  });

  it("the request mode overrides a stored opposite choice at all three levels", () => {
    const storedLive = ironworksDraft();
    storedLive.launchPaused = false;
    const requestPaused = parseTikTokLaunchPaused(true);
    assert.equal(requestPaused.ok, true);
    if (!requestPaused.ok) return;
    storedLive.launchPaused = requestPaused.value;
    const pausedCampaign = buildTikTokCampaignPayload({
      advertiserId: "7639802149165301776",
      draft: storedLive,
    });
    const pausedAdGroup = buildTikTokAdGroupPayload({
      advertiserId: "7639802149165301776",
      campaignId: "camp-1",
      draft: storedLive,
      adGroup: storedLive.budgetSchedule.adGroups[0],
    });
    const pausedAd = buildTikTokAdPayload({
      advertiserId: "7639802149165301776",
      adGroupId: "ag-1",
      draft: storedLive,
      creative: storedLive.creatives.items[0],
    });
    assert.equal(pausedCampaign.ok, true);
    if (!pausedCampaign.ok) return;
    assert.equal(pausedCampaign.value.operation_status, "DISABLE");
    assert.equal(pausedAdGroup.ok, true);
    if (!pausedAdGroup.ok) return;
    assert.equal(pausedAdGroup.value.operation_status, "DISABLE");
    assert.equal(pausedAd.ok, true);
    if (!pausedAd.ok) return;
    assert.equal(pausedAd.value.operation_status, "DISABLE");

    const storedPaused = ironworksDraft();
    storedPaused.launchPaused = true;
    const requestLive = parseTikTokLaunchPaused(false);
    assert.equal(requestLive.ok, true);
    if (!requestLive.ok) return;
    storedPaused.launchPaused = requestLive.value;
    const liveCampaign = buildTikTokCampaignPayload({
      advertiserId: "7639802149165301776",
      draft: storedPaused,
    });
    const liveAdGroup = buildTikTokAdGroupPayload({
      advertiserId: "7639802149165301776",
      campaignId: "camp-1",
      draft: storedPaused,
      adGroup: storedPaused.budgetSchedule.adGroups[0],
    });
    const liveAd = buildTikTokAdPayload({
      advertiserId: "7639802149165301776",
      adGroupId: "ag-1",
      draft: storedPaused,
      creative: storedPaused.creatives.items[0],
    });
    assert.equal(liveCampaign.ok, true);
    if (!liveCampaign.ok) return;
    assert.equal(liveCampaign.value.operation_status, "ENABLE");
    assert.equal(liveAdGroup.ok, true);
    if (!liveAdGroup.ok) return;
    assert.equal(liveAdGroup.value.operation_status, "ENABLE");
    assert.equal(liveAd.ok, true);
    if (!liveAd.ok) return;
    assert.equal(liveAd.value.operation_status, "ENABLE");
  });

  it("a request with no launchPaused is live; a string is not a boolean", () => {
    assert.deepEqual(parseTikTokLaunchPaused(undefined), {
      ok: true,
      value: false,
    });
    assert.deepEqual(parseTikTokLaunchPaused(false), {
      ok: true,
      value: false,
    });
    assert.deepEqual(parseTikTokLaunchPaused(true), {
      ok: true,
      value: true,
    });
    const coerced = parseTikTokLaunchPaused("false");
    assert.equal(coerced.ok, false);
    if (coerced.ok) return;
    assert.match(coerced.error, /boolean/);
  });

  it("the POST body carries launchPaused and does not flush a save before the write", () => {
    const source = readFileSync(
      "components/tiktok-wizard/steps/review-launch.tsx",
      "utf8",
    );
    assert.match(
      source,
      /JSON\.stringify\(\{\s*draftId: draft\.id,\s*launchPaused: paused\s*\}\)/,
    );
    const launchFn = source.slice(
      source.indexOf("async function launchOnTikTok"),
      source.indexOf("function downloadBrief"),
    );
    assert.doesNotMatch(launchFn, /persistLaunchPaused/);
    assert.doesNotMatch(launchFn, /flushPendingSaves/);
    const handler = readFileSync("lib/tiktok/write/launch.ts", "utf8");
    assert.match(handler, /parseTikTokLaunchPaused\(input\.launchPaused\)/);
    assert.match(handler, /draft\.launchPaused = parsedPaused\.value/);
    assert.match(handler, /launchPaused: parsedPaused\.value/);
  });
});
