import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  fetchTikTokDailyRollupInsights,
  TIKTOK_ROLLUP_METRICS,
  type FetchTikTokDailyRollupInsightsInput,
} from "../rollup-insights.ts";

type Request = NonNullable<FetchTikTokDailyRollupInsightsInput["request"]>;

interface ReportCall {
  start_date: string;
  end_date: string;
}

function makeRequest(): { request: Request; reportCalls: ReportCall[] } {
  const reportCalls: ReportCall[] = [];
  const request: Request = async <T,>(
    path: Parameters<Request>[0],
    params: Parameters<Request>[1],
  ): Promise<T> => {
    if (path === "/campaign/get/") {
      return {
        list: [
          {
            campaign_id: "campaign-1",
            campaign_name: "[BB26-RIANBRAZIL] conversion",
          },
        ],
      } as T;
    }
    assert.equal(path, "/report/integrated/get/");
    const startDate = String(params.start_date);
    const endDate = String(params.end_date);
    reportCalls.push({ start_date: startDate, end_date: endDate });

    if (startDate === "2026-03-01") {
      return {
        list: [
          {
            dimensions: {
              campaign_id: "campaign-1",
              stat_time_day: "2026-03-14 00:00:00",
            },
            metrics: {
              spend: "60",
              impressions: "1000",
              reach: "800",
              clicks: "10",
              comments: "10",
              likes: "20",
              shares: "7",
              follows: "5",
              video_play_actions: "25",
              video_watched_2s: "500",
              video_watched_6s: "300",
              video_views_p100: "15",
              average_video_play: "1250",
            },
          },
        ],
        page_info: { page: 1, total_page: 1 },
      } as T;
    }

    return {
      list: [
        {
          dimensions: {
            campaign_id: "campaign-1",
            stat_time_day: "2026-04-12 00:00:00",
          },
          metrics: {
            spend: "100",
            impressions: "2000",
            reach: "1500",
            clicks: "20",
            comments: "20",
            likes: "40",
            shares: "14",
            follows: "10",
            video_play_actions: "35",
            video_watched_2s: "1000",
            video_watched_6s: "700",
            video_views_p100: "25",
            average_video_play: "1500",
          },
        },
      ],
      page_info: { page: 1, total_page: 1 },
    } as T;
  };

  return { request, reportCalls };
}

