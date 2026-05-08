import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  aggregateStatsForAll,
  aggregateStatsForPlatform,
  buildWindowDaySet,
} from "../venue-stats-grid-aggregator.ts";
import type { DailyRollupRow } from "../../db/client-portal-server.ts";

/**
 * Build a fixture row with sensible nulls — the slim portal payload
 * has many nullable columns and the aggregator must not double-count
 * null spend as zero in the "hasData" check.
 */
function row(overrides: Partial<DailyRollupRow>): DailyRollupRow {
  return {
    event_id: "evt-1",
    date: "2026-04-01",
    tickets_sold: null,
    ad_spend: null,
    tiktok_spend: null,
    google_ads_spend: null,
    ad_spend_allocated: null,
    revenue: null,
    link_clicks: null,
    meta_regs: null,
    tiktok_clicks: null,
    ad_spend_specific: null,
    ad_spend_generic_share: null,
    ad_spend_presale: null,
    ...overrides,
  };
}

describe("venue-stats-grid-aggregator", () => {
  describe("aggregateStatsForPlatform — meta", () => {
    it("returns empty cells with hasData=false on no rows", () => {
      const cells = aggregateStatsForPlatform([], "meta", null);
      assert.equal(cells.spend, 0);
      assert.equal(cells.daysCount, 0);
      assert.equal(cells.hasData, false);
      assert.equal(cells.ctr, null);
      assert.equal(cells.cpm, null);
    });

    it("prefers ad_spend_allocated + presale over raw ad_spend", () => {
      const rows: DailyRollupRow[] = [
        row({
          date: "2026-04-01",
          ad_spend: 100, // raw — should be ignored when allocated is set
          ad_spend_allocated: 60,
          ad_spend_presale: 20,
          meta_impressions: 1000,
          link_clicks: 50,
        }),
      ];
      const cells = aggregateStatsForPlatform(rows, "meta", null);
      assert.equal(cells.spend, 80, "should sum allocated + presale");
      assert.equal(cells.impressions, 1000);
      assert.equal(cells.clicks, 50);
      assert.ok(cells.hasData);
    });

    it("falls back to raw ad_spend when allocator hasn't run", () => {
      const rows: DailyRollupRow[] = [
        row({ ad_spend: 100, meta_impressions: 200 }),
      ];
      const cells = aggregateStatsForPlatform(rows, "meta", null);
      assert.equal(cells.spend, 100);
      assert.equal(cells.impressions, 200);
    });

    it("computes derived metrics: CTR / CPM / CPC", () => {
      const rows: DailyRollupRow[] = [
        row({
          ad_spend_allocated: 100,
          meta_impressions: 10_000,
          link_clicks: 100,
          meta_engagements: 50,
          meta_video_plays_3s: 200,
        }),
      ];
      const cells = aggregateStatsForPlatform(rows, "meta", null);
      assert.equal(cells.ctr, 1, "100 clicks / 10,000 impressions = 1.0%");
      assert.equal(cells.cpm, 10, "£100 / 10,000 impressions × 1,000 = £10");
      assert.equal(cells.costPerClick, 1);
      assert.equal(cells.costPerVideoPlay, 0.5);
      assert.equal(cells.costPerEngagement, 2);
    });
  });

  describe("aggregateStatsForPlatform — tiktok / google_ads", () => {
    it("aggregates TikTok spend + clicks + video views from tiktok_* columns", () => {
      const rows: DailyRollupRow[] = [
        row({
          date: "2026-04-01",
          tiktok_spend: 50,
          tiktok_impressions: 5_000,
          tiktok_clicks: 75,
          tiktok_video_views: 1_200,
        }),
      ];
      const cells = aggregateStatsForPlatform(rows, "tiktok", null);
      assert.equal(cells.spend, 50);
      assert.equal(cells.impressions, 5_000);
      assert.equal(cells.clicks, 75);
      assert.equal(cells.videoPlays, 1_200);
      assert.equal(cells.engagements, 0, "TikTok rollup has no engagements column");
      assert.equal(cells.reach, 0, "TikTok rollup has no deduped reach");
    });

    it("aggregates Google Ads from google_ads_* columns", () => {
      const rows: DailyRollupRow[] = [
        row({
          google_ads_spend: 30,
          google_ads_impressions: 3_000,
          google_ads_clicks: 45,
          google_ads_video_views: 800,
        }),
      ];
      const cells = aggregateStatsForPlatform(rows, "google_ads", null);
      assert.equal(cells.spend, 30);
      assert.equal(cells.impressions, 3_000);
      assert.equal(cells.clicks, 45);
      assert.equal(cells.videoPlays, 800);
    });

    it("hasData=false when the platform has no positive activity", () => {
      // Row has Meta activity but no TikTok / Google — TikTok cells
      // should report hasData=false so the parent renders the
      // 'Not connected' card instead of a row of zeros.
      const rows: DailyRollupRow[] = [
        row({ ad_spend_allocated: 100, meta_impressions: 1_000 }),
      ];
      assert.equal(aggregateStatsForPlatform(rows, "tiktok", null).hasData, false);
      assert.equal(
        aggregateStatsForPlatform(rows, "google_ads", null).hasData,
        false,
      );
    });
  });

  describe("aggregateStatsForAll", () => {
    it("sums spend / impressions / clicks across the three platforms", () => {
      const rows: DailyRollupRow[] = [
        row({
          ad_spend_allocated: 100,
          meta_impressions: 10_000,
          link_clicks: 100,
          meta_engagements: 25,
          tiktok_spend: 50,
          tiktok_impressions: 5_000,
          tiktok_clicks: 50,
          google_ads_spend: 30,
          google_ads_impressions: 3_000,
          google_ads_clicks: 30,
        }),
      ];
      const cells = aggregateStatsForAll(rows, null);
      assert.equal(cells.spend, 180);
      assert.equal(cells.impressions, 18_000);
      assert.equal(cells.clicks, 180);
      assert.equal(
        cells.engagements,
        25,
        "engagements stays Meta-only (no equivalent in TikTok / Google rollup)",
      );
    });
  });

  describe("buildWindowDaySet + windowing", () => {
    it("filters rows to the supplied days", () => {
      const rows: DailyRollupRow[] = [
        row({ date: "2026-04-01", ad_spend_allocated: 100 }),
        row({ date: "2026-04-02", ad_spend_allocated: 50 }),
        row({ date: "2026-04-03", ad_spend_allocated: 25 }),
      ];
      const windowSet = buildWindowDaySet(["2026-04-02", "2026-04-03"]);
      const cells = aggregateStatsForPlatform(rows, "meta", windowSet);
      assert.equal(cells.spend, 75, "should only sum 2 + 3, not 1");
      assert.equal(cells.daysCount, 2);
    });

    it("null windowDays = no filter (lifetime)", () => {
      const rows: DailyRollupRow[] = [
        row({ date: "2026-04-01", ad_spend_allocated: 100 }),
        row({ date: "2026-04-02", ad_spend_allocated: 50 }),
      ];
      const cells = aggregateStatsForPlatform(rows, "meta", null);
      assert.equal(cells.spend, 150);
      assert.equal(cells.daysCount, 2);
    });

    it("empty windowDays = explicitly empty (zero everything)", () => {
      const rows: DailyRollupRow[] = [
        row({ date: "2026-04-01", ad_spend_allocated: 100 }),
      ];
      const windowSet = buildWindowDaySet([]);
      const cells = aggregateStatsForPlatform(rows, "meta", windowSet);
      assert.equal(cells.spend, 0);
      assert.equal(cells.daysCount, 0);
      assert.equal(cells.hasData, false);
    });
  });
});
