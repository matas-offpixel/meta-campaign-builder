/**
 * Tests for variation-rotation asset_feed_spec (Single mode + N variations).
 *
 * Bug (PR #663): buildCreativePayload read assetVariations[0] exclusively
 * across every payload builder — when an operator uploaded N variations
 * expecting Meta to rotate them, only variation 0 reached Meta (variations
 * 2..N silently discarded at payload build time). Matas's design intent:
 * variations = asset rotation within a single ad via asset_feed_spec
 * (Dynamic Creative rotation), NOT separate ads.
 *
 * Bug #2 (follow-up fix, this file): PR #663's first cut shipped the
 * rotation asset_feed_spec with 0 asset_customization_rules, assuming "no
 * rules = free rotation." Meta rejects that outright ("The ad asset feed has
 * 0 target rule(s) for format: INSTAGRAM_FEED_WEB, but exactly 1 target rule
 * for this format is expected"). The fix mirrors buildMultiPlacementCreative's
 * 2-rule shape (Stories/Reels + empty-spec catch-all) but points every rule
 * at the SAME shared "rotation" adlabel across all N assets, so Meta can pick
 * any of them for a given placement — true rotation, not per-asset pinning.
 *
 * Scope (this PR): Single mode (all variations 9:16, one asset each) only.
 * Dual/Full mode + N variations is a follow-up PR — those cases fall back to
 * variation[0] via the existing multi-placement path (verified below).
 *
 * Run: node --test (the repo's test runner). Gated behind
 * ENABLE_MULTI_PLACEMENT_ASSETS — tests set/unset it per-case.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  buildCreativePayload,
  sanitizeCreativeForStrictMode,
  type MetaCreativePayload,
} from "../creative.ts";
import type { AdCreativeDraft, AssetVariation } from "../../types.ts";

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
    name: "J2 Melodic Retarget",
    sourceType: "new",
    mediaType: "image",
    assetMode: "single",
    identity: { pageId: "pg_123", instagramAccountId: "" },
    assetVariations: [{ id: "var_1", name: "Variation 1", assets: [] }],
    captions: [{ id: "cap_1", text: "Come see us live" }],
    headline: "Buy tickets now",
    description: "Limited availability",
    destinationUrl: "https://example.com/tickets",
    cta: "learn_more",
    enhancements: baseEnhancements,
    ...overrides,
  };
}

function imageVariation(id: string, name: string, hash: string): AssetVariation {
  return {
    id,
    name,
    assets: [{ id: `${id}_a`, aspectRatio: "9:16", uploadStatus: "uploaded", assetHash: hash }],
  };
}

function videoVariation(id: string, name: string, videoId: string, thumbnailUrl?: string): AssetVariation {
  return {
    id,
    name,
    assets: [
      {
        id: `${id}_a`,
        aspectRatio: "9:16",
        uploadStatus: "uploaded",
        videoId,
        thumbnailUrl,
      },
    ],
  };
}

// ─── Feature-flag harness ─────────────────────────────────────────────────────

const ORIG_FLAG = process.env.ENABLE_MULTI_PLACEMENT_ASSETS;
afterEach(() => {
  if (ORIG_FLAG === undefined) delete process.env.ENABLE_MULTI_PLACEMENT_ASSETS;
  else process.env.ENABLE_MULTI_PLACEMENT_ASSETS = ORIG_FLAG;
});

// ─── Single mode + N variations (images) ──────────────────────────────────────

describe("buildVariationRotationCreative — image (Single mode, flag ON)", () => {
  it("4 variations → asset_feed_spec.images with all 4 hashes, each sharing the rotation label, + 2 customization_rules", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const creative = baseCreative({
      assetVariations: [
        imageVariation("v1", "Variation 1", "hash_1"),
        imageVariation("v2", "Variation 2", "hash_2"),
        imageVariation("v3", "Variation 3", "hash_3"),
        imageVariation("v4", "Variation 4", "hash_4"),
      ],
    });
    const payload = buildCreativePayload(creative);

    const images = payload.asset_feed_spec?.images ?? [];
    assert.equal(images.length, 4, "all 4 variation hashes present");
    assert.deepEqual(
      images.map((i) => i.hash),
      ["hash_1", "hash_2", "hash_3", "hash_4"],
    );
    // Every image shares the SAME adlabel — Meta is free to rotate any of
    // the N images into any placement (true rotation, not per-asset pinning).
    for (const img of images) {
      assert.deepEqual(img.adlabels, [{ name: "rotation" }]);
    }
    assert.deepEqual(payload.asset_feed_spec?.ad_formats, ["SINGLE_IMAGE"]);
    assert.equal(payload.asset_feed_spec?.optimization_type, "PLACEMENT");

    // Meta requires >=1 customization_rule per placement format, even for
    // pure rotation (0-rule payloads are rejected — see PR follow-up fix).
    const rules = payload.asset_feed_spec?.asset_customization_rules ?? [];
    assert.equal(rules.length, 2, "exactly 2 rules — Stories/Reels + catch-all default");
    for (const rule of rules) {
      assert.equal(rule.image_label?.name, "rotation", "every rule points at the shared label");
    }
    assert.deepEqual(rules[0].customization_spec, {
      publisher_platforms: ["facebook", "instagram"],
      facebook_positions: ["story", "facebook_reels"],
      instagram_positions: ["story", "reels"],
    });
    assert.deepEqual(rules[1].customization_spec, {}, "second rule is the empty-spec catch-all default");

    // object_story_spec carries page_id ONLY — assets live in asset_feed_spec
    assert.equal(payload.object_story_spec?.page_id, "pg_123");
    assert.equal(payload.object_story_spec?.link_data, undefined);
  });

  it("carries caption/headline/link/CTA in the feed spec", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const creative = baseCreative({
      cta: "sign_up",
      assetVariations: [
        imageVariation("v1", "Variation 1", "hash_1"),
        imageVariation("v2", "Variation 2", "hash_2"),
      ],
    });
    const payload = buildCreativePayload(creative);
    const afs = payload.asset_feed_spec!;
    assert.equal(afs.bodies?.[0].text, "Come see us live");
    assert.equal(afs.titles?.[0].text, "Buy tickets now");
    assert.equal(afs.descriptions?.[0].text, "Limited availability");
    assert.equal(afs.link_urls?.[0].website_url, "https://example.com/tickets");
    assert.deepEqual(afs.call_to_action_types, ["SIGN_UP"]);
  });
});

// ─── Single mode + N variations (videos) ──────────────────────────────────────

describe("buildVariationRotationCreative — video (Single mode, flag ON)", () => {
  it("3 variations → asset_feed_spec.videos with all 3 videoIds + thumbnails, shared rotation label, + 2 customization_rules", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const creative = baseCreative({
      mediaType: "video",
      assetVariations: [
        videoVariation("v1", "Variation 1", "vid_1", "https://cdn/t1.jpg"),
        videoVariation("v2", "Variation 2", "vid_2", "https://cdn/t2.jpg"),
        videoVariation("v3", "Variation 3", "vid_3"),
      ],
    });
    const payload = buildCreativePayload(creative);

    const videos = payload.asset_feed_spec?.videos ?? [];
    assert.equal(videos.length, 3);
    assert.deepEqual(
      videos.map((v) => v.video_id),
      ["vid_1", "vid_2", "vid_3"],
    );
    assert.equal(videos[0].thumbnail_url, "https://cdn/t1.jpg");
    assert.equal(videos[1].thumbnail_url, "https://cdn/t2.jpg");
    assert.equal(videos[2].thumbnail_url, undefined, "no thumbnail → omitted, not required");
    for (const vid of videos) {
      assert.deepEqual(vid.adlabels, [{ name: "rotation" }]);
    }
    assert.deepEqual(payload.asset_feed_spec?.ad_formats, ["SINGLE_VIDEO"]);

    const rules = payload.asset_feed_spec?.asset_customization_rules ?? [];
    assert.equal(rules.length, 2, "exactly 2 rules — required by Meta even for pure rotation");
    for (const rule of rules) {
      assert.equal(rule.video_label?.name, "rotation");
    }
  });
});

// ─── CTA = BOOK_NOW + N variations → single-asset fallback ────────────────────

describe("Single mode + N variations + BOOK_NOW → single-asset fallback (constraint 1885396)", () => {
  it("falls back to variation[0] via link_data, no asset_feed_spec", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const creative = baseCreative({
      cta: "book_now",
      assetVariations: [
        imageVariation("v1", "Variation 1", "hash_1"),
        imageVariation("v2", "Variation 2", "hash_2"),
        imageVariation("v3", "Variation 3", "hash_3"),
        imageVariation("v4", "Variation 4", "hash_4"),
      ],
    });
    const payload = buildCreativePayload(creative);

    assert.equal(payload.asset_feed_spec, undefined, "no asset_feed_spec — AFS path skipped for BOOK_NOW");
    assert.equal(payload.object_story_spec?.link_data?.image_hash, "hash_1", "uses variation[0] only");
    assert.equal(payload.object_story_spec?.link_data?.call_to_action?.type, "BOOK_NOW", "CTA preserved");
  });

  it("video variant: falls back to variation[0] via video_data, no asset_feed_spec", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const creative = baseCreative({
      mediaType: "video",
      cta: "book_now",
      assetVariations: [
        videoVariation("v1", "Variation 1", "vid_1", "https://cdn/t1.jpg"),
        videoVariation("v2", "Variation 2", "vid_2", "https://cdn/t2.jpg"),
      ],
    });
    const payload = buildCreativePayload(creative);

    assert.equal(payload.asset_feed_spec, undefined);
    assert.equal(payload.object_story_spec?.video_data?.video_id, "vid_1");
    assert.equal(payload.object_story_spec?.video_data?.call_to_action?.type, "BOOK_NOW");
  });
});

// ─── Regression: 1 variation → identical to today ─────────────────────────────

describe("Single mode + 1 variation → unchanged (no asset_feed_spec)", () => {
  it("single variation never triggers rotation, even with flag ON", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const creative = baseCreative({
      assetVariations: [imageVariation("v1", "Variation 1", "hash_1")],
    });
    const payload = buildCreativePayload(creative);
    assert.equal(payload.asset_feed_spec, undefined);
    assert.equal(payload.object_story_spec?.link_data?.image_hash, "hash_1");
  });
});

// ─── Regression: Dual/Full mode is OUT OF SCOPE — falls back to variation[0] ──

describe("Dual mode + N variations — out of scope, falls back to variation[0]", () => {
  it("2 variations, dual mode → existing multi-placement path using variation[0] only", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const dualVar1: AssetVariation = {
      id: "v1",
      name: "Variation 1",
      assets: [
        { id: "a1_45", aspectRatio: "4:5", uploadStatus: "uploaded", assetHash: "v1_hash_45" },
        { id: "a1_916", aspectRatio: "9:16", uploadStatus: "uploaded", assetHash: "v1_hash_916" },
      ],
    };
    const dualVar2: AssetVariation = {
      id: "v2",
      name: "Variation 2",
      assets: [
        { id: "a2_45", aspectRatio: "4:5", uploadStatus: "uploaded", assetHash: "v2_hash_45" },
        { id: "a2_916", aspectRatio: "9:16", uploadStatus: "uploaded", assetHash: "v2_hash_916" },
      ],
    };
    const creative = baseCreative({
      assetMode: "dual",
      assetVariations: [dualVar1, dualVar2],
    });
    const payload = buildCreativePayload(creative);

    // Existing multi-placement path fires (uses variation[0] assets only).
    const images = payload.asset_feed_spec?.images ?? [];
    assert.deepEqual(
      images.map((i) => i.hash).sort(),
      ["v1_hash_45", "v1_hash_916"],
      "only variation[0]'s assets are used — variation 2 discarded",
    );
    assert.ok(
      (payload.asset_feed_spec?.asset_customization_rules?.length ?? 0) >= 2,
      "per-placement rules still present — regression check for existing dual-mode behaviour",
    );
  });

  it("BOOK_NOW + dual mode + 1 variation → existing vertical fallback unchanged", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const creative = baseCreative({
      assetMode: "dual",
      cta: "book_now",
      assetVariations: [
        {
          id: "v1",
          name: "Variation 1",
          assets: [
            { id: "a_45", aspectRatio: "4:5", uploadStatus: "uploaded", assetHash: "hash_45" },
            { id: "a_916", aspectRatio: "9:16", uploadStatus: "uploaded", assetHash: "hash_916" },
          ],
        },
      ],
    });
    const payload = buildCreativePayload(creative);
    assert.equal(payload.asset_feed_spec, undefined, "no asset_feed_spec — BOOK_NOW vertical fallback");
    assert.equal(payload.object_story_spec?.link_data?.image_hash, "hash_916", "uses 9:16 hash, NOT 4:5");
    assert.equal(payload.object_story_spec?.link_data?.call_to_action?.type, "BOOK_NOW");
  });
});

// ─── Mixed media across variations → falls through (no rotation) ─────────────

describe("Mixed media across variations → detectVariationRotation returns null", () => {
  it("video variation[0] + image variation[1] → falls back to legacy single-asset (variation[0]) path", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    // variation[0] is video so the legacy hasVideoId/pickPrimaryVideoAsset path
    // (which only ever reads variation[0]) still resolves cleanly — isolating
    // the assertion to detectVariationRotation's mixed-media guard rather than
    // an unrelated variation[0]-only limitation in the legacy pickers.
    const creative = baseCreative({
      mediaType: "video",
      assetVariations: [
        videoVariation("v1", "Variation 1", "vid_1", "https://cdn/t1.jpg"),
        imageVariation("v2", "Variation 2", "hash_2"),
      ],
    });
    const payload = buildCreativePayload(creative);
    assert.equal(payload.asset_feed_spec, undefined, "mixed media across variations → no rotation");
    assert.equal(payload.object_story_spec?.video_data?.video_id, "vid_1", "legacy path uses variation[0]");
  });
});

// ─── Feature flag OFF → legacy path regardless of variation count ─────────────

describe("Flag OFF → variation rotation never fires", () => {
  it("4 variations, flag off → legacy single-asset path (variation[0] only)", () => {
    delete process.env.ENABLE_MULTI_PLACEMENT_ASSETS;
    const creative = baseCreative({
      assetVariations: [
        imageVariation("v1", "Variation 1", "hash_1"),
        imageVariation("v2", "Variation 2", "hash_2"),
        imageVariation("v3", "Variation 3", "hash_3"),
        imageVariation("v4", "Variation 4", "hash_4"),
      ],
    });
    const payload = buildCreativePayload(creative);
    assert.equal(payload.asset_feed_spec, undefined);
    assert.equal(payload.object_story_spec?.link_data?.image_hash, "hash_1");
  });
});

// ─── Sanitizer discrimination — variation rotation is PRESERVED, not stripped ─

describe("sanitizeCreativeForStrictMode — variation-rotation asset_feed_spec is preserved", () => {
  it("preserves the built variation-rotation payload (has customization_rules, 4 images)", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const creative = baseCreative({
      assetVariations: [
        imageVariation("v1", "Variation 1", "hash_1"),
        imageVariation("v2", "Variation 2", "hash_2"),
        imageVariation("v3", "Variation 3", "hash_3"),
        imageVariation("v4", "Variation 4", "hash_4"),
      ],
    });
    const payload = buildCreativePayload(creative);
    const report = sanitizeCreativeForStrictMode(payload);
    assert.equal(report.assetFeedSpec, "preserved");
    assert.equal(payload.asset_feed_spec?.images?.length, 4, "all 4 images kept");
    assert.equal(payload.asset_feed_spec?.asset_customization_rules?.length, 2, "rules kept intact");
    assert.ok(!report.strippedTopLevel.includes("asset_feed_spec"));
  });

  it("still strips a true Advantage+ auto spec (1 image, no rules)", () => {
    // Simulate an Advantage+ / Dynamic-Creative auto spec: single asset, no rules.
    const payload: MetaCreativePayload = {
      name: "Auto",
      object_story_spec: { page_id: "pg_123" },
      asset_feed_spec: {
        images: [{ hash: "h1" }],
        ad_formats: ["AUTOMATIC_FORMAT", "SINGLE_IMAGE"],
      },
    };
    const report = sanitizeCreativeForStrictMode(payload);
    assert.equal(report.assetFeedSpec, "stripped");
    assert.equal(payload.asset_feed_spec, undefined);
  });
});
