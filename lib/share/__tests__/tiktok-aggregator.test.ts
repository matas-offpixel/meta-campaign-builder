import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { aggregateTikTokRollups } from "../tiktok-aggregator.ts";
import type { EventDailyRollup } from "../../db/event-daily-rollups.ts";

const WINDOW = { since: "2026-05-22", until: "2026-05-24" };

function row(overrides: Partial<EventDailyRollup>): EventDailyRollup {
  return {
    id: "row-1",
    user_id: "u-1",
    event_id: "evt-1",
    date: "2026-05-22",
    ad_spend: null,
    link_clicks: null,
    tickets_sold: null,
    revenue: null,
    meta_regs: null,
    ad_spend_allocated: null,
    ad_spend_specific: null,
    ad_spend_generic_share: null,
    ad_spend_presale: null,
    tiktok_spend: null,
    tiktok_impressions: null,
    tiktok_reach: null,
    tiktok_clicks: null,
    tiktok_video_views: null,
    tiktok_video_views_2s: null,
    tiktok_video_views_6s: null,
    tiktok_video_views_100p: null,
    tiktok_avg_play_time_ms: null,
    tiktok_post_engagement: null,
    tiktok_results: null,
    meta_impressions: null,
    meta_reach: null,
    meta_video_plays_3s: null,
    meta_video_plays_15s: null,
    meta_video_plays_p100: null,
    meta_engagements: null,
    google_ads_spend: null,
    google_ads_impressions: null,
    google_ads_clicks: null,
    google_ads_conversions: null,
    google_ads_video_views: null,
    source_meta_at: null,
    source_eventbrite_at: null,
    source_tiktok_at: "2026-05-26T10:00:00Z",
    source_google_ads_at: null,
    notes: null,
    created_at: "2026-05-22T00:00:00Z",
    updated_at: "2026-05-22T00:00:00Z",
    ...overrides,
  };
}

describe("aggregateTikTokRollups", () => {
  it("BB26-KAYODE regression — sums reach, vv2s, vv6s across 3 days", () => {
    // Mirroring live 22/23/24 May data for BB26-KAYODE
    const rows = [
      row({
        date: "2026-05-22",
        tiktok_spend: 58.72,
        tiktok_impressions: 199000,
        tiktok_reach: 188000,
        tiktok_video_views_2s: 157000,
        tiktok_video_views_6s: 98000,
        tiktok_avg_play_time_ms: 9800,
      }),
      row({
        date: "2026-05-23",
        tiktok_spend: 61.28,
        tiktok_impressions: 203000,
        tiktok_reach: 216000,
        tiktok_video_views_2s: 185000,
        tiktok_video_views_6s: 121000,
        tiktok_avg_play_time_ms: 9500,
      }),
      row({
        date: "2026-05-24",
        tiktok_spend: 40,
        tiktok_impressions: 151000,
        tiktok_reach: 147804,
        tiktok_video_views_2s: 125730,
        tiktok_video_views_6s: 82644,
        tiktok_avg_play_time_ms: 9100,
      }),
    ];

    const totals = aggregateTikTokRollups(rows, WINDOW);

    assert.equal(totals.reach, 551804, "reach should sum to 551,804");
    assert.equal(totals.videoViews2s, 467730, "vv2s should sum to 467,730");
    assert.equal(totals.videoViews6s, 301644, "vv6s should sum to 301,644");

    // Derived fields (confirmed non-null given reach > 0)
    const frequency =
      totals.reach > 0 ? totals.impressions / totals.reach : null;
    const cpr1k =
      totals.reach > 0 ? (totals.spend / totals.reach) * 1000 : null;
    assert.ok(frequency !== null, "frequency should be non-null");
    assert.ok(cpr1k !== null, "cost_per_1000_reached should be non-null");
    assert.ok(totals.videoViews2s > 0, "video_views_2s should be non-null");
    assert.ok(totals.videoViews6s > 0, "video_views_6s should be non-null");
  });

  it("spend present, null reach → reach=0, frequency/cpr1k fall back to null", () => {
    const rows = [
      row({
        date: "2026-05-22",
        tiktok_spend: 50,
        tiktok_impressions: 10000,
        tiktok_reach: null,
        tiktok_video_views_2s: 5000,
      }),
    ];

    const totals = aggregateTikTokRollups(rows, WINDOW);

    assert.equal(totals.spend, 50);
    assert.equal(totals.reach, 0, "null reach rows should contribute 0");
    // Callers must guard reach > 0 before dividing
    const frequency =
      totals.reach > 0 ? totals.impressions / totals.reach : null;
    const cpr1k =
      totals.reach > 0 ? (totals.spend / totals.reach) * 1000 : null;
    assert.equal(frequency, null);
    assert.equal(cpr1k, null);
  });

  it("all-zero tiktok rollups → video_views_2s/6s should surface null via || null guard", () => {
    const rows = [
      row({
        date: "2026-05-22",
        tiktok_spend: 10,
        tiktok_video_views_2s: 0,
        tiktok_video_views_6s: 0,
      }),
    ];

    const totals = aggregateTikTokRollups(rows, WINDOW);

    // The aggregator returns 0; the || null guard in the resolver converts to null
    assert.equal(totals.videoViews2s, 0);
    assert.equal(totals.videoViews6s, 0);
    assert.equal(
      totals.videoViews2s || null,
      null,
      "|| null guard must produce null for zero",
    );
    assert.equal(
      totals.videoViews6s || null,
      null,
      "|| null guard must produce null for zero",
    );
  });

  it("avg_play_time averages only rows with non-null tiktok_avg_play_time_ms", () => {
    // Day 1: 9000 ms, Day 2: null (no data), Day 3: 11000 ms
    // Mean should be (9000 + 11000) / 2 = 10000, not (9000 + 0 + 11000) / 3
    const rows = [
      row({
        date: "2026-05-22",
        tiktok_spend: 30,
        tiktok_avg_play_time_ms: 9000,
      }),
      row({
        date: "2026-05-23",
        tiktok_spend: 30,
        tiktok_avg_play_time_ms: null,
      }),
      row({
        date: "2026-05-24",
        tiktok_spend: 30,
        tiktok_avg_play_time_ms: 11000,
      }),
    ];

    const totals = aggregateTikTokRollups(rows, WINDOW);

    assert.equal(totals.avgPlayTimeMsRows, 2, "denominator should be 2 (rows with non-null value)");
    assert.equal(
      totals.avgPlayTimeMsTotal / totals.avgPlayTimeMsRows,
      10000,
      "mean should be 10000 ms, not 6666",
    );
  });

  it("rows outside window are excluded", () => {
    const rows = [
      row({ date: "2026-05-21", tiktok_spend: 99, tiktok_reach: 999999 }),
      row({ date: "2026-05-22", tiktok_spend: 10, tiktok_reach: 1000 }),
    ];

    const totals = aggregateTikTokRollups(rows, WINDOW);

    assert.equal(totals.spend, 10);
    assert.equal(totals.reach, 1000);
  });

  it("returns zero totals for empty rows", () => {
    const totals = aggregateTikTokRollups([], WINDOW);
    assert.equal(totals.spend, 0);
    assert.equal(totals.reach, 0);
    assert.equal(totals.videoViews2s, 0);
    assert.equal(totals.avgPlayTimeMsRows, 0);
    assert.equal(totals.fetchedAt, null);
  });
});