describe("fetchTikTokDailyRollupInsights date window chunking", () => {
  it("requests only TikTok-valid AUCTION_CAMPAIGN BASIC metrics", () => {
    const validMetrics = new Set([
      "spend",
      "impressions",
      "reach",
      "clicks",
      "comments",
      "likes",
      "shares",
      "follows",
      "video_play_actions",
      "video_watched_2s",
      "video_watched_6s",
      "video_views_p25",
      "video_views_p50",
      "video_views_p75",
      "video_views_p100",
      "average_video_play",
    ]);

    assert.ok(!TIKTOK_ROLLUP_METRICS.includes("engagements"));
    assert.ok(!TIKTOK_ROLLUP_METRICS.includes("post_engagement"));
    assert.deepEqual(
      TIKTOK_ROLLUP_METRICS.filter((metric) => !validMetrics.has(metric)),
      [],
    );
  });

  it("requests both 30-day slices and accumulates rows across slices", async () => {
    const { request, reportCalls } = makeRequest();

    const rows = await fetchTikTokDailyRollupInsights({
      advertiserId: "advertiser-1",
      token: "token-1",
      eventCode: "BB26-RIANBRAZIL",
      since: "2026-03-01",
      until: "2026-04-29",
      request,
    });

    assert.deepEqual(reportCalls, [
      { start_date: "2026-03-01", end_date: "2026-03-30" },
      { start_date: "2026-03-31", end_date: "2026-04-29" },
    ]);
    assert.deepEqual(rows, [
      {
        date: "2026-03-14",
        tiktok_spend: 60,
        tiktok_impressions: 1000,
        tiktok_reach: 800,
        tiktok_clicks: 10,
        tiktok_video_views: 15,
        tiktok_video_views_2s: 500,
        tiktok_video_views_6s: 300,
        tiktok_video_views_100p: 15,
        tiktok_avg_play_time_ms: 1250,
        tiktok_post_engagement: 42,
        tiktok_results: 25,
      },
      {
        date: "2026-04-12",
        tiktok_spend: 100,
        tiktok_impressions: 2000,
        tiktok_reach: 1500,
        tiktok_clicks: 20,
        tiktok_video_views: 25,
        tiktok_video_views_2s: 1000,
        tiktok_video_views_6s: 700,
        tiktok_video_views_100p: 25,
        tiktok_avg_play_time_ms: 1500,
        tiktok_post_engagement: 84,
        tiktok_results: 35,
      },
    ]);
  });

  it("keeps a 30-day inclusive window in one request", async () => {
    const { request, reportCalls } = makeRequest();

    await fetchTikTokDailyRollupInsights({
      advertiserId: "advertiser-1",
      token: "token-1",
      eventCode: "BB26-RIANBRAZIL",
      since: "2026-03-01",
      until: "2026-03-30",
      request,
    });

    assert.deepEqual(reportCalls, [
      { start_date: "2026-03-01", end_date: "2026-03-30" },
    ]);
  });

  it("splits a 60-day inclusive window into exactly two report requests", async () => {
    const { request, reportCalls } = makeRequest();

    await fetchTikTokDailyRollupInsights({
      advertiserId: "advertiser-1",
      token: "token-1",
      eventCode: "BB26-RIANBRAZIL",
      since: "2026-03-01",
      until: "2026-04-29",
      request,
    });

    assert.equal(reportCalls.length, 2);
    assert.deepEqual(reportCalls, [
      { start_date: "2026-03-01", end_date: "2026-03-30" },
      { start_date: "2026-03-31", end_date: "2026-04-29" },
    ]);
  });

  it("derives post engagement from comments, likes, shares, and follows", async () => {
    const request: Request = async <T,>(path: string): Promise<T> => {
      if (path === "/campaign/get/") {
        return {
          list: [
            {
              campaign_id: "campaign-1",
              campaign_name: "[BB26-RIANBRAZIL] conversion",
            },
          ],
        } as T;
      }
      return {
        list: [
          {
            dimensions: {
              campaign_id: "campaign-1",
              stat_time_day: "2026-04-12 00:00:00",
            },
            metrics: {
              spend: "1",
              impressions: "10",
              comments: "2",
              likes: "3",
              shares: "4",
              follows: "5",
            },
          },
        ],
        page_info: { page: 1, total_page: 1 },
      } as T;
    };

    const rows = await fetchTikTokDailyRollupInsights({
      advertiserId: "advertiser-1",
      token: "token-1",
      eventCode: "BB26-RIANBRAZIL",
      since: "2026-04-12",
      until: "2026-04-12",
      request,
    });

    assert.equal(rows[0].tiktok_post_engagement, 14);
  });

  it("defaults derived post engagement to 0 when engagement metrics are absent", async () => {
    const request: Request = async <T,>(path: string): Promise<T> => {
      if (path === "/campaign/get/") {
        return {
          list: [
            {
              campaign_id: "campaign-1",
              campaign_name: "[BB26-RIANBRAZIL] conversion",
            },
          ],
        } as T;
      }
      return {
        list: [
          {
            dimensions: {
              campaign_id: "campaign-1",
              stat_time_day: "2026-04-12 00:00:00",
            },
            metrics: {
              spend: "1",
              impressions: "10",
            },
          },
        ],
        page_info: { page: 1, total_page: 1 },
      } as T;
    };

    const rows = await fetchTikTokDailyRollupInsights({
      advertiserId: "advertiser-1",
      token: "token-1",
      eventCode: "BB26-RIANBRAZIL",
      since: "2026-04-12",
      until: "2026-04-12",
      request,
    });

    assert.equal(rows[0].tiktok_post_engagement, 0);
  });
});
