/**
 * lib/mailchimp/__tests__/platform-filter.test.ts
 *
 * Unit tests for the platform-filter spend logic that drives the
 * Performance Summary cards on brand_campaign share reports.
 *
 * Tests the pure filtering logic extracted from EventReportView.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

type PlatformFilter = "all" | "meta" | "google" | "tiktok";

/**
 * Pure helper mirroring the filteredPaidMediaSpent computation in
 * EventReportView — extracted here so we can test it without importing
 * the React component.
 */
function computeFilteredSpend(
  metaSpend: number,
  googleAdsSpend: number,
  tiktokSpend: number,
  platformFilter: PlatformFilter,
  isBrandCampaign: boolean,
): number {
  const platformSpend = metaSpend + googleAdsSpend + tiktokSpend;
  if (!isBrandCampaign) return platformSpend;
  switch (platformFilter) {
    case "meta":
      return metaSpend;
    case "tiktok":
      return tiktokSpend;
    case "google":
      return googleAdsSpend;
    default:
      return platformSpend;
  }
}

describe("computeFilteredSpend — brand_campaign platform filter", () => {
  const meta = 1000;
  const google = 500;
  const tiktok = 300;

  it("returns aggregate when filter is 'all'", () => {
    assert.equal(computeFilteredSpend(meta, google, tiktok, "all", true), 1800);
  });

  it("returns only Meta spend when filter is 'meta'", () => {
    assert.equal(computeFilteredSpend(meta, google, tiktok, "meta", true), 1000);
  });

  it("returns only TikTok spend when filter is 'tiktok'", () => {
    assert.equal(computeFilteredSpend(meta, google, tiktok, "tiktok", true), 300);
  });

  it("returns only Google spend when filter is 'google'", () => {
    assert.equal(computeFilteredSpend(meta, google, tiktok, "google", true), 500);
  });

  it("ignores platform filter for event kind (not brand_campaign)", () => {
    assert.equal(computeFilteredSpend(meta, google, tiktok, "meta", false), 1800);
  });

  it("handles zero spend for a platform gracefully", () => {
    assert.equal(computeFilteredSpend(meta, 0, 0, "meta", true), 1000);
    assert.equal(computeFilteredSpend(meta, 0, 0, "tiktok", true), 0);
    assert.equal(computeFilteredSpend(meta, 0, 0, "google", true), 0);
  });
});
