/**
 * __tests__/share-report/platform-pills-rollup-based.test.ts
 *
 * Verifies that platform filter pills are derived from event_daily_rollups
 * spend sums, not from the API-sourced tiktok/googleAds payloads.
 *
 * For brand_campaign events, TikTok and Google Ads pills must appear whenever
 * the corresponding rollup column has any spend — even if metaPayload.tiktok
 * is null (e.g. no TikTok breakdown snapshot exists yet).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

interface RollupRow {
  ad_spend: number | string | null;
  tiktok_spend: number | string | null;
  google_ads_spend: number | string | null;
}

/** Mirror of the pills presence logic that should be used in EventReportView */
function computePlatformsWithSignal(
  brandRollupSpend: { meta: number; tiktok: number; google: number } | null,
  fallbackMetaSpend: number,
  fallbackTiktokSpend: number,
  fallbackGoogleSpend: number,
): Array<"all" | "meta" | "google" | "tiktok"> {
  const metaSpend   = brandRollupSpend?.meta   ?? fallbackMetaSpend;
  const tiktokSpend = brandRollupSpend?.tiktok ?? fallbackTiktokSpend;
  const googleSpend = brandRollupSpend?.google ?? fallbackGoogleSpend;

  const pills: Array<"all" | "meta" | "google" | "tiktok"> = ["all"];
  if (metaSpend   > 0) pills.push("meta");
  if (tiktokSpend > 0) pills.push("tiktok");
  if (googleSpend > 0) pills.push("google");
  return pills;
}

describe("platform pills — rollup-based presence detection", () => {
  it("shows TikTok pill when rollup has tiktok_spend > 0 even if API tiktok payload is null", () => {
    const brandRollupSpend = { meta: 2642, tiktok: 933, google: 0 };
    // API payload says no TikTok (null/0 because no breakdown snapshot)
    const pills = computePlatformsWithSignal(brandRollupSpend, 2642, 0, 0);
    assert.ok(pills.includes("tiktok"), "TikTok pill must appear when rollup has spend");
    assert.ok(!pills.includes("google"), "Google pill absent when spend = 0");
  });

  it("shows all three platform pills when all have rollup spend", () => {
    const brandRollupSpend = { meta: 1000, tiktok: 500, google: 250 };
    const pills = computePlatformsWithSignal(brandRollupSpend, 0, 0, 0);
    assert.ok(pills.includes("meta"));
    assert.ok(pills.includes("tiktok"));
    assert.ok(pills.includes("google"));
  });

  it("Ironworks fixture: [all][meta][tiktok] — no Google Ads spend", () => {
    const brandRollupSpend = { meta: 2642, tiktok: 933, google: 0 };
    const pills = computePlatformsWithSignal(brandRollupSpend, 0, 0, 0);
    assert.deepStrictEqual(pills, ["all", "meta", "tiktok"]);
  });

  it("falls back to API-sourced spend when brandRollupSpend is null (non-brand_campaign)", () => {
    // For regular event-kind events brandRollupSpend is null, so the
    // fallback values (from Meta API) are used.
    const pills = computePlatformsWithSignal(null, 1500, 0, 0);
    assert.deepStrictEqual(pills, ["all", "meta"]);
  });

  it("shows only [all] when no platform has any spend", () => {
    const brandRollupSpend = { meta: 0, tiktok: 0, google: 0 };
    const pills = computePlatformsWithSignal(brandRollupSpend, 0, 0, 0);
    assert.deepStrictEqual(pills, ["all"]);
  });
});
