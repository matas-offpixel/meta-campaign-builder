import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDateWindows,
  fetchTikTokAdsForShareUncached,
  type FetchTikTokAdsForShareInput,
} from "../share-render.ts";

type Request = NonNullable<FetchTikTokAdsForShareInput["request"]>;

describe("fetchTikTokAdsForShare", () => {
  it("fetches matching ad rows with live metrics and creative fields", async () => {
    const calls: Array<{ path: string; params: Record<string, unknown> }> = [];
    const rows = await fetchTikTokAdsForShareUncached({
      supabase: {} as never,
      tiktokAccountId: "account-1",
      eventCode: "BB26-RIANBRAZIL",
      since: "2026-04-01",
      until: "2026-04-30",
      credentials: { access_token: "token", advertiser_ids: ["adv-1"] },
      request: (async <T,>(
        path: string,
        params: Record<string, unknown>,
      ): Promise<T> => {
        calls.push({ path, params });
        if (path === "/ad/get/") {
          return {
            list: [
              {
                ad_id: "ad-1",
                ad_name: "POST 1",
                campaign_id: "camp-1",
                campaign_name: "[BB26-RIANBRAZIL] awareness",
                operation_status: "ACTIVE",
                thumbnail_url: "https://example.com/thumb.jpg",
                preview_url: "https://www.tiktok.com/@x/video/1",
                ad_text: "Ad copy",
              },
            ],
            page_info: { page: 1, total_page: 1 },
          } as T;
        }
        if (path === "/report/integrated/get/") {
          return {
            list: [
              {
                dimensions: { ad_id: "ad-1", stat_time_day: "2026-04-01" },
                metrics: {
                  spend: "160",
                  impressions: "10000",
                  reach: "8000",
                  clicks: "500",
                  video_watched_2s: "7000",
                  video_watched_6s: "5000",
                  video_views_p100: "3000",
                  average_video_play: "4.5",
                },
              },
            ],
            page_info: { page: 1, total_page: 1 },
          } as T;
        }
        return { list: [] } as T;
      }) as Request,
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].ad_name, "POST 1");
    assert.equal(rows[0].cost, 160);
    assert.equal(rows[0].thumbnail_url, "https://example.com/thumb.jpg");
    assert.equal(rows[0].post_url, "https://www.tiktok.com/@x/video/1");
    assert.ok(calls.some((call) => call.path === "/ad/get/"));
    assert.ok(calls.some((call) => call.path === "/report/integrated/get/"));
  });

  it("falls back to campaign-name filtering when ad name omits event code", async () => {
    const rows = await fetchTikTokAdsForShareUncached({
      supabase: {} as never,
      tiktokAccountId: "account-1",
      eventCode: "BB26-RIANBRAZIL",
      since: "2026-04-01",
      until: "2026-04-30",
      credentials: { access_token: "token", advertiser_ids: ["adv-1"] },
      request: (async <T,>(path: string): Promise<T> => {
        if (path === "/ad/get/") {
          return {
            list: [
              {
                ad_id: "ad-1",
                ad_name: "POST 1",
                campaign_id: "camp-1",
                campaign_name: "[BB26-RIANBRAZIL] awareness",
              },
              {
                ad_id: "ad-2",
                ad_name: "POST 2",
                campaign_id: "camp-2",
                campaign_name: "[OTHER] awareness",
              },
            ],
            page_info: { page: 1, total_page: 1 },
          } as T;
        }
        return { list: [], page_info: { page: 1, total_page: 1 } } as T;
      }) as Request,
    });

    assert.deepEqual(
      rows.map((row) => row.ad_id),
      ["ad-1"],
    );
  });

  it("chunks long windows into TikTok-safe 30 day spans", () => {
    assert.deepEqual(buildDateWindows("2026-01-01", "2026-03-15"), [
      { since: "2026-01-01", until: "2026-01-30" },
      { since: "2026-01-31", until: "2026-03-01" },
      { since: "2026-03-02", until: "2026-03-15" },
    ]);
  });
});
