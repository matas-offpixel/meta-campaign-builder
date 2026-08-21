import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createDefaultTikTokDraft,
  type TikTokAccountSetup,
} from "../../types/tiktok-draft.ts";
import {
  applyTikTokTemplate,
  snapshotTikTokDraft,
  tikTokTemplateAccountNotice,
  tikTokTemplateSameClient,
  TIKTOK_TEMPLATE_ACCOUNT_CLEARED,
  TIKTOK_TEMPLATE_ACCOUNT_RESTORED,
  TIKTOK_TEMPLATE_ACCOUNT_UNSCOPED,
  type TikTokCampaignTemplate,
} from "../templates.ts";

const STRIPPED_ACCOUNT_SETUP: TikTokAccountSetup = {
  tiktokAccountId: null,
  advertiserId: null,
  identityId: null,
  identityDisplayName: null,
  identityManualName: null,
  identityBcId: null,
  identityType: null,
  pixelId: null,
  pixelName: null,
  optimisationEvent: null,
  currency: null,
  timezone: null,
};

function templateFromDraft(
  draft: ReturnType<typeof createDefaultTikTokDraft>,
): TikTokCampaignTemplate {
  return {
    id: "tpl-1",
    name: "Electronic prospecting",
    description: "",
    tags: ["tiktok"],
    snapshot: snapshotTikTokDraft(draft),
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-20T12:00:00.000Z",
  };
}

function sourcedDraft() {
  const source = createDefaultTikTokDraft("source-1");
  source.clientId = "client-irw";
  source.eventId = "event-template";
  source.accountSetup.tiktokAccountId = "tt-account-1";
  source.accountSetup.advertiserId = "adv-live";
  source.accountSetup.identityId = "identity-1";
  source.accountSetup.identityDisplayName = "Brand";
  source.accountSetup.identityManualName = "Manual Brand";
  source.accountSetup.identityBcId = "bc-stale";
  source.accountSetup.identityType = "BC_AUTH_TT";
  source.accountSetup.optimisationEvent = "COMPLETE_PAYMENT";
  source.accountSetup.pixelId = "pixel-1";
  source.accountSetup.pixelName = "IRW Pixel";
  source.accountSetup.currency = "GBP";
  source.accountSetup.timezone = "Europe/London";
  source.campaignSetup.campaignName = "Prospecting";
  source.campaignSetup.objective = "TRAFFIC";
  source.audiences.interestGroups = [
    {
      id: "g1",
      name: "London",
      interestIds: [{ id: "kw-1", name: "Techno", kind: "keyword" }],
      hashtagIds: [],
      behaviourIds: [],
    },
  ];
  source.creatives.items = [
    {
      id: "c1",
      name: "Hero · v1",
      mode: "VIDEO_REFERENCE",
      baseName: "Hero",
      videoId: "v1",
      videoUrl: null,
      thumbnailUrl: "https://cdn.example/cover.jpg",
      thumbnailExpiresAt: "2026-08-20T18:00:00.000Z",
      durationSeconds: 8,
      title: "one.mp4",
      sparkPostId: null,
      caption: "Book now",
      adText: "Book now",
      displayName: "Brand",
      landingPageUrl: "https://example.com",
      cta: "LEARN_MORE",
      musicId: null,
    },
  ];
  source.budgetSchedule.budgetAmount = 50;
  source.budgetSchedule.scheduleStartAt = "2026-08-21T00:00:00.000Z";
  source.budgetSchedule.scheduleEndAt = "2026-08-22T00:00:00.000Z";
  return source;
}

