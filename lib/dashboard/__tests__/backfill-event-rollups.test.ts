/**
 * lib/dashboard/__tests__/backfill-event-rollups.test.ts
 *
 * Unit tests for the backfill cron eligibility extension and rollup
 * totals computation used by the backfill API route.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { mergeRollupSyncEligibilityIds } from "../cron-eligibility.ts";

// ── Helpers that mirror what app/share/report/[token]/page.tsx computes ──────

interface MockRollupRow {
  tiktok_spend: string | number | null;
  tiktok_impressions: string | number | null;
  tiktok_clicks: string | number | null;
  tiktok_video_views: string | number | null;
  tiktok_results: string | number | null;
}

function computeTikTokRollupTotals(rows: MockRollupRow[]) {
  const spend = rows.reduce((s, r) => s + Number(r.tiktok_spend ?? 0), 0);
  if (spend <= 0) return null;
  return {
    spend,
    impressions: rows.reduce(
      (s, r) => s + Number(r.tiktok_impressions ?? 0),
      0,
    ),
    clicks: rows.reduce((s, r) => s + Number(r.tiktok_clicks ?? 0), 0),
    videoViews: rows.reduce(
      (s, r) => s + Number(r.tiktok_video_views ?? 0),
      0,
    ),
    conversions: rows.reduce((s, r) => s + Number(r.tiktok_results ?? 0), 0),
  };
}

describe("backfill-event-rollups — cron eligibility", () => {
  it("brand_campaign IDs are included in rollup sync eligible set", () => {
    const result = mergeRollupSyncEligibilityIds({
      ticketingIds: ["evt-a"],
      saleDateIds: ["evt-b"],
      googleAdsIds: ["evt-c"],
      codeMatchIds: ["evt-d"],
      brandCampaignIds: ["ironworks-uuid", "brand-campaign-2"],
    });
    assert.ok(result.includes("ironworks-uuid"));
    assert.ok(result.includes("brand-campaign-2"));
  });

  it("brand_campaign IDs deduplicate with other legs", () => {
    const result = mergeRollupSyncEligibilityIds({
      ticketingIds: ["shared-id"],
      saleDateIds: [],
      googleAdsIds: [],
      codeMatchIds: [],
      brandCampaignIds: ["shared-id"],
    });
    assert.equal(
      result.filter((id) => id === "shared-id").length,
      1,
      "deduplication expected",
    );
  });

  it("empty brandCampaignIds doesn't break merge", () => {
    const result = mergeRollupSyncEligibilityIds({
      ticketingIds: ["evt-1"],
      saleDateIds: [],
      googleAdsIds: [],
      codeMatchIds: [],
      brandCampaignIds: [],
    });
    assert.deepEqual(result, ["evt-1"]);
  });
});

describe("backfill-event-rollups — TikTok totals from rollup rows", () => {
  it("computes tiktok spend correctly from a single row", () => {
    const totals = computeTikTokRollupTotals([
      {
        tiktok_spend: "933.00",
        tiktok_impressions: "461000",
        tiktok_clicks: "2900",
        tiktok_video_views: "310000",
        tiktok_results: "163",
      },
    ]);
    assert.ok(totals !== null);
    assert.equal(totals.spend, 933.0);
    assert.equal(totals.impressions, 461000);
    assert.equal(totals.conversions, 163);
  });

  it("sums metrics across multiple rows", () => {
    const rows: MockRollupRow[] = [
      {
        tiktok_spend: "50",
        tiktok_impressions: "10000",
        tiktok_clicks: "500",
        tiktok_video_views: "8000",
        tiktok_results: "30",
      },
      {
        tiktok_spend: "75",
        tiktok_impressions: "15000",
        tiktok_clicks: "700",
        tiktok_video_views: "12000",
        tiktok_results: "45",
      },
    ];
    const totals = computeTikTokRollupTotals(rows);
    assert.ok(totals !== null);
    assert.equal(totals.spend, 125);
    assert.equal(totals.impressions, 25000);
    assert.equal(totals.clicks, 1200);
    assert.equal(totals.videoViews, 20000);
    assert.equal(totals.conversions, 75);
  });

  it("returns null when all tiktok_spend rows are zero", () => {
    assert.equal(
      computeTikTokRollupTotals([
        {
          tiktok_spend: "0",
          tiktok_impressions: "0",
          tiktok_clicks: "0",
          tiktok_video_views: "0",
          tiktok_results: "0",
        },
      ]),
      null,
    );
  });

  it("handles null values gracefully (treats as 0)", () => {
    const totals = computeTikTokRollupTotals([
      {
        tiktok_spend: "100",
        tiktok_impressions: null,
        tiktok_clicks: null,
        tiktok_video_views: null,
        tiktok_results: null,
      },
    ]);
    assert.ok(totals !== null);
    assert.equal(totals.spend, 100);
    assert.equal(totals.impressions, 0);
    assert.equal(totals.conversions, 0);
  });
});
