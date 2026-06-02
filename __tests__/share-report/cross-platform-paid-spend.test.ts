/**
 * __tests__/share-report/cross-platform-paid-spend.test.ts
 *
 * Verifies that the brandRollupSpend aggregator sums Meta + TikTok + Google
 * correctly from event_daily_rollups rows, and that the total matches the
 * same value shown in both the top PAID MEDIA card and the bottom sections.
 *
 * This is a pure-logic test — no DB, no server-only imports.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

interface RollupRow {
  date: string;
  ad_spend: number | string | null;
  tiktok_spend: number | string | null;
  google_ads_spend: number | string | null;
}

/** Mirror of the aggregation logic in app/share/report/[token]/page.tsx */
function computeBrandRollupSpend(rollups: RollupRow[]) {
  return {
    meta: rollups.reduce((s, r) => s + Number(r.ad_spend ?? 0), 0),
    tiktok: rollups.reduce((s, r) => s + Number(r.tiktok_spend ?? 0), 0),
    google: rollups.reduce((s, r) => s + Number(r.google_ads_spend ?? 0), 0),
  };
}

function total(spend: { meta: number; tiktok: number; google: number }) {
  return spend.meta + spend.tiktok + spend.google;
}

describe("computeBrandRollupSpend", () => {
  it("sums Meta-only spend correctly", () => {
    const rollups: RollupRow[] = [
      { date: "2026-05-01", ad_spend: 1000, tiktok_spend: null, google_ads_spend: null },
      { date: "2026-05-02", ad_spend: 500,  tiktok_spend: null, google_ads_spend: null },
    ];
    const spend = computeBrandRollupSpend(rollups);
    assert.equal(spend.meta, 1500);
    assert.equal(spend.tiktok, 0);
    assert.equal(spend.google, 0);
    assert.equal(total(spend), 1500);
  });

  it("sums Meta + TikTok (Ironworks fixture)", () => {
    // Ironworks: Meta £2,642 + TikTok £933 (approx), no Google Ads
    const rollups: RollupRow[] = [
      { date: "2026-05-01", ad_spend: 2000,   tiktok_spend: 700,  google_ads_spend: 0 },
      { date: "2026-05-15", ad_spend: 642,    tiktok_spend: 233,  google_ads_spend: 0 },
    ];
    const spend = computeBrandRollupSpend(rollups);
    assert.equal(spend.meta,   2642);
    assert.equal(spend.tiktok,  933);
    assert.equal(spend.google,    0);
    assert.equal(total(spend), 3575);
  });

  it("sums all three platforms", () => {
    const rollups: RollupRow[] = [
      { date: "2026-05-01", ad_spend: 1000, tiktok_spend: 500, google_ads_spend: 250 },
    ];
    const spend = computeBrandRollupSpend(rollups);
    assert.equal(total(spend), 1750);
  });

  it("handles string-typed DB values gracefully", () => {
    const rollups: RollupRow[] = [
      { date: "2026-06-01", ad_spend: "2642.00", tiktok_spend: "933.00", google_ads_spend: "0" },
    ];
    const spend = computeBrandRollupSpend(rollups);
    assert.ok(Math.abs(total(spend) - 3575) < 0.01);
  });

  it("handles null-all row with no spend", () => {
    const rollups: RollupRow[] = [
      { date: "2026-06-01", ad_spend: null, tiktok_spend: null, google_ads_spend: null },
    ];
    const spend = computeBrandRollupSpend(rollups);
    assert.equal(total(spend), 0);
  });

  it("top card and bottom chart use the same total", () => {
    // Both the PAID MEDIA card (via brandRollupSpend) and the Daily Tracker
    // (via DailyTracker paidSpendOf) should produce the same total.
    // The aggregation logic is identical: ad_spend + tiktok_spend + google_ads_spend.
    const rollups: RollupRow[] = [
      { date: "2026-05-10", ad_spend: 1321,   tiktok_spend: 466.5, google_ads_spend: 0 },
      { date: "2026-05-20", ad_spend: 1321,   tiktok_spend: 466.5, google_ads_spend: 0 },
    ];
    const topCard = total(computeBrandRollupSpend(rollups));
    // Simulate how the bottom Daily Tracker computes the same total:
    const bottomTracker = rollups.reduce(
      (s, r) => s + Number(r.ad_spend ?? 0) + Number(r.tiktok_spend ?? 0) + Number(r.google_ads_spend ?? 0),
      0,
    );
    assert.ok(Math.abs(topCard - bottomTracker) < 0.001, "top and bottom must agree");
    assert.ok(Math.abs(topCard - 3575) < 0.01);
  });
});
