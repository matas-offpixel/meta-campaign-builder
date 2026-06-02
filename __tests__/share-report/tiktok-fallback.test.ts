/**
 * TikTok fallback test: when no tiktok_manual_reports row exists for a
 * brand_campaign event (no event code / window), the rollup-based fallback
 * produces a TikTokReportBlockData with the correct shape.
 *
 * We test the pure logic by extracting the aggregate computation rather than
 * importing the full share page (which has server-only transitive deps).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ────────────────────────────────────────────────────────────────────────────
// Minimal re-implementation of buildTikTokRollupFallback so we can unit-test
// the aggregation logic without importing the RSC page.
// ────────────────────────────────────────────────────────────────────────────
type RollupRow = {
  date: string;
  tiktok_spend?: number | null;
  tiktok_impressions?: number | null;
  tiktok_clicks?: number | null;
  tiktok_video_views?: number | null;
  source_tiktok_at?: string | null;
};

function buildTikTokRollupFallback(
  eventName: string,
  rollups: RollupRow[],
): {
  id: string;
  campaign_name: string;
  date_range_start: string;
  date_range_end: string;
  source_label: string;
  snapshot: {
    campaign: {
      cost: number | null;
      impressions: number | null;
      clicks_destination: number | null;
    } | null;
  };
} | null {
  const rows = rollups.filter((r) => Number(r.tiktok_spend ?? 0) > 0);
  if (rows.length === 0) return null;

  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const spend = rows.reduce((s, r) => s + Number(r.tiktok_spend ?? 0), 0);
  const impressions = rows.reduce(
    (s, r) => s + Number(r.tiktok_impressions ?? 0),
    0,
  );
  const clicks = rows.reduce((s, r) => s + Number(r.tiktok_clicks ?? 0), 0);
  const spendRounded = Math.round(spend * 100) / 100;

  return {
    id: "rollup-no-window",
    campaign_name: `${eventName} TikTok`,
    date_range_start: sorted[0]!.date,
    date_range_end: sorted[sorted.length - 1]!.date,
    source_label: "rollup",
    snapshot: {
      campaign: {
        cost: spendRounded,
        impressions: impressions > 0 ? Math.round(impressions) : null,
        clicks_destination: clicks > 0 ? Math.round(clicks) : null,
      },
    },
  };
}

describe("buildTikTokRollupFallback", () => {
  it("returns null when no rollup rows have tiktok_spend", () => {
    const result = buildTikTokRollupFallback("Ironworks", [
      { date: "2026-01-01", tiktok_spend: 0 },
      { date: "2026-01-02", tiktok_spend: null },
    ]);
    assert.equal(result, null);
  });

  it("returns null for empty rollups", () => {
    const result = buildTikTokRollupFallback("Ironworks", []);
    assert.equal(result, null);
  });

  it("aggregates spend / impressions / clicks across multiple rollup rows", () => {
    const rollups: RollupRow[] = [
      {
        date: "2026-01-01",
        tiktok_spend: 300.5,
        tiktok_impressions: 10000,
        tiktok_clicks: 150,
        tiktok_video_views: 500,
      },
      {
        date: "2026-01-02",
        tiktok_spend: 632.75,
        tiktok_impressions: 25000,
        tiktok_clicks: 13,
        tiktok_video_views: 800,
      },
    ];

    const result = buildTikTokRollupFallback("Ironworks IRWOHD", rollups);

    assert.ok(result != null, "Expected non-null result");
    assert.equal(result.id, "rollup-no-window");
    assert.equal(result.source_label, "rollup");
    assert.equal(result.date_range_start, "2026-01-01");
    assert.equal(result.date_range_end, "2026-01-02");
    assert.equal(result.campaign_name, "Ironworks IRWOHD TikTok");

    const camp = result.snapshot.campaign!;
    assert.equal(camp.cost, 933.25); // 300.50 + 632.75
    assert.equal(camp.impressions, 35000);
    assert.equal(camp.clicks_destination, 163);
  });

  it("sorts date range using lexicographic date order", () => {
    const rollups: RollupRow[] = [
      { date: "2026-03-15", tiktok_spend: 50 },
      { date: "2026-01-10", tiktok_spend: 80 },
      { date: "2026-02-20", tiktok_spend: 40 },
    ];
    const result = buildTikTokRollupFallback("Event", rollups)!;
    assert.equal(result.date_range_start, "2026-01-10");
    assert.equal(result.date_range_end, "2026-03-15");
  });

  it("sets impressions/clicks to null when all rows are zero", () => {
    const rollups: RollupRow[] = [
      {
        date: "2026-01-01",
        tiktok_spend: 100,
        tiktok_impressions: 0,
        tiktok_clicks: 0,
      },
    ];
    const result = buildTikTokRollupFallback("Event", rollups)!;
    assert.equal(result.snapshot.campaign!.impressions, null);
    assert.equal(result.snapshot.campaign!.clicks_destination, null);
  });

  it("tiktokSpend check: cost is readable from snapshot.campaign.cost", () => {
    // This mirrors how event-report-view reads tiktokSpend:
    //   const tiktokSpend = tiktok?.snapshot.campaign?.cost ?? 0;
    const rollups: RollupRow[] = [
      { date: "2026-01-01", tiktok_spend: 933.25 },
    ];
    const result = buildTikTokRollupFallback("Event", rollups)!;
    // Simulates the reads in event-report-view.tsx:
    const tiktokSpend = result.snapshot.campaign?.cost ?? 0;
    assert.ok(tiktokSpend > 0, "tiktokSpend should be > 0 so pills render");
  });
});
