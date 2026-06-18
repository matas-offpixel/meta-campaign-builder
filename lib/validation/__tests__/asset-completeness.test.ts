import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  validateCreativeAssetCompleteness,
  validateAllCreativesAssetCompleteness,
} from "../asset-completeness.ts";
import type { AdCreativeDraft, Asset, AssetVariation } from "../../types.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAsset(
  aspectRatio: "4:5" | "9:16" | "1:1",
  opts: { assetHash?: string; videoId?: string } = { assetHash: "abc123" },
): Asset {
  return {
    id: crypto.randomUUID(),
    aspectRatio,
    uploadStatus: "uploaded",
    ...opts,
  };
}

function makePendingAsset(aspectRatio: "4:5" | "9:16" | "1:1"): Asset {
  return {
    id: crypto.randomUUID(),
    aspectRatio,
    uploadStatus: "pending",
  };
}

function makeVariation(assets: Asset[], name = "Variation 1"): AssetVariation {
  return { id: crypto.randomUUID(), name, assets };
}

function makeCreative(
  opts: Partial<AdCreativeDraft> & { variations?: AssetVariation[] },
): AdCreativeDraft {
  const { variations = [], ...rest } = opts;
  return {
    id: crypto.randomUUID(),
    name: "Test creative",
    assetMode: "dual",
    mediaType: "image",
    assetVariations: variations,
    sourceType: "new",
    captions: [],
    headline: "",
    description: "",
    destinationUrl: "https://example.com",
    cta: "LEARN_MORE",
    identity: { pageId: "123", instagramAccountId: "456" },
    ...rest,
  } as AdCreativeDraft;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("validateCreativeAssetCompleteness", () => {
  describe("single mode", () => {
    it("returns no issues regardless of asset state", () => {
      const creative = makeCreative({
        assetMode: "single",
        variations: [
          makeVariation([makePendingAsset("9:16")]),
        ],
      });
      const issues = validateCreativeAssetCompleteness(creative);
      assert.equal(issues.length, 0, "single mode must never produce issues");
    });

    it("returns no issues even with empty variations", () => {
      const creative = makeCreative({ assetMode: "single", variations: [] });
      assert.equal(validateCreativeAssetCompleteness(creative).length, 0);
    });
  });

  describe("dual mode", () => {
    it("returns no issues when both 4:5 and 9:16 have meta IDs", () => {
      const creative = makeCreative({
        assetMode: "dual",
        variations: [
          makeVariation([
            makeAsset("4:5", { assetHash: "hash1" }),
            makeAsset("9:16", { assetHash: "hash2" }),
          ]),
        ],
      });
      assert.equal(validateCreativeAssetCompleteness(creative).length, 0);
    });

    it("reports missing 4:5 when only 9:16 is uploaded", () => {
      const creative = makeCreative({
        assetMode: "dual",
        variations: [
          makeVariation([
            makePendingAsset("4:5"),
            makeAsset("9:16", { assetHash: "hash2" }),
          ]),
        ],
      });
      const issues = validateCreativeAssetCompleteness(creative);
      assert.equal(issues.length, 1);
      assert.deepEqual(issues[0].missingRatios, ["4:5"]);
      assert.equal(issues[0].assetMode, "dual");
    });

    it("reports missing 9:16 when only 4:5 is uploaded", () => {
      const creative = makeCreative({
        assetMode: "dual",
        variations: [
          makeVariation([
            makeAsset("4:5", { assetHash: "hash1" }),
            makePendingAsset("9:16"),
          ]),
        ],
      });
      const issues = validateCreativeAssetCompleteness(creative);
      assert.equal(issues.length, 1);
      assert.deepEqual(issues[0].missingRatios, ["9:16"]);
    });

    it("reports both ratios missing when variation has no uploaded assets", () => {
      const creative = makeCreative({
        assetMode: "dual",
        variations: [
          makeVariation([
            makePendingAsset("4:5"),
            makePendingAsset("9:16"),
          ]),
        ],
      });
      const issues = validateCreativeAssetCompleteness(creative);
      assert.equal(issues.length, 1);
      assert.equal(issues[0].missingRatios.length, 2);
    });

    it("accepts video assets identified by videoId (not assetHash)", () => {
      const creative = makeCreative({
        assetMode: "dual",
        mediaType: "video",
        variations: [
          makeVariation([
            makeAsset("4:5", { videoId: "vid1" }),
            makeAsset("9:16", { videoId: "vid2" }),
          ]),
        ],
      });
      assert.equal(validateCreativeAssetCompleteness(creative).length, 0);
    });

    it("produces one issue per variation with missing ratios", () => {
      const creative = makeCreative({
        assetMode: "dual",
        variations: [
          makeVariation([makeAsset("4:5"), makeAsset("9:16")], "Variation 1"),
          makeVariation([makePendingAsset("4:5"), makeAsset("9:16")], "Variation 2"),
          makeVariation([makeAsset("4:5"), makePendingAsset("9:16")], "Variation 3"),
        ],
      });
      const issues = validateCreativeAssetCompleteness(creative);
      assert.equal(issues.length, 2, "only the two incomplete variations should produce issues");
      assert.equal(issues[0].variationName, "Variation 2");
      assert.equal(issues[1].variationName, "Variation 3");
    });
  });

  describe("full mode", () => {
    it("returns no issues when 4:5 + 9:16 + 1:1 all have meta IDs", () => {
      const creative = makeCreative({
        assetMode: "full",
        variations: [
          makeVariation([
            makeAsset("4:5", { assetHash: "h1" }),
            makeAsset("9:16", { assetHash: "h2" }),
            makeAsset("1:1", { assetHash: "h3" }),
          ]),
        ],
      });
      assert.equal(validateCreativeAssetCompleteness(creative).length, 0);
    });

    it("reports the one missing ratio in full mode", () => {
      const creative = makeCreative({
        assetMode: "full",
        variations: [
          makeVariation([
            makeAsset("4:5", { assetHash: "h1" }),
            makeAsset("9:16", { assetHash: "h2" }),
            makePendingAsset("1:1"),
          ]),
        ],
      });
      const issues = validateCreativeAssetCompleteness(creative);
      assert.equal(issues.length, 1);
      assert.deepEqual(issues[0].missingRatios, ["1:1"]);
    });
  });
});

describe("validateAllCreativesAssetCompleteness", () => {
  it("returns empty when all creatives are complete", () => {
    const creatives = [
      makeCreative({
        assetMode: "dual",
        variations: [makeVariation([makeAsset("4:5"), makeAsset("9:16")])],
      }),
      makeCreative({
        assetMode: "single",
        variations: [makeVariation([makePendingAsset("9:16")])],
      }),
    ];
    assert.equal(validateAllCreativesAssetCompleteness(creatives).length, 0);
  });

  it("aggregates issues across multiple creatives", () => {
    const creatives = [
      makeCreative({
        name: "Ad A",
        assetMode: "dual",
        variations: [makeVariation([makePendingAsset("4:5"), makeAsset("9:16")])],
      }),
      makeCreative({
        name: "Ad B",
        assetMode: "full",
        variations: [
          makeVariation([makeAsset("4:5"), makeAsset("9:16"), makePendingAsset("1:1")]),
        ],
      }),
    ];
    const issues = validateAllCreativesAssetCompleteness(creatives);
    assert.equal(issues.length, 2);
    assert.equal(issues[0].creativeName, "Ad A");
    assert.equal(issues[1].creativeName, "Ad B");
  });
});
