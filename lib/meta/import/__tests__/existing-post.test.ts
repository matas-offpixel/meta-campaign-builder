import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultDraft } from "../../../campaign-defaults.ts";
import { validateStep } from "../../../validation.ts";
import { mapMetaLiveCampaign } from "../map.ts";
import type { MetaLiveCampaignBundle } from "../types.ts";

function bundle(creative: Record<string, unknown>): MetaLiveCampaignBundle {
  return {
    campaign: { id: "1", name: "[NX26-SCHAK] SCHAK Signup", objective: "OUTCOME_LEADS" },
    adSets: [],
    ads: [],
    creatives: { c1: { id: "c1", ...creative } },
  };
}

describe("boosted post import", () => {
  it("maps a page-post story id as an existing Facebook post and does not copy the name into a caption", () => {
    const draft = mapMetaLiveCampaign({
      bundle: bundle({
        name: "Sign up link in bio Tickets on sale this Friday 2026-09-23-e86c8b00",
        effective_object_story_id: "111_222",
        video_id: "vid",
        body: "Sign up link in bio",
        link_url: "https://www.schak-newcastle.com/",
        call_to_action_type: "SIGN_UP",
        instagram_permalink_url: "https://www.instagram.com/reel/EXAMPLE/",
      }),
      adAccountId: "act_1",
      carry: ["c1"],
      availability: [],
    });
    const creative = draft.creatives[0]!;
    assert.equal(creative.sourceType, "existing_post");
    assert.equal(creative.existingPost?.source, "facebook");
    assert.equal(creative.existingPost?.postId, "111_222");
    assert.equal(creative.identity.pageId, "111");
    assert.equal(creative.name, "Sign up link in bio Tickets on sale this Friday 2026-09-23-e86c8b00");
    assert.equal(creative.mediaType, "video");
    assert.equal(creative.destinationUrl, "https://www.schak-newcastle.com/");
    assert.equal(creative.cta, "sign_up");
    assert.deepEqual(creative.captions, []);

    const checked = createDefaultDraft();
    checked.creatives = [creative];
    const result = validateStep(checked, 4);
    const joined = result.errors.join("\n");
    assert.doesNotMatch(joined, /Primary text/);
    assert.doesNotMatch(joined, /Destination URL/);
    assert.doesNotMatch(joined, /Facebook page is required/);
    assert.doesNotMatch(joined, /Select an existing post/);
  });

  it("maps a bare story id with instagram_user_id as an Instagram post", () => {
    const draft = mapMetaLiveCampaign({
      bundle: bundle({
        name: "IG post",
        object_story_id: "178900",
        image_hash: "abc",
        object_story_spec: { page_id: "555", instagram_user_id: "999" },
      }),
      adAccountId: "act_1",
      carry: ["c1"],
      availability: [],
    });
    const creative = draft.creatives[0]!;
    assert.equal(creative.existingPost?.source, "instagram");
    assert.equal(creative.existingPost?.postId, "178900");
    assert.equal(creative.existingPost?.instagramAccountId, "999");
    assert.equal(creative.identity.pageId, "555");
    assert.equal(creative.mediaType, "image");
  });

  it("carries link_url and drops a CTA the app does not have", () => {
    const draft = mapMetaLiveCampaign({
      bundle: bundle({
        name: "IG post",
        effective_object_story_id: "111_222",
        image_url: "https://example.com/post.jpg",
        instagram_permalink_url: "https://www.instagram.com/p/EXAMPLE/",
        link_url: "https://www.schak-newcastle.com/",
        call_to_action_type: "SEE_DETAILS",
      }),
      adAccountId: "act_1",
      carry: ["c1"],
      availability: [],
    });
    const creative = draft.creatives[0]!;
    assert.equal(creative.mediaType, "image");
    assert.equal(creative.destinationUrl, "https://www.schak-newcastle.com/");
    assert.equal(creative.cta, "");
    assert.equal(
      draft.importMeta?.dropped.some(
        (row) => row.field === "call_to_action_type" && row.value === "SEE_DETAILS",
      ),
      true,
    );
  });

  it("does not guess video when the post reports no media", () => {
    const draft = mapMetaLiveCampaign({
      bundle: bundle({
        name: "No media",
        effective_object_story_id: "111_222",
        instagram_permalink_url: "https://www.instagram.com/p/EXAMPLE/",
      }),
      adAccountId: "act_1",
      carry: ["c1"],
      availability: [],
    });
    assert.equal(draft.creatives.length, 0);
    assert.equal(draft.importMeta?.notCarried[0]?.reason, "no_media_reported");
  });

  it("does not carry a story id that cannot be launched", () => {
    const draft = mapMetaLiveCampaign({
      bundle: bundle({
        name: "gone",
        body: "The post caption",
        instagram_permalink_url: "https://www.instagram.com/reel/EXAMPLE/",
        effective_object_story_id: "not-a-page-post",
      }),
      adAccountId: "act_1",
      carry: ["c1"],
      availability: [],
    });
    assert.equal(draft.creatives.length, 0);
    assert.equal(draft.importMeta?.notCarried[0]?.reason, "post_unreachable");
  });

  it("keeps an asset_feed_spec creative as a new ad", () => {
    const draft = mapMetaLiveCampaign({
      bundle: bundle({
        name: "Built here",
        effective_object_story_id: "111_222",
        asset_feed_spec: {
          bodies: [{ text: "Caption from the feed spec" }],
          titles: [{ text: "Headline" }],
          link_urls: [{ website_url: "https://example.com/tickets" }],
          images: [{ hash: "abc" }],
        },
        object_story_spec: { page_id: "555" },
      }),
      adAccountId: "act_1",
      carry: ["c1"],
      availability: [],
    });
    const creative = draft.creatives[0]!;
    assert.equal(creative.sourceType, "new");
    assert.equal(creative.captions[0]?.text, "Caption from the feed spec");
    assert.equal(creative.headline, "Headline");
    assert.equal(creative.destinationUrl, "https://example.com/tickets");
  });
});
