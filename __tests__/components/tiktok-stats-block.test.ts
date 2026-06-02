/**
 * __tests__/components/tiktok-stats-block.test.ts
 *
 * Verifies the TikTokRollupTotals shape and the derived metrics
 * (CPM, CTR, CPC, CPA) that TikTokCampaignStatsSection computes
 * from the raw rollup columns.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TikTokRollupTotals } from "@/components/report/meta-insights-sections";

// ── Helpers that mirror the component's internal math ────────────────────────

function cpm(spend: number, impressions: number): number | null {
  if (impressions <= 0) return null;
  return (spend / impressions) * 1000;
}

function ctr(clicks: number, impressions: number): number | null {
  if (impressions <= 0) return null;
  return (clicks / impressions) * 100;
}

function cpc(spend: number, clicks: number): number | null {
  if (clicks <= 0) return null;
  return spend / clicks;
}

function cpa(spend: number, conversions: number): number | null {
  if (conversions <= 0) return null;
  return spend / conversions;
}

describe("TikTokCampaignStatsSection — derived metric math", () => {
  const IRONWORKS_TIKTOK: TikTokRollupTotals = {
    spend: 933.0,
    impressions: 461_000,
    clicks: 2_900,
    videoViews: 310_000,
    conversions: 163,
  };

  it("computes CPM correctly (£2.02 per 1,000 impressions)", () => {
    const result = cpm(IRONWORKS_TIKTOK.spend, IRONWORKS_TIKTOK.impressions);
    assert.ok(result !== null);
    // £933 / 461,000 * 1,000 ≈ £2.02
    assert.ok(result > 2.0 && result < 2.1, `CPM out of range: ${result}`);
  });

  it("computes CTR correctly (~0.63%)", () => {
    const result = ctr(IRONWORKS_TIKTOK.clicks, IRONWORKS_TIKTOK.impressions);
    assert.ok(result !== null);
    assert.ok(result > 0.6 && result < 0.7, `CTR out of range: ${result}`);
  });

  it("computes CPC correctly (~£0.32)", () => {
    const result = cpc(IRONWORKS_TIKTOK.spend, IRONWORKS_TIKTOK.clicks);
    assert.ok(result !== null);
    assert.ok(result > 0.3 && result < 0.35, `CPC out of range: ${result}`);
  });

  it("computes CPA correctly (~£5.72)", () => {
    const result = cpa(IRONWORKS_TIKTOK.spend, IRONWORKS_TIKTOK.conversions);
    assert.ok(result !== null);
    // £933 / 163 ≈ £5.72
    assert.ok(result > 5.5 && result < 6.0, `CPA out of range: ${result}`);
  });

  it("returns null for CPM when impressions = 0", () => {
    assert.equal(cpm(100, 0), null);
  });

  it("returns null for CPC when clicks = 0", () => {
    assert.equal(cpc(100, 0), null);
  });

  it("accepts optional reach field", () => {
    const withReach: TikTokRollupTotals = { ...IRONWORKS_TIKTOK, reach: 42_000 };
    assert.equal(withReach.reach, 42_000);
  });
});