describe("TikTok template account scope", () => {
  it("keeps account fields in the snapshot so same-client load can restore them", () => {
    const snapshot = snapshotTikTokDraft(sourcedDraft());
    assert.equal(snapshot.accountSetup.advertiserId, "adv-live");
    assert.equal(snapshot.accountSetup.identityId, "identity-1");
    assert.equal(snapshot.accountSetup.optimisationEvent, "COMPLETE_PAYMENT");
    assert.equal(snapshot.budgetSchedule.scheduleStartAt, null);
    assert.equal(snapshot.budgetSchedule.scheduleEndAt, null);
  });

  it("restores advertiser, identity and optimisation event for the same client", () => {
    const template = templateFromDraft(sourcedDraft());
    const applied = applyTikTokTemplate(template, "new-draft", "client-irw");
    assert.equal(applied.accountSetupRestored, true);
    assert.equal(applied.draft.clientId, "client-irw");
    assert.equal(applied.draft.accountSetup.advertiserId, "adv-live");
    assert.equal(applied.draft.accountSetup.identityId, "identity-1");
    assert.equal(applied.draft.accountSetup.identityDisplayName, "Brand");
    assert.equal(applied.draft.accountSetup.optimisationEvent, "COMPLETE_PAYMENT");
    assert.equal(applied.draft.accountSetup.pixelId, "pixel-1");
    assert.equal(applied.draft.accountSetup.identityBcId, null);
    assert.equal(applied.draft.budgetSchedule.scheduleStartAt, null);
    assert.equal(applied.draft.budgetSchedule.scheduleEndAt, null);
    assert.equal(applied.accountNotice, TIKTOK_TEMPLATE_ACCOUNT_RESTORED);
  });

  it("strips every account field when the target client differs", () => {
    const template = templateFromDraft(sourcedDraft());
    const applied = applyTikTokTemplate(template, "other-draft", "client-other");
    assert.equal(applied.accountSetupRestored, false);
    assert.equal(applied.draft.clientId, "client-other");
    assert.equal(applied.draft.eventId, null);
    assert.deepEqual(applied.draft.accountSetup, STRIPPED_ACCOUNT_SETUP);
    assert.equal(applied.draft.budgetSchedule.scheduleStartAt, null);
    assert.equal(applied.draft.budgetSchedule.scheduleEndAt, null);
    assert.equal(applied.accountNotice, TIKTOK_TEMPLATE_ACCOUNT_CLEARED);
  });

  it("does not rewrite the target client, so a second foreign apply stays stripped", () => {
    const template = templateFromDraft(sourcedDraft());
    const first = applyTikTokTemplate(template, "d", "client-other");
    assert.equal(first.draft.clientId, "client-other");
    assert.deepEqual(first.draft.accountSetup, STRIPPED_ACCOUNT_SETUP);

    const second = applyTikTokTemplate(template, "d", first.draft.clientId);
    assert.equal(second.draft.clientId, "client-other");
    assert.deepEqual(second.draft.accountSetup, STRIPPED_ACCOUNT_SETUP);
    assert.equal(template.snapshot.clientId, "client-irw");
    assert.equal(second.accountSetupRestored, false);
  });

  it("keeps the target eventId and drops the snapshot event", () => {
    const template = templateFromDraft(sourcedDraft());
    const applied = applyTikTokTemplate(
      template,
      "d",
      "client-other",
      "event-keep",
    );
    assert.equal(applied.draft.eventId, "event-keep");
    assert.notEqual(applied.draft.eventId, template.snapshot.eventId);
  });

  it("still round-trips campaign configuration into a new draft", () => {
    const template = templateFromDraft(sourcedDraft());
    const loaded = applyTikTokTemplate(template, "new-draft", "client-irw").draft;

    assert.equal(loaded.id, "new-draft");
    assert.equal(loaded.status, "draft");
    assert.equal(loaded.campaignSetup.campaignName, "Prospecting");
    assert.equal(loaded.campaignSetup.objective, "TRAFFIC");
    assert.equal(loaded.audiences.interestGroups[0]?.name, "London");
    assert.equal(loaded.creatives.items[0]?.videoId, "v1");
    assert.equal(loaded.budgetSchedule.budgetAmount, 50);
    assert.equal(loaded.publishedIds, null);
  });
});

describe("tikTokTemplateSameClient", () => {
  it("requires two non-empty client ids", () => {
    assert.equal(tikTokTemplateSameClient(null, null), false);
    assert.equal(tikTokTemplateSameClient(undefined, undefined), false);
    assert.equal(tikTokTemplateSameClient("", ""), false);
    assert.equal(tikTokTemplateSameClient("   ", "   "), false);
    assert.equal(tikTokTemplateSameClient("client-irw", "client-other"), false);
    assert.equal(tikTokTemplateSameClient("client-irw", "client-irw"), true);
  });
});

describe("tikTokTemplateAccountNotice", () => {
  it("has a third branch when either side has no client", () => {
    assert.equal(
      tikTokTemplateAccountNotice({
        restored: false,
        templateClientId: null,
        targetClientId: null,
      }),
      TIKTOK_TEMPLATE_ACCOUNT_UNSCOPED,
    );
    assert.equal(
      tikTokTemplateAccountNotice({
        restored: false,
        templateClientId: "client-irw",
        targetClientId: "client-other",
      }),
      TIKTOK_TEMPLATE_ACCOUNT_CLEARED,
    );
    assert.equal(
      tikTokTemplateAccountNotice({
        restored: true,
        templateClientId: "client-irw",
        targetClientId: "client-irw",
      }),
      TIKTOK_TEMPLATE_ACCOUNT_RESTORED,
    );
  });
});
