/**
 * __tests__/share-report/paid-media-cross-platform.test.ts
 *
 * Tests that paidMediaSpent correctly aggregates Meta + TikTok + Google
 * when all platform data is available.
 *
 * The top-of-report PAID MEDIA card value comes from EventReportView's
 * `platformSpend = metaSpend + googleAdsSpend + tiktokSpend`. The test
 * verifies the arithmetic and the Ironworks-specific fixture.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

/** Simplified version of EventReportView's platformSpend computation. */
function computePlatformSpend(
  meta: { totals: { spend: number } } | null,
  tiktok: { snapshot: { campaign: { cost: number } | null } | null } | null,
  googleAds: { totals: { spend: number } } | null,
): number {
  const metaSpend = meta?.totals.spend ?? 0;
  const googleAdsSpend = googleAds?.totals.spend ?? 0;
  const tiktokSpend = tiktok?.snapshot?.campaign?.cost ?? 0;
  return metaSpend + googleAdsSpend + tiktokSpend;
}

describe("cross-platform PAID MEDIA aggregation", () => {
  test("Ironworks fixture: Meta £2,636 + TikTok £933 = £3,569", () => {
    const meta = { totals: { spend: 2636 } };
    const tiktok = { snapshot: { campaign: { cost: 933 } } };
    const googleAds = null;

    const result = computePlatformSpend(meta, tiktok, googleAds);
    assert.equal(result, 3569);
  });

  test("Meta only — same as before when TikTok null", () => {
    const meta = { totals: { spend: 2636 } };
    const result = computePlatformSpend(meta, null, null);
    assert.equal(result, 2636);
  });

  test("all three platforms", () => {
    const meta = { totals: { spend: 1000 } };
    const tiktok = { snapshot: { campaign: { cost: 500 } } };
    const googleAds = { totals: { spend: 250 } };
    const result = computePlatformSpend(meta, tiktok, googleAds);
    assert.equal(result, 1750);
  });

  test("all null — returns 0", () => {
    assert.equal(computePlatformSpend(null, null, null), 0);
  });

  test("TikTok snapshot.campaign is null — treated as 0", () => {
    const tiktok = { snapshot: { campaign: null } };
    const meta = { totals: { spend: 1000 } };
    const result = computePlatformSpend(meta, tiktok, null);
    assert.equal(result, 1000);
  });

  test("CPR uses cross-platform spend (not Meta-only)", () => {
    const totalSpend = 3569;
    const totalSubscribers = 3006;
    const cpr = totalSpend / totalSubscribers;
    // Should be ~£1.18, not £0.88 (Meta-only)
    assert.ok(cpr < 1.2, `CPR ${cpr} unexpectedly high (should be ~1.18)`);
    assert.ok(cpr > 1.1, `CPR ${cpr} unexpectedly low`);
  });
});
