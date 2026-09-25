import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCreativePayload } from "../creative.ts";
import { createDefaultDraft } from "../../campaign-defaults.ts";
import { validateStep } from "../../validation.ts";
import { setEveryCreativeDestinationUrl } from "../../wizard/import-edits.ts";
import type { AdCreativeDraft } from "../../types.ts";

const URL = "https://schak-newcastle.com/?ref=meta";

function existing(overrides: Partial<AdCreativeDraft> = {}): AdCreativeDraft {
  return {
    id: "cr",
    name: "Feed Post v1",
    sourceType: "existing_post",
    mediaType: "video",
    assetMode: "single",
    identity: { pageId: "109194631619954", instagramAccountId: "17841401050136820" },
    assetVariations: [],
    captions: [],
    headline: "",
    description: "",
    destinationUrl: "",
    cta: "" as AdCreativeDraft["cta"],
    enhancements: {
      enabled: false,
      textOptimizations: false,
      visualEnhancements: false,
      musicEnhancements: false,
      autoVariations: false,
    },
    existingPost: {
      source: "instagram",
      postId: "18149952778529453",
      instagramAccountId: "17841401050136820",
      mediaKind: "video",
    },
    ...overrides,
  };
}

describe("existing post destination", () => {
  it("sends the draft URL on an Instagram boost when it is set", async () => {
    const payload = await buildCreativePayload(existing({
      destinationUrl: URL,
      cta: "buy_tickets",
    }));
    assert.equal(payload.source_instagram_media_id, "18149952778529453");
    assert.equal(payload.instagram_user_id, "17841401050136820");
    assert.equal(payload.call_to_action?.type, "BUY_TICKETS");
    assert.equal(payload.call_to_action?.value?.link, URL);
    assert.equal(payload.object_story_spec, undefined);
  });

  it("sends the draft URL on a Facebook boost when it is set", async () => {
    const payload = await buildCreativePayload(existing({
      destinationUrl: URL,
      cta: "sign_up",
      existingPost: { source: "facebook", postId: "111_222", mediaKind: "video" },
    }));
    assert.equal(payload.object_story_id, "111_222");
    assert.equal(payload.call_to_action?.value?.link, URL);
    assert.equal(payload.call_to_action?.type, "SIGN_UP");
    assert.equal(payload.source_instagram_media_id, undefined);
  });

  it("leaves a boost with no URL bare", async () => {
    const payload = await buildCreativePayload(existing());
    assert.equal(payload.call_to_action, undefined);
    assert.deepEqual(Object.keys(payload).sort(), [
      "instagram_user_id",
      "name",
      "source_instagram_media_id",
    ]);
  });

  it("blocks an Instagram video with no URL in an offsite campaign, and not a carousel or an engagement campaign", () => {
    const video = createDefaultDraft();
    video.settings.objective = "initiate_checkout";
    video.creatives = [existing()];
    const blocked = validateStep(4, video);
    assert.match(blocked.errors.join("\n"), /Feed Post v1/);
    assert.match(blocked.errors.join("\n"), /Instagram video/);

    const carousel = createDefaultDraft();
    carousel.settings.objective = "initiate_checkout";
    carousel.creatives = [existing({
      name: "Feed Post v2",
      existingPost: {
        source: "instagram",
        postId: "18124756982308464",
        instagramAccountId: "17841401050136820",
        mediaKind: "carousel",
      },
    })];
    assert.equal(
      validateStep(4, carousel).errors.some((e) => /destination URL/.test(e)),
      false,
    );

    const engagement = createDefaultDraft();
    engagement.settings.objective = "engagement";
    engagement.creatives = [existing()];
    assert.equal(
      validateStep(4, engagement).errors.some((e) => /destination URL/.test(e)),
      false,
    );
  });

  it("set every URL updates an existing-post creative", () => {
    const next = setEveryCreativeDestinationUrl([existing()], `  ${URL} `);
    assert.equal(next[0]?.destinationUrl, URL);
  });
});
