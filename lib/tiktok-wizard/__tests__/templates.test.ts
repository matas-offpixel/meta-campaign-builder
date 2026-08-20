import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import { applyTikTokTemplate, snapshotTikTokDraft } from "../templates.ts";

describe("TikTok template round-trip", () => {
  it("saves the current configuration and loads it into a new draft", () => {
    const source = createDefaultTikTokDraft("source-1");
    source.accountSetup.advertiserId = "adv-live";
    source.accountSetup.identityDisplayName = "Brand";
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

    const snapshot = snapshotTikTokDraft(source);
    assert.equal(snapshot.accountSetup.advertiserId, null);
    assert.equal(snapshot.budgetSchedule.scheduleStartAt, null);
    assert.equal(snapshot.campaignSetup.campaignName, "Prospecting");
    assert.equal(snapshot.creatives.items.length, 1);

    const loaded = applyTikTokTemplate(
      {
        id: "tpl-1",
        name: "Electronic prospecting",
        description: "",
        tags: ["tiktok"],
        snapshot,
        createdAt: "2026-08-20T12:00:00.000Z",
        updatedAt: "2026-08-20T12:00:00.000Z",
      },
      "new-draft",
    );

    assert.equal(loaded.id, "new-draft");
    assert.equal(loaded.status, "draft");
    assert.equal(loaded.accountSetup.advertiserId, null);
    assert.equal(loaded.campaignSetup.campaignName, "Prospecting");
    assert.equal(loaded.campaignSetup.objective, "TRAFFIC");
    assert.equal(loaded.audiences.interestGroups[0]?.name, "London");
    assert.equal(loaded.creatives.items[0]?.videoId, "v1");
    assert.equal(loaded.budgetSchedule.budgetAmount, 50);
    assert.equal(loaded.budgetSchedule.scheduleStartAt, null);
    assert.equal(loaded.publishedIds, null);
  });
});
