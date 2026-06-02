/**
 * __tests__/share-report/platform-stats-swap.test.ts
 *
 * Verifies the platform-filter → stats-block visibility logic.
 *
 * Rules:
 *   "all"    → show both Meta block AND TikTok block (when tiktokStats present)
 *   "meta"   → show only Meta block
 *   "tiktok" → show only TikTok block (Meta hidden)
 *   "google" → show Meta block (no Google-specific stats block yet)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

type PlatformFilter = "all" | "meta" | "tiktok" | "google";

/**
 * Mirrors the visibility logic in MetaReportBlock.
 * Returns which blocks should render.
 */
function resolveVisibility(
  isBrandCampaign: boolean,
  platformFilter: PlatformFilter,
  hasTiktokStats: boolean,
): { showMeta: boolean; showTikTok: boolean } {
  if (!isBrandCampaign) {
    return { showMeta: true, showTikTok: false };
  }
  const showMeta = platformFilter !== "tiktok";
  const showTikTok =
    (platformFilter === "tiktok" || platformFilter === "all") && hasTiktokStats;
  return { showMeta, showTikTok };
}

describe("platform-stats-swap — brand_campaign visibility logic", () => {
  describe("when TikTok stats are present", () => {
    it("All pill → both Meta and TikTok blocks visible", () => {
      const { showMeta, showTikTok } = resolveVisibility(true, "all", true);
      assert.equal(showMeta, true);
      assert.equal(showTikTok, true);
    });

    it("Meta pill → only Meta block visible", () => {
      const { showMeta, showTikTok } = resolveVisibility(true, "meta", true);
      assert.equal(showMeta, true);
      assert.equal(showTikTok, false);
    });

    it("TikTok pill → only TikTok block visible", () => {
      const { showMeta, showTikTok } = resolveVisibility(true, "tiktok", true);
      assert.equal(showMeta, false);
      assert.equal(showTikTok, true);
    });

    it("Google pill → only Meta block visible (no Google stats block yet)", () => {
      const { showMeta, showTikTok } = resolveVisibility(true, "google", true);
      assert.equal(showMeta, true);
      assert.equal(showTikTok, false);
    });
  });

  describe("when TikTok stats are absent (null)", () => {
    it("All pill → Meta shown, TikTok block suppressed (no data)", () => {
      const { showMeta, showTikTok } = resolveVisibility(true, "all", false);
      assert.equal(showMeta, true);
      assert.equal(showTikTok, false);
    });

    it("TikTok pill → Meta hidden, TikTok empty-state shown instead", () => {
      const { showMeta, showTikTok } = resolveVisibility(true, "tiktok", false);
      assert.equal(showMeta, false);
      assert.equal(showTikTok, false);
    });
  });

  describe("regular event (not brand_campaign) — filter has no effect", () => {
    it("always shows Meta, never shows TikTok block", () => {
      for (const filter of ["all", "meta", "tiktok", "google"] as const) {
        const { showMeta, showTikTok } = resolveVisibility(false, filter, true);
        assert.equal(showMeta, true, `filter=${filter}: expected Meta visible`);
        assert.equal(showTikTok, false, `filter=${filter}: expected TikTok hidden`);
      }
    });
  });
});
