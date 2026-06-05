/**
 * Tests for Placement Asset Customization (per-placement creatives).
 *
 * Covers:
 *   - Multi-ratio video → asset_feed_spec.videos with distinct adlabels + rules
 *   - Multi-ratio image → asset_feed_spec.images with distinct adlabels + rules
 *   - asset_customization_rules: 9:16 → story/reels, 4:5 → catch-all default
 *   - Single-aspect → NO asset_feed_spec (legacy path, no regression)
 *   - Mixed media (image + video) → falls through to single-asset path
 *   - Feature flag OFF → legacy single-asset path even for multi-ratio
 *   - Sanitizer: user-configured asset_feed_spec preserved; Advantage+ stripped
 *
 * Run: node --test (the repo's test runner). The build path is gated behind
 * ENABLE_MULTI_PLACEMENT_ASSETS — these tests set/unset it per-case.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  buildCreativePayload,
  sanitizeCreativeForStrictMode,
  type MetaCreativePayload,
} from "../creative.ts";
import type { AdCreativeDraft } from "../../types.ts";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const baseEnhancements = {
  enabled: false,
  textOptimizations: false,
  visualEnhancements: false,
  musicEnhancements: false,
  autoVariations: false,
} as const;

function baseCreative(overrides: Partial<AdCreativeDraft> = {}): AdCreativeDraft {
  return {
    id: "cr_test",
    name: "Test Creative",
    sourceType: "new",
    mediaType: "video",
    assetMode: "dual",
    identity: { pageId: "pg_123", instagramAccountId: "" },
    assetVariations: [{ id: "var_1", name: "Variation 1", assets: [] }],
    captions: [{ id: "cap_1", text: "Come see us live" }],
    headline: "Buy tickets now",
    description: "Limited availability",
    destinationUrl: "https://example.com/tickets",
    cta: "book_now",
    enhancements: baseEnhancements,
    ...overrides,
  };
}

function dualVideoCreative(): AdCreativeDraft {
  return baseCreative({
    mediaType: "video",
    assetVariations: [
      {
        id: "var_1",
        name: "Variation 1",
        assets: [
          {
            id: "a_45",
            aspectRatio: "4:5",
            uploadStatus: "uploaded",
            videoId: "vid_45",
            thumbnailUrl: "https://cdn/thumb_45.jpg",
          },
          {
            id: "a_916",
            aspectRatio: "9:16",
            uploadStatus: "uploaded",
            videoId: "vid_916",
            thumbnailUrl: "https://cdn/thumb_916.jpg",
          },
        ],
      },
    ],
  });
}

function dualImageCreative(): AdCreativeDraft {
  return baseCreative({
    mediaType: "image",
    assetVariations: [
      {
        id: "var_1",
        name: "Variation 1",
        assets: [
          { id: "a_45", aspectRatio: "4:5", uploadStatus: "uploaded", assetHash: "hash_45" },
          { id: "a_916", aspectRatio: "9:16", uploadStatus: "uploaded", assetHash: "hash_916" },
        ],
      },
    ],
  });
}

// Helper: locate a rule by which label field it carries.
function ruleForLabel(
  payload: MetaCreativePayload,
  field: "image_label" | "video_label",
  name: string,
) {
  return payload.asset_feed_spec?.asset_customization_rules?.find(
    (r) => r[field]?.name === name,
  );
}

// ─── Feature-flag harness ─────────────────────────────────────────────────────

const ORIG_FLAG = process.env.ENABLE_MULTI_PLACEMENT_ASSETS;
afterEach(() => {
  if (ORIG_FLAG === undefined) delete process.env.ENABLE_MULTI_PLACEMENT_ASSETS;
  else process.env.ENABLE_MULTI_PLACEMENT_ASSETS = ORIG_FLAG;
});

// ─── Multi-ratio video ────────────────────────────────────────────────────────

describe("buildMultiPlacementCreative — video (flag ON)", () => {
  it("emits asset_feed_spec.videos with both ids and distinct adlabels", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const payload = buildCreativePayload(dualVideoCreative());

    const videos = payload.asset_feed_spec?.videos ?? [];
    assert.equal(videos.length, 2, "both video assets present");

    const ids = videos.map((v) => v.video_id).sort();
    assert.deepEqual(ids, ["vid_45", "vid_916"]);

    const labels = videos.flatMap((v) => v.adlabels.map((l) => l.name)).sort();
    assert.deepEqual(labels, ["feed_asset", "story_asset"]);

    assert.deepEqual(payload.asset_feed_spec?.ad_formats, ["SINGLE_VIDEO"]);
    // object_story_spec carries page_id ONLY (assets live in asset_feed_spec)
    assert.equal(payload.object_story_spec?.page_id, "pg_123");
    assert.equal(payload.object_story_spec?.video_data, undefined);
    assert.equal(payload.object_story_spec?.link_data, undefined);
  });

  it("9:16 rule maps to story/reels; 4:5 rule is the empty-spec default", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const payload = buildCreativePayload(dualVideoCreative());

    const rules = payload.asset_feed_spec?.asset_customization_rules ?? [];
    assert.ok(rules.length >= 2, "Meta requires at least two rules");

    const storyRule = ruleForLabel(payload, "video_label", "story_asset");
    assert.ok(storyRule, "story rule present");
    assert.deepEqual(storyRule!.customization_spec.instagram_positions, ["story", "reels"]);
    assert.deepEqual(storyRule!.customization_spec.facebook_positions, ["story", "facebook_reels"]);

    const feedRule = ruleForLabel(payload, "video_label", "feed_asset");
    assert.ok(feedRule, "feed rule present");
    assert.deepEqual(
      feedRule!.customization_spec,
      {},
      "feed rule uses empty customization_spec (catch-all default)",
    );

    // The default catch-all must be the LAST rule.
    assert.equal(
      rules[rules.length - 1].video_label?.name,
      "feed_asset",
      "empty-spec default rule must be last",
    );
  });

  it("attaches the correct thumbnail to each video asset", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const payload = buildCreativePayload(dualVideoCreative());
    const videos = payload.asset_feed_spec?.videos ?? [];
    const feedVid = videos.find((v) => v.adlabels.some((l) => l.name === "feed_asset"));
    const storyVid = videos.find((v) => v.adlabels.some((l) => l.name === "story_asset"));
    assert.equal(feedVid?.video_id, "vid_45");
    assert.equal(feedVid?.thumbnail_url, "https://cdn/thumb_45.jpg");
    assert.equal(storyVid?.video_id, "vid_916");
    assert.equal(storyVid?.thumbnail_url, "https://cdn/thumb_916.jpg");
  });
});

// ─── Multi-ratio image ────────────────────────────────────────────────────────

describe("buildMultiPlacementCreative — image (flag ON)", () => {
  it("emits asset_feed_spec.images with both hashes and distinct adlabels", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const payload = buildCreativePayload(dualImageCreative());

    const images = payload.asset_feed_spec?.images ?? [];
    assert.equal(images.length, 2);
    assert.deepEqual(images.map((i) => i.hash).sort(), ["hash_45", "hash_916"]);
    assert.deepEqual(payload.asset_feed_spec?.ad_formats, ["SINGLE_IMAGE"]);

    const storyRule = ruleForLabel(payload, "image_label", "story_asset");
    assert.deepEqual(storyRule?.customization_spec.instagram_positions, ["story", "reels"]);
    const feedRule = ruleForLabel(payload, "image_label", "feed_asset");
    assert.deepEqual(feedRule?.customization_spec, {});
  });

  it("carries caption/headline/link in the feed spec (no per-placement copy)", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const payload = buildCreativePayload(dualImageCreative());
    const afs = payload.asset_feed_spec!;
    assert.equal(afs.bodies?.[0].text, "Come see us live");
    assert.equal(afs.titles?.[0].text, "Buy tickets now");
    assert.equal(afs.descriptions?.[0].text, "Limited availability");
    assert.equal(afs.link_urls?.[0].website_url, "https://example.com/tickets");
    assert.deepEqual(afs.call_to_action_types, ["BOOK_NOW"]);
    assert.equal(afs.optimization_type, "PLACEMENT");
  });
});

// ─── No-regression: single aspect & mixed media & flag off ────────────────────

describe("single-asset / fallthrough cases produce NO asset_feed_spec", () => {
  it("single 9:16 video → legacy video_data path", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const creative = baseCreative({
      mediaType: "video",
      assetMode: "single",
      assetVariations: [
        {
          id: "var_1",
          name: "V1",
          assets: [
            {
              id: "a",
              aspectRatio: "9:16",
              uploadStatus: "uploaded",
              videoId: "vid_only",
              thumbnailUrl: "https://cdn/t.jpg",
            },
          ],
        },
      ],
    });
    const payload = buildCreativePayload(creative);
    assert.equal(payload.asset_feed_spec, undefined, "no asset_feed_spec for single asset");
    assert.equal(payload.object_story_spec?.video_data?.video_id, "vid_only");
  });

  it("mixed media (4:5 image + 9:16 video) falls through to single-asset path", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const creative = baseCreative({
      mediaType: "video",
      assetVariations: [
        {
          id: "var_1",
          name: "V1",
          assets: [
            { id: "a_45", aspectRatio: "4:5", uploadStatus: "uploaded", assetHash: "hash_45" },
            {
              id: "a_916",
              aspectRatio: "9:16",
              uploadStatus: "uploaded",
              videoId: "vid_916",
              thumbnailUrl: "https://cdn/t.jpg",
            },
          ],
        },
      ],
    });
    const payload = buildCreativePayload(creative);
    assert.equal(payload.asset_feed_spec, undefined, "mixed media → no asset_feed_spec");
    // hasVideoId true → video path picks 9:16
    assert.equal(payload.object_story_spec?.video_data?.video_id, "vid_916");
  });

  it("flag OFF → multi-ratio video still uses legacy single-asset path", () => {
    delete process.env.ENABLE_MULTI_PLACEMENT_ASSETS;
    const payload = buildCreativePayload(dualVideoCreative());
    assert.equal(payload.asset_feed_spec, undefined, "flag off → no asset_feed_spec");
    // VIDEO_PRIORITY picks 9:16 first
    assert.equal(payload.object_story_spec?.video_data?.video_id, "vid_916");
  });
});

// ─── Sanitizer discrimination ─────────────────────────────────────────────────

describe("sanitizeCreativeForStrictMode — asset_feed_spec discrimination", () => {
  it("preserves user-configured asset_feed_spec (has customization rules)", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const payload = buildCreativePayload(dualVideoCreative());
    const report = sanitizeCreativeForStrictMode(payload);
    assert.equal(report.assetFeedSpec, "preserved");
    assert.ok(payload.asset_feed_spec, "asset_feed_spec kept");
    assert.ok(
      (payload.asset_feed_spec?.asset_customization_rules?.length ?? 0) >= 2,
      "rules intact",
    );
    assert.ok(
      !report.strippedTopLevel.includes("asset_feed_spec"),
      "asset_feed_spec not reported as stripped",
    );
  });

  it("strips Advantage+ asset_feed_spec (no customization rules)", () => {
    // Simulate an Advantage+ / Dynamic-Creative auto spec: assets but no rules.
    const payload: MetaCreativePayload = {
      name: "Auto",
      object_story_spec: { page_id: "pg_123" },
      asset_feed_spec: {
        images: [{ hash: "h1", adlabels: [] }],
        ad_formats: ["AUTOMATIC_FORMAT", "SINGLE_IMAGE"],
        // NO asset_customization_rules
      },
    };
    const report = sanitizeCreativeForStrictMode(payload);
    assert.equal(report.assetFeedSpec, "stripped");
    assert.equal(payload.asset_feed_spec, undefined, "auto spec removed");
    assert.ok(report.strippedTopLevel.includes("asset_feed_spec"));
  });

  it("reports 'absent' when there is no asset_feed_spec (single-asset creative)", () => {
    const payload: MetaCreativePayload = {
      name: "Single",
      object_story_spec: {
        page_id: "pg_123",
        link_data: {
          message: "hi",
          link: "https://x.com",
          image_hash: "h",
          call_to_action: { type: "LEARN_MORE", value: { link: "https://x.com" } },
        },
      },
    };
    const report = sanitizeCreativeForStrictMode(payload);
    assert.equal(report.assetFeedSpec, "absent");
  });
});
