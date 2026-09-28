import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { stampPublishedCreatives } from "../persist-launch-creatives.ts";
import type { AdCreativeDraft } from "../../types.ts";

function creative(id: string, name: string): AdCreativeDraft {
  return {
    id,
    name,
    sourceType: "new",
    mediaType: "image",
    assetMode: "single",
    identity: { pageId: "1", instagramAccountId: "" },
    assetVariations: [],
    captions: [],
    headline: "",
    description: "",
    destinationUrl: "https://example.com",
    cta: "learn_more",
    enhancements: {
      enabled: false,
      textOptimizations: false,
      visualEnhancements: false,
      musicEnhancements: false,
      autoVariations: false,
    },
  };
}

describe("stampPublishedCreatives", () => {
  it("persists both creatives' meta ids and leaves a Phase 3 failure unstamped", () => {
    const feed = creative("c-feed", "Feed");
    const story = creative("c-story", "Story");
    const failed = creative("c-broken", "Broken");

    const stamped = stampPublishedCreatives(
      [feed, story, failed],
      [
        {
          name: "Feed",
          metaCreativeId: "meta-cr-feed",
          ads: [
            { adSetName: "UK", metaAdId: "ad-feed-1", durationMs: 11 },
            { adSetName: "IE", metaAdId: "ad-feed-2", durationMs: 12 },
          ],
        },
        {
          name: "Story",
          metaCreativeId: "meta-cr-story",
          ads: [{ adSetName: "UK", metaAdId: "ad-story-1", durationMs: 9 }],
        },
      ],
      new Map<string, string[]>([
        ["Feed", ["ad-feed-mc"]],
        ["Broken", ["ad-from-failed-attempt"]],
      ]),
    );

    assert.equal(stamped[0]?.metaCreativeId, "meta-cr-feed");
    assert.deepEqual(stamped[0]?.metaAdIds, ["ad-feed-1", "ad-feed-2", "ad-feed-mc"]);
    assert.equal(stamped[1]?.metaCreativeId, "meta-cr-story");
    assert.deepEqual(stamped[1]?.metaAdIds, ["ad-story-1"]);
    assert.equal(stamped[2]?.metaCreativeId, undefined);
    assert.equal(stamped[2]?.metaAdIds, undefined);
    assert.equal(Object.hasOwn(stamped[2] ?? {}, "metaCreativeId"), false);
    assert.equal(Object.hasOwn(stamped[2] ?? {}, "metaAdIds"), false);
    assert.equal(stamped[2], failed);
    assert.equal(feed.metaCreativeId, undefined);
    assert.equal(feed.metaAdIds, undefined);
  });
});

describe("launch route persist", () => {
  it("assigns publishedDraft.creatives from the stamp and still strips metaAdSetId", () => {
    const src = readFileSync("app/api/meta/launch-campaign/route.ts", "utf8");
    const start = src.indexOf("const publishedDraft: CampaignDraft = {");
    assert.ok(start > 0, "publishedDraft persist block");
    const block = src.slice(start, src.indexOf("};", start));
    const spreadAt = block.indexOf("...draft");
    const creativesAt = block.search(/creatives:\s*stampPublishedCreatives\(/);
    assert.ok(spreadAt >= 0 && creativesAt > spreadAt, "creatives: must override the spread draft");
    assert.match(block, /updatedCreatives/);
    assert.match(block, /creativesCreated/);
    assert.match(block, /multiCampaignAdIdsByName/);
    assert.match(
      src,
      /const cleanSuggestions = draft\.adSetSuggestions\.map\(\(\{ metaAdSetId: _id, \.\.\.rest \}\) => rest\)/,
    );
    assert.match(block, /adSetSuggestions: cleanSuggestions/);
  });
});
