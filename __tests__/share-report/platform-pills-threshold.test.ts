/**
 * Platform pills threshold tests.
 *
 * PR #500 gated platform pills behind `platformsWithSignal.length > 2`,
 * which requires ALL THREE of Meta + TikTok + Google to be populated.
 * That means a brand_campaign with only Meta spend (or only TikTok spend)
 * never showed pills.
 *
 * The fix lowers the threshold to `> 1` (i.e. at least one paid platform
 * has a signal). These tests verify the threshold logic in isolation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

type PlatformFilter = "all" | "meta" | "google" | "tiktok";

/**
 * Mirrors the logic in event-report-view.tsx:
 *   const platformsWithSignal: PlatformFilter[] = ["all"];
 *   if (metaSpend > 0) platformsWithSignal.push("meta");
 *   if (googleAdsSpend > 0) platformsWithSignal.push("google");
 *   if (tiktokSpend > 0) platformsWithSignal.push("tiktok");
 *   // pills show when platformsWithSignal.length > 1
 */
function computePillsShouldShow(
  metaSpend: number,
  tiktokSpend: number,
  googleAdsSpend: number,
): { pillsShown: boolean; platforms: PlatformFilter[] } {
  const platformsWithSignal: PlatformFilter[] = ["all"];
  if (metaSpend > 0) platformsWithSignal.push("meta");
  if (googleAdsSpend > 0) platformsWithSignal.push("google");
  if (tiktokSpend > 0) platformsWithSignal.push("tiktok");

  return {
    // FIXED threshold: > 1 (was > 2 in PR #500 which required 2 platforms)
    pillsShown: platformsWithSignal.length > 1,
    platforms: platformsWithSignal,
  };
}

describe("platform pills threshold (> 1)", () => {
  it("shows pills when only Meta has spend", () => {
    const { pillsShown, platforms } = computePillsShouldShow(5000, 0, 0);
    assert.equal(pillsShown, true);
    assert.deepEqual(platforms, ["all", "meta"]);
  });

  it("shows pills when only TikTok has spend (Ironworks case)", () => {
    const { pillsShown, platforms } = computePillsShouldShow(0, 933.25, 0);
    assert.equal(pillsShown, true);
    assert.deepEqual(platforms, ["all", "tiktok"]);
  });

  it("shows pills when only Google Ads has spend", () => {
    const { pillsShown, platforms } = computePillsShouldShow(0, 0, 250);
    assert.equal(pillsShown, true);
    assert.deepEqual(platforms, ["all", "google"]);
  });

  it("shows pills when Meta + TikTok both have spend", () => {
    const { pillsShown, platforms } = computePillsShouldShow(5000, 933.25, 0);
    assert.equal(pillsShown, true);
    assert.deepEqual(platforms, ["all", "meta", "tiktok"]);
  });

  it("shows pills when all three platforms have spend", () => {
    const { pillsShown, platforms } = computePillsShouldShow(5000, 933.25, 1200);
    assert.equal(pillsShown, true);
    assert.deepEqual(platforms, ["all", "meta", "google", "tiktok"]);
  });

  it("does NOT show pills when all platforms are zero (no data)", () => {
    const { pillsShown, platforms } = computePillsShouldShow(0, 0, 0);
    assert.equal(pillsShown, false);
    assert.deepEqual(platforms, ["all"]);
  });

  it("OLD threshold (> 2) would have hidden pills for single-platform", () => {
    // Regression: confirms the old > 2 threshold was wrong for Ironworks.
    const { platforms } = computePillsShouldShow(0, 933.25, 0);
    const oldThresholdWouldShow = platforms.length > 2; // was > 2
    const newThresholdShows = platforms.length > 1; // now > 1
    assert.equal(oldThresholdWouldShow, false, "old threshold incorrectly hid pills");
    assert.equal(newThresholdShows, true, "new threshold correctly shows pills");
  });
});
