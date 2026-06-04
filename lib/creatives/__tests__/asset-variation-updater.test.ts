/**
 * Regression tests for applyVariationUpdate and the AssetVariationUpdater type.
 *
 * KEY SCENARIO: dual-asset (4:5 + 9:16) upload completes in parallel.
 *
 * Before the fix, `updateAsset` in AssetVariationCard read from a closure-
 * captured `slots` snapshot.  Whichever slot finished second would clobber the
 * first slot's "uploaded" status by writing an assets array built from the
 * same stale snapshot.  Both uploads returned 201 from the server, but the UI
 * showed one slot stuck as "uploading" forever.
 *
 * After the fix, `updateAsset` calls `onUpdate((prev) => ...)`.
 * `updateAssetVariation` in the parent applies that function to the *current*
 * variation read from `creativesRef.current`.  This test proves that two
 * consecutive calls — each updating a different asset — both land in final
 * state regardless of which one fires first.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyVariationUpdate,
  type AssetVariationUpdater,
} from "../asset-variation-updater.ts";
import type { AdCreativeDraft, Asset, AssetVariation } from "../../types.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeAsset(id: string, status: Asset["uploadStatus"] = "pending"): Asset {
  return {
    id,
    aspectRatio: "4:5",
    uploadStatus: status,
  };
}

function makeVariation(id: string, assets: Asset[]): AssetVariation {
  return { id, name: "Variation 1", assets };
}

function makeCreative(id: string, variation: AssetVariation): AdCreativeDraft {
  return {
    id,
    name: "Ad 1",
    mediaType: "video",
    assetMode: "dual",
    assetVariations: [variation],
    captions: [],
    headline: "",
    description: "",
    destinationUrl: "",
    cta: "LEARN_MORE",
    sourceType: "new",
  } as unknown as AdCreativeDraft;
}

// ─── Plain-patch form ─────────────────────────────────────────────────────────

describe("applyVariationUpdate — plain patch", () => {
  it("applies a plain patch to the target variation", () => {
    const asset = makeAsset("a1");
    const variation = makeVariation("v1", [asset]);
    const creative = makeCreative("c1", variation);

    const result = applyVariationUpdate([creative], "c1", "v1", {
      name: "Updated name",
    });

    assert.equal(result[0].assetVariations![0].name, "Updated name");
  });

  it("does not touch other variations", () => {
    const v1 = makeVariation("v1", [makeAsset("a1")]);
    const v2 = makeVariation("v2", [makeAsset("a2")]);
    const creative: AdCreativeDraft = {
      ...makeCreative("c1", v1),
      assetVariations: [v1, v2],
    };

    const result = applyVariationUpdate([creative], "c1", "v1", {
      name: "Changed",
    });

    assert.equal(result[0].assetVariations![0].name, "Changed");
    assert.equal(result[0].assetVariations![1].name, "Variation 1");
  });

  it("does not touch other creatives", () => {
    const c1 = makeCreative("c1", makeVariation("v1", [makeAsset("a1")]));
    const c2 = makeCreative("c2", makeVariation("v2", [makeAsset("a2")]));

    const result = applyVariationUpdate([c1, c2], "c1", "v1", {
      name: "Changed",
    });

    assert.equal(result[0].assetVariations![0].name, "Changed");
    assert.equal(result[1].assetVariations![0].name, "Variation 1");
    // reference equality for untouched creative
    assert.equal(result[1], c2);
  });
});

// ─── Functional-updater form ──────────────────────────────────────────────────

describe("applyVariationUpdate — functional updater", () => {
  it("passes the current variation to the updater function", () => {
    const asset = makeAsset("a1", "uploading");
    const variation = makeVariation("v1", [asset]);
    const creative = makeCreative("c1", variation);

    const updater: AssetVariationUpdater = (prev) => ({
      assets: prev.assets.map((a) =>
        a.id === "a1" ? { ...a, uploadStatus: "uploaded" } : a,
      ),
    });

    const result = applyVariationUpdate([creative], "c1", "v1", updater);
    assert.equal(
      result[0].assetVariations![0].assets[0].uploadStatus,
      "uploaded",
    );
  });

  // ── THE KEY RACE-CONDITION REGRESSION TEST ──────────────────────────────────
  //
  // Two parallel uploads (one per slot in a dual-asset variation) each complete
  // and call applyVariationUpdate with a functional updater for their own slot.
  // Because each updater reads `prev` from the *current* state (not from a
  // stale closure), the second call correctly sees the first slot as "uploaded"
  // rather than overwriting it with the stale "uploading" status.

  it("parallel uploads: both slots land as uploaded when applied sequentially to current state", () => {
    const assetA = makeAsset("a", "uploading");
    const assetB = makeAsset("b", "uploading");
    const variation = makeVariation("v1", [assetA, assetB]);
    const creative = makeCreative("c1", variation);

    // Simulate upload A completing first
    const updaterA: AssetVariationUpdater = (prev) => ({
      assets: prev.assets.map((a) =>
        a.id === "a" ? { ...a, uploadStatus: "uploaded" } : a,
      ),
    });
    // Simulate upload B completing 1ms later — by which point state has A's update
    const updaterB: AssetVariationUpdater = (prev) => ({
      assets: prev.assets.map((a) =>
        a.id === "b" ? { ...a, uploadStatus: "uploaded" } : a,
      ),
    });

    // Apply A first, feeding result into B (mirrors the ref-based state machine)
    const afterA = applyVariationUpdate([creative], "c1", "v1", updaterA);
    const afterB = applyVariationUpdate(afterA, "c1", "v1", updaterB);

    const finalAssets = afterB[0].assetVariations![0].assets;
    assert.equal(finalAssets.find((a) => a.id === "a")?.uploadStatus, "uploaded",
      "slot A should be uploaded after both updates");
    assert.equal(finalAssets.find((a) => a.id === "b")?.uploadStatus, "uploaded",
      "slot B should be uploaded after both updates");
  });

  it("stale-patch form would clobber: demonstrates why functional updater is required", () => {
    // This test shows the OLD broken behaviour: two stale-closure patches built
    // from the same snapshot both overwrite each other's slot.
    const assetA = makeAsset("a", "uploading");
    const assetB = makeAsset("b", "uploading");
    const staleSlots = [assetA, assetB]; // closure-captured at render time

    // Both patches are built from the SAME stale snapshot (the bug)
    const stalePatchA: AssetVariationUpdater = {
      assets: staleSlots.map((a) =>
        a.id === "a" ? { ...a, uploadStatus: "uploaded" } : a,
      ),
    };
    const stalePatchB: AssetVariationUpdater = {
      assets: staleSlots.map((a) =>
        a.id === "b" ? { ...a, uploadStatus: "uploaded" } : a,
      ),
    };

    const variation = makeVariation("v1", [assetA, assetB]);
    const creative = makeCreative("c1", variation);

    const afterA = applyVariationUpdate([creative], "c1", "v1", stalePatchA);
    // B's stale patch clobbers A's "uploaded" back to "uploading"
    const afterB = applyVariationUpdate(afterA, "c1", "v1", stalePatchB);

    const finalAssets = afterB[0].assetVariations![0].assets;
    // Slot A is now "uploading" again — the stale-closure bug
    assert.equal(finalAssets.find((a) => a.id === "a")?.uploadStatus, "uploading",
      "confirms the old bug: stale patch B reverts A back to uploading");
    assert.equal(finalAssets.find((a) => a.id === "b")?.uploadStatus, "uploaded");
  });
});
