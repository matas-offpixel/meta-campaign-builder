/**
 * Tests for the BUY_TICKETS CTA option (lib/types.ts CTAType, lib/mock-data.ts
 * CTA_OPTIONS, lib/meta/creative.ts CTA_MAP).
 *
 * Buy tickets stays BUY_TICKETS in every payload, asset_feed_spec included —
 * it is never swapped for another CTA. In an asset_feed_spec Ads Manager shows
 * it as a Facebook event (ad 120251882396650755); the creative step warns.
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

// ─── Single mode + N variations + BUY_TICKETS → rotation path ────────────────

describe("Single mode + N variations + BUY_TICKETS → variation-rotation path fires (no fallback)", () => {
  it("4 variations + BUY_TICKETS → asset_feed_spec.call_to_action_types: [BUY_TICKETS], all 4 hashes present", async () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const creative = baseCreative({
      rotateVariations: true,
      assetVariations: [
        imageVariation("v1", "Variation 1", "hash_1"),
        imageVariation("v2", "Variation 2", "hash_2"),
        imageVariation("v3", "Variation 3", "hash_3"),
        imageVariation("v4", "Variation 4", "hash_4"),
      ],
    });
    const payload = await buildCreativePayload(creative);

    assert.deepEqual(payload.asset_feed_spec?.call_to_action_types, ["BUY_TICKETS"]);
    const images = payload.asset_feed_spec?.images ?? [];
    assert.equal(images.length, 4, "no fallback — all 4 variations reach Meta");
    // Dynamic Creative rotation has no asset_customization_rules (those are
    // placement pinning; see creative-variation-rotation.test.ts).
    assert.equal(
      payload.asset_feed_spec?.asset_customization_rules,
      undefined,
      "rotation is Dynamic Creative, not the PR #665 shared-label rules",
    );
  });
});

// ─── Dual mode + BUY_TICKETS → multi-placement path ──────────────────────────

describe("Dual mode + BUY_TICKETS → multi-placement path fires", () => {
  it("4:5 + 9:16 assets + BUY_TICKETS → asset_feed_spec with per-placement rules, both assets present", async () => {
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
    const payload = await buildCreativePayload(creative);

    assert.deepEqual(payload.asset_feed_spec?.call_to_action_types, ["BUY_TICKETS"]);
    const images = payload.asset_feed_spec?.images ?? [];
    assert.deepEqual(images.map((i) => i.hash).sort(), ["hash_45", "hash_916"], "both feed + story assets present");
    assert.ok(
      (payload.asset_feed_spec?.asset_customization_rules?.length ?? 0) >= 2,
      "per-placement rules present — multi-placement path",
    );
  });
});

// ─── Book now and Buy tickets stay distinct in asset_feed_spec ───────────────

describe("Dual mode — book_now and buy_tickets map to different AFS CTAs", () => {
  const dual = (cta: "book_now" | "buy_tickets") =>
    baseCreative({
      assetMode: "dual",
      cta,
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

  it("book_now → BOOK_TRAVEL", async () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const payload = await buildCreativePayload(dual("book_now"));
    assert.deepEqual(payload.asset_feed_spec?.call_to_action_types, ["BOOK_TRAVEL"]);
  });

  it("buy_tickets → BUY_TICKETS (not substituted)", async () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const payload = await buildCreativePayload(dual("buy_tickets"));
    assert.deepEqual(payload.asset_feed_spec?.call_to_action_types, ["BUY_TICKETS"]);
  });
});
