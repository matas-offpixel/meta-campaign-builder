/**
 * Tests for the BUY_TICKETS CTA option (lib/types.ts CTAType, lib/mock-data.ts
 * CTA_OPTIONS, lib/meta/creative.ts CTA_MAP).
 *
 * Why: BOOK_NOW is blocked inside asset_feed_spec by Meta (subcode=1885396),
 * forcing Dual/Full mode + Single-mode-rotation launches with BOOK_NOW to fall
 * back to a single 9:16 asset served in every placement (including Feed).
 * BUY_TICKETS is a valid Meta call_to_action_type that IS allowed inside
 * asset_feed_spec, so event campaigns can select it to keep per-placement
 * rendering / variation rotation while remaining semantically accurate
 * ("buy tickets" vs. "book now").
 *
 * Run: node --test.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { buildCreativePayload, mapCTAToMeta, CTA_MAP } from "../creative.ts";
import { CTA_OPTIONS } from "../../mock-data.ts";
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
    name: "Junction 2 Event Ad",
    sourceType: "new",
    mediaType: "image",
    assetMode: "single",
    identity: { pageId: "pg_123", instagramAccountId: "" },
    assetVariations: [{ id: "var_1", name: "Variation 1", assets: [] }],
    captions: [{ id: "cap_1", text: "Get your tickets now" }],
    headline: "Junction 2",
    description: "London",
    destinationUrl: "https://example.com/tickets",
    cta: "buy_tickets",
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

const ORIG_FLAG = process.env.ENABLE_MULTI_PLACEMENT_ASSETS;
afterEach(() => {
  if (ORIG_FLAG === undefined) delete process.env.ENABLE_MULTI_PLACEMENT_ASSETS;
  else process.env.ENABLE_MULTI_PLACEMENT_ASSETS = ORIG_FLAG;
});

// ─── CTA plumbing ──────────────────────────────────────────────────────────

describe("CTA plumbing — buy_tickets", () => {
  it("is a selectable option in CTA_OPTIONS", () => {
    const values = CTA_OPTIONS.map((o) => o.value);
    assert.ok(values.includes("buy_tickets"), "buy_tickets present in CTA_OPTIONS");
    const opt = CTA_OPTIONS.find((o) => o.value === "buy_tickets");
    assert.equal(opt?.label, "Buy Tickets");
  });

  it("maps to Meta's BUY_TICKETS call_to_action_type", () => {
    assert.equal(CTA_MAP.buy_tickets, "BUY_TICKETS");
    assert.equal(mapCTAToMeta("buy_tickets"), "BUY_TICKETS");
  });
});

// ─── Single mode + N variations + BUY_TICKETS → rotation path (NOT fallback) ──

describe("Single mode + N variations + BUY_TICKETS → variation-rotation path fires (no fallback)", () => {
  it("4 variations + BUY_TICKETS → asset_feed_spec.call_to_action_types: [BUY_TICKETS], all 4 hashes present", () => {
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

    assert.deepEqual(payload.asset_feed_spec?.call_to_action_types, ["BUY_TICKETS"]);
    const images = payload.asset_feed_spec?.images ?? [];
    assert.equal(images.length, 4, "no fallback — all 4 variations reach Meta");
    assert.equal(
      payload.asset_feed_spec?.asset_customization_rules,
      undefined,
      "rotation path has no customization_rules",
    );
  });
});

// ─── Dual mode + BUY_TICKETS → multi-placement path fires (NOT BOOK_NOW fallback) ─

describe("Dual mode + BUY_TICKETS → multi-placement path fires (NOT the BOOK_NOW single-asset fallback)", () => {
  it("4:5 + 9:16 assets + BUY_TICKETS → asset_feed_spec with per-placement rules, both assets present", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const creative = baseCreative({
      assetMode: "dual",
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

    assert.deepEqual(payload.asset_feed_spec?.call_to_action_types, ["BUY_TICKETS"]);
    const images = payload.asset_feed_spec?.images ?? [];
    assert.deepEqual(images.map((i) => i.hash).sort(), ["hash_45", "hash_916"], "both feed + story assets present");
    assert.ok(
      (payload.asset_feed_spec?.asset_customization_rules?.length ?? 0) >= 2,
      "per-placement rules present — multi-placement path, NOT the BOOK_NOW vertical fallback",
    );
  });
});

// ─── Regression: BOOK_NOW behaviour is completely unaffected ─────────────────

describe("Regression — existing BOOK_NOW + Dual fallback still fires exactly as before", () => {
  it("BOOK_NOW + dual assets → still falls back to single-asset 9:16 (PR #575 behaviour preserved)", () => {
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
    assert.equal(payload.asset_feed_spec, undefined, "BOOK_NOW still blocked from AFS — unchanged");
    assert.equal(payload.object_story_spec?.link_data?.image_hash, "hash_916");
    assert.equal(payload.object_story_spec?.link_data?.call_to_action?.type, "BOOK_NOW");
  });

  it("BUY_TICKETS does NOT accidentally trigger the BOOK_NOW single-asset fallback branch", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const creative = baseCreative({
      assetMode: "dual",
      cta: "buy_tickets",
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
    // If BUY_TICKETS were mis-routed into the BOOK_NOW fallback, asset_feed_spec
    // would be undefined here — assert it is NOT.
    assert.ok(payload.asset_feed_spec, "BUY_TICKETS uses AFS, not the BOOK_NOW fallback");
  });
});
