import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  aggregateStatsForAll,
  aggregateStatsForPlatform,
  buildWindowDaySet,
} from "../venue-stats-grid-aggregator.ts";
import { buildEventIdToCodeMap } from "../venue-rollup-dedup.ts";
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

  describe("event_code dedup of campaign-wide Meta columns", () => {
    // Pin the Shepherd's Bush venue-level totals reported by the user
    // on 2026-05-13. Pre-fix the venue card showed Reach 1,231,744
    // because four sibling events under the WC26-LONDON-SHEPHERDS
    // event_code each held the SAME campaign-wide reach for every
    // calendar day, and the aggregator naively summed them. After
    // the dedup pass the venue total must collapse back to ~175,330
    // (the figure Meta itself reports for the three campaigns under
    // [WC26-LONDON-SHEPHERDS]).
    const SHEPHERDS_EVENT_CODE = "WC26-LONDON-SHEPHERDS";
    const SHEPHERDS_EVENT_IDS = ["shp-aus", "shp-nl", "shp-fr", "shp-de"];

    function shepherdsRollupsForOneDay(
      date: string,
      campaignWide: {
        impressions: number;
        reach: number;
        videoPlays3s: number;
        engagements: number;
        regs: number;
        rawSpend: number;
        rawClicks: number;
      },
    ): DailyRollupRow[] {
      // Each sibling carries the IDENTICAL campaign-wide value for
      // the day — exactly what `fetchEventDailyMetaMetrics` writes
      // when four events share one bracketed event_code. Per-event
      // allocator output is left null so the aggregator falls back
      // to raw `ad_spend` / raw `link_clicks`, which exercises the
      // post-allocator-NOT-RUN branch of the dedup.
      return SHEPHERDS_EVENT_IDS.map((id) =>
        row({
          event_id: id,
          date,
          ad_spend: campaignWide.rawSpend,
          meta_impressions: campaignWide.impressions,
          meta_reach: campaignWide.reach,
          meta_video_plays_3s: campaignWide.videoPlays3s,
          meta_engagements: campaignWide.engagements,
          meta_regs: campaignWide.regs,
          link_clicks: campaignWide.rawClicks,
        }),
      );
    }

    it("Shepherd's Bush — Reach collapses from 4× to 1× after dedup", () => {
      // Single-day fixture mirroring the production figures: the
      // Meta UI's lifetime reach across the three WC26-LONDON-
      // SHEPHERDS campaigns is 175,330. The venue card pre-fix
      // showed 1,231,744 ≈ 7× — a mix of 4-fixture × per-day
      // duplication and cumulative cron snapshots. The unit-level
      // invariant we pin here is that the aggregated venue reach
      // for a single day must equal the campaign-wide reach for
      // that day, NOT N× the campaign-wide reach.
      const eventIdToCode = buildEventIdToCodeMap(
        SHEPHERDS_EVENT_IDS.map((id) => ({
          id,
          event_code: SHEPHERDS_EVENT_CODE,
        })),
      );
      const rows = shepherdsRollupsForOneDay("2026-04-15", {
        impressions: 250_000,
        reach: 175_330,
        videoPlays3s: 60_000,
        engagements: 9_000,
        regs: 120,
        rawSpend: 1_800,
        rawClicks: 12_199,
      });
      const cells = aggregateStatsForPlatform(rows, "meta", null, eventIdToCode);
      assert.equal(cells.reach, 175_330, "venue reach equals campaign reach");
      assert.equal(cells.impressions, 250_000);
      assert.equal(cells.videoPlays, 60_000);
      assert.equal(cells.engagements, 9_000);
      assert.equal(
        cells.spend,
        1_800,
        "raw ad_spend dedups when allocator hasn't run",
      );
      assert.equal(
        cells.clicks,
        12_199,
        "raw link_clicks dedups when allocator hasn't run",
      );
    });

    it("Shepherd's Bush — venue reach across multiple days = SUM of per-day MAXes", () => {
      // Real venue lifetime: per-day MAX, summed across days. Two
      // illustrative days × 4 siblings × identical campaign-wide
      // values per day. Without the dedup, the result would be 8×
      // (four siblings × two days) the campaign per-day total.
      const eventIdToCode = buildEventIdToCodeMap(
        SHEPHERDS_EVENT_IDS.map((id) => ({
          id,
          event_code: SHEPHERDS_EVENT_CODE,
        })),
      );
      const rows = [
        ...shepherdsRollupsForOneDay("2026-04-15", {
          impressions: 250_000,
          reach: 175_330,
          videoPlays3s: 60_000,
          engagements: 9_000,
          regs: 120,
          rawSpend: 1_800,
          rawClicks: 12_199,
        }),
        ...shepherdsRollupsForOneDay("2026-04-16", {
          impressions: 100_000,
          reach: 80_000,
          videoPlays3s: 25_000,
          engagements: 4_500,
          regs: 60,
          rawSpend: 900,
          rawClicks: 6_500,
        }),
      ];
      const cells = aggregateStatsForPlatform(rows, "meta", null, eventIdToCode);
      assert.equal(cells.reach, 175_330 + 80_000);
      assert.equal(cells.impressions, 250_000 + 100_000);
      assert.equal(cells.videoPlays, 60_000 + 25_000);
      assert.equal(cells.engagements, 9_000 + 4_500);
      assert.equal(cells.spend, 1_800 + 900);
      assert.equal(cells.clicks, 12_199 + 6_500);
    });

    it("Shepherd's Bush — CPM and CTR computed from deduped denominators", () => {
      // Pre-fix CPM and CTR were knock-on bugs: spend was correct
      // (allocator ran) but impressions/clicks were 4×, so CPM
      // collapsed by 4× and CTR by 4×. After the fix the derived
      // metrics reconcile with what Meta reports.
      const eventIdToCode = buildEventIdToCodeMap(
        SHEPHERDS_EVENT_IDS.map((id) => ({
          id,
          event_code: SHEPHERDS_EVENT_CODE,
        })),
      );
      const rows = SHEPHERDS_EVENT_IDS.map((id, i) =>
        row({
          event_id: id,
          date: "2026-04-15",
          // Allocator HAS run: per-event allocated/presale spend
          // sums to 1,800 across the four siblings.
          ad_spend_allocated: 450 - i * 10, // 450, 440, 430, 420
          ad_spend_presale: 0,
          // link_clicks is per-event after allocator; sums to the
          // venue-wide 12,199.
          link_clicks: i === 1 ? 10_411 : 596,
          meta_impressions: 250_000, // campaign-wide on each sibling
          meta_reach: 175_330,
          meta_video_plays_3s: 60_000,
          meta_engagements: 9_000,
        }),
      );
      const cells = aggregateStatsForPlatform(rows, "meta", null, eventIdToCode);
      assert.equal(cells.spend, 450 + 440 + 430 + 420, "1740");
      assert.equal(cells.clicks, 596 * 3 + 10_411, "12199");
      assert.equal(cells.impressions, 250_000);
      assert.equal(cells.reach, 175_330);
      // CPM = spend / impressions × 1000 — pre-fix this was 1/4 the
      // real value because impressions was 4× inflated.
      const expectedCpm = (1_740 / 250_000) * 1_000;
      assert.ok(
        Math.abs((cells.cpm ?? 0) - expectedCpm) < 0.001,
        `CPM ${cells.cpm} ≠ ${expectedCpm}`,
      );
      // CTR = clicks / impressions × 100 — pre-fix this was 4× the
      // real value because clicks was 4× inflated and impressions
      // was 4× inflated, but the per-platform aggregator preferred
      // post-allocator clicks (per-event SUM). With campaign-wide
      // impressions deduped, CTR resolves to the real number.
      const expectedCtr = (12_199 / 250_000) * 100;
      assert.ok(
        Math.abs((cells.ctr ?? 0) - expectedCtr) < 0.001,
        `CTR ${cells.ctr} ≠ ${expectedCtr}`,
      );
    });

    it("legacy callers without an event_code map fall back to old SUM behaviour", () => {
      // `eventIdToCode` is optional — tests written before the dedup
      // landed (and any non-venue-scope caller that passes flat rows)
      // get the original sum-everything semantics. This confirms
      // backward compatibility so the aggregator can be used in
      // contexts where dedup isn't the right answer.
      const rows = SHEPHERDS_EVENT_IDS.map((id) =>
        row({
          event_id: id,
          date: "2026-04-15",
          meta_reach: 175_330,
        }),
      );
      const legacyCells = aggregateStatsForPlatform(rows, "meta", null);
      assert.equal(
        legacyCells.reach,
        4 * 175_330,
        "without map, aggregator falls through to the old (buggy) sum",
      );
    });

    it("aggregateStatsForAll threads the eventIdToCode map through", () => {
      // The `all` view fans out to per-platform aggregations and
      // recombines the cells. The map must reach Meta so reach /
      // impressions / video plays / engagements collapse the same
      // way they do under the explicit `meta` selection.
      const eventIdToCode = buildEventIdToCodeMap(
        SHEPHERDS_EVENT_IDS.map((id) => ({
          id,
          event_code: SHEPHERDS_EVENT_CODE,
        })),
      );
      const rows = shepherdsRollupsForOneDay("2026-04-15", {
        impressions: 250_000,
        reach: 175_330,
        videoPlays3s: 60_000,
        engagements: 9_000,
        regs: 120,
        rawSpend: 1_800,
        rawClicks: 12_199,
      });
      const cells = aggregateStatsForAll(rows, null, eventIdToCode);
      assert.equal(cells.reach, 175_330);
      assert.equal(cells.impressions, 250_000);
      assert.equal(cells.engagements, 9_000);
    });
  });
});
