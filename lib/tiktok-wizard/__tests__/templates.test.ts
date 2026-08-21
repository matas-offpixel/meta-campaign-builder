import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import {
  applyTikTokTemplate,
  snapshotTikTokDraft,
  tikTokTemplateAccountNotice,
  TIKTOK_TEMPLATE_ACCOUNT_CLEARED,
  TIKTOK_TEMPLATE_ACCOUNT_RESTORED,
  type TikTokCampaignTemplate,
} from "../templates.ts";

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
  source.accountSetup.advertiserId = "adv-live";
  source.accountSetup.identityId = "identity-1";
  source.accountSetup.identityDisplayName = "Brand";
  source.accountSetup.identityBcId = "bc-stale";
  source.accountSetup.optimisationEvent = "COMPLETE_PAYMENT";
  source.accountSetup.pixelId = "pixel-1";
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
    assert.equal(applied.draft.accountSetup.advertiserId, "adv-live");
    assert.equal(applied.draft.accountSetup.identityId, "identity-1");
    assert.equal(applied.draft.accountSetup.identityDisplayName, "Brand");
    assert.equal(applied.draft.accountSetup.optimisationEvent, "COMPLETE_PAYMENT");
    assert.equal(applied.draft.accountSetup.pixelId, "pixel-1");
    assert.equal(applied.draft.accountSetup.identityBcId, null);
    assert.equal(applied.draft.budgetSchedule.scheduleStartAt, null);
    assert.equal(applied.draft.budgetSchedule.scheduleEndAt, null);
    assert.equal(
      tikTokTemplateAccountNotice(applied.accountSetupRestored),
      TIKTOK_TEMPLATE_ACCOUNT_RESTORED,
    );
  });

  it("strips account setup when the target client differs", () => {
    const template = templateFromDraft(sourcedDraft());
    const applied = applyTikTokTemplate(template, "other-draft", "client-other");
    assert.equal(applied.accountSetupRestored, false);
    assert.equal(applied.draft.accountSetup.advertiserId, null);
    assert.equal(applied.draft.accountSetup.identityId, null);
    assert.equal(applied.draft.accountSetup.optimisationEvent, null);
    assert.equal(applied.draft.accountSetup.pixelId, null);
    assert.equal(applied.draft.budgetSchedule.scheduleStartAt, null);
    assert.equal(applied.draft.budgetSchedule.scheduleEndAt, null);
    assert.equal(
      tikTokTemplateAccountNotice(applied.accountSetupRestored),
      TIKTOK_TEMPLATE_ACCOUNT_CLEARED,
    );
  });

  it("still round-trips campaign configuration into a new draft", () => {
    const template = templateFromDraft(sourcedDraft());
    const loaded = applyTikTokTemplate(template, "new-draft").draft;

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
