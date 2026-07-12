/**
 * Tests for creativeHasBookNowMultiPlacementConflict — the bulk-attach
 * Configure Creatives hard-block for CTA=BOOK_NOW + Dual/Full mode with a
 * variation that has both a Feed (4:5/1:1) and a vertical (9:16) asset.
 *
 * Bug: buildCreativePayload silently falls back to a single 9:16 asset
 * cross-published to every placement in this scenario (Meta subcode
 * 1885396, PR #574/#575) — the 4:5 Feed asset is dropped without any
 * launch-time error. Live incident: WC26 Bournemouth, 2026-07-10, 10 ads
 * shipped 9:16 to Feed placements. This PR escalates the existing warning
 * to a hard block on the Configure Creatives step.
 *
 * Run: node --test (repo's test runner).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { creativeHasBookNowMultiPlacementConflict } from "../creative.ts";
import type { AdCreativeDraft, AssetVariation } from "../../types.ts";

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

function dualVariation(id: string, feedHash: string, verticalHash: string): AssetVariation {
  return {
    id,
    name: id,
    assets: [
      { id: `${id}_45`, aspectRatio: "4:5", uploadStatus: "uploaded", assetHash: feedHash },
      { id: `${id}_916`, aspectRatio: "9:16", uploadStatus: "uploaded", assetHash: verticalHash },
    ],
  };
}

describe("creativeHasBookNowMultiPlacementConflict", () => {
  it("true: BOOK_NOW + dual mode + variation with both Feed and vertical assets", () => {
    const creative = baseCreative({
      cta: "book_now",
      assetMode: "dual",
      assetVariations: [dualVariation("v1", "feed_hash", "vert_hash")],
    });
    assert.equal(creativeHasBookNowMultiPlacementConflict(creative), true);
  });

  it("true: BOOK_NOW + full mode, conflict on a non-zero variation index", () => {
    const creative = baseCreative({
      cta: "book_now",
      assetMode: "full",
      assetVariations: [
        { id: "v1", name: "v1", assets: [{ id: "v1_1", aspectRatio: "1:1", uploadStatus: "uploaded", assetHash: "h1" }] },
        dualVariation("v2", "feed_hash", "vert_hash"),
      ],
    });
    assert.equal(creativeHasBookNowMultiPlacementConflict(creative), true);
  });

  it("false: assetMode is single, even with BOOK_NOW", () => {
    const creative = baseCreative({
      cta: "book_now",
      assetMode: "single",
      assetVariations: [dualVariation("v1", "feed_hash", "vert_hash")],
    });
    assert.equal(creativeHasBookNowMultiPlacementConflict(creative), false);
  });

  it("false: dual mode but CTA is not BOOK_NOW", () => {
    const creative = baseCreative({
      cta: "learn_more",
      assetMode: "dual",
      assetVariations: [dualVariation("v1", "feed_hash", "vert_hash")],
    });
    assert.equal(creativeHasBookNowMultiPlacementConflict(creative), false);
  });

  it("false: BOOK_NOW + dual mode but only a vertical asset uploaded (no Feed asset yet)", () => {
    const creative = baseCreative({
      cta: "book_now",
      assetMode: "dual",
      assetVariations: [
        {
          id: "v1",
          name: "v1",
          assets: [{ id: "v1_916", aspectRatio: "9:16", uploadStatus: "uploaded", assetHash: "vert_hash" }],
        },
      ],
    });
    assert.equal(creativeHasBookNowMultiPlacementConflict(creative), false);
  });

  it("false: BOOK_NOW + dual mode, assets present but not yet uploaded (no hash/videoId)", () => {
    const creative = baseCreative({
      cta: "book_now",
      assetMode: "dual",
      assetVariations: [
        {
          id: "v1",
          name: "v1",
          assets: [
            { id: "v1_45", aspectRatio: "4:5", uploadStatus: "idle" },
            { id: "v1_916", aspectRatio: "9:16", uploadStatus: "idle" },
          ],
        },
      ],
    });
    assert.equal(creativeHasBookNowMultiPlacementConflict(creative), false);
  });

  it("true: BOOK_NOW + dual mode, video assets (videoId instead of assetHash)", () => {
    const creative = baseCreative({
      cta: "book_now",
      assetMode: "dual",
      mediaType: "video",
      assetVariations: [
        {
          id: "v1",
          name: "v1",
          assets: [
            { id: "v1_45", aspectRatio: "4:5", uploadStatus: "uploaded", videoId: "vid_feed" },
            { id: "v1_916", aspectRatio: "9:16", uploadStatus: "uploaded", videoId: "vid_vert" },
          ],
        },
      ],
    });
    assert.equal(creativeHasBookNowMultiPlacementConflict(creative), true);
  });
});
