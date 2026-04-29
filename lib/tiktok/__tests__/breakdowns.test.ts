import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TikTokApiError } from "../client.ts";
import {
  buildDateWindows,
  fetchTikTokBreakdowns,
  writeTikTokBreakdownSnapshots,
  type FetchTikTokBreakdownsInput,
} from "../breakdowns.ts";

type Request = NonNullable<FetchTikTokBreakdownsInput["request"]>;

describe("fetchTikTokBreakdowns", () => {
  it("requests each dimension separately and maps API rows", async () => {
    const reportDimensions: unknown[] = [];
    const request: Request = async <T,>(
      path: string,
      params: Record<string, unknown>,
    ): Promise<T> => {
      if (path === "/campaign/get/") {
        return {
          list: [{ campaign_id: "campaign-1", campaign_name: "[EVT] Campaign" }],
        } as T;
      }
      reportDimensions.push(params.dimensions);
      return {
        list: [
          {
            dimensions: {
              campaign_id: "campaign-1",
              country_code: "GB",
              age: "18-24",
              gender: "FEMALE",
              interest_category: "Music",
            },
            metrics: {
              spend: "10",
              impressions: "1000",
              reach: "800",
              clicks: "50",
              ctr: "5",
              video_watched_2s: "700",
              video_watched_6s: "500",
              video_views_p100: "250",
              average_video_play: "4200",
            },
          },
        ],
        page_info: { page: 1, total_page: 1 },
      } as T;
    };

    const rows = await fetchTikTokBreakdowns({
      advertiserId: "advertiser-1",
      token: "token-1",
      eventCode: "EVT",
      since: "2026-04-01",
      until: "2026-04-30",
      dimensions: ["country", "age_gender", "interest_category"],
      request,
    });

    assert.deepEqual(reportDimensions, [
      ["campaign_id", "country_code"],
      ["campaign_id", "age", "gender"],
      ["campaign_id", "interest_category"],
    ]);
    assert.deepEqual(
      rows.map((row) => [row.dimension, row.dimension_value, row.spend]),
      [
        ["age_gender", "18-24:FEMALE", 10],
        ["country", "GB", 10],
        ["interest_category", "Music", 10],
      ],
    );
    assert.equal(rows[0].video_views_2s, 700);
    assert.equal(rows[0].avg_play_time_ms, 4200);
  });

  it("retries TikTok 50001 once for report calls", async () => {
    let calls = 0;
    const request: Request = async <T,>(path: string): Promise<T> => {
      if (path === "/campaign/get/") return { list: [] } as T;
      calls += 1;
      if (calls === 1) {
        throw new TikTokApiError("rate limited", 50001, "req-1", 200);
      }
      return { list: [], page_info: { page: 1, total_page: 1 } } as T;
    };

    await fetchTikTokBreakdowns({
      advertiserId: "advertiser-1",
      token: "token-1",
      eventCode: "EVT",
      since: "2026-04-01",
      until: "2026-04-30",
      dimensions: ["country"],
      request,
      retryDelayMs: 0,
      sleep: async () => undefined,
    });

    assert.equal(calls, 2);
  });

  it("chunks long windows into TikTok-safe 30 day spans", () => {
    assert.deepEqual(buildDateWindows("2026-01-01", "2026-03-15"), [
      { since: "2026-01-01", until: "2026-01-30" },
      { since: "2026-01-31", until: "2026-03-01" },
      { since: "2026-03-02", until: "2026-03-15" },
    ]);
  });
});

describe("writeTikTokBreakdownSnapshots", () => {
  it("refuses skip and error rows to preserve last-good snapshots", async () => {
    const calls: unknown[] = [];
    const supabase = {
      from() {
        return {
          upsert(payload: unknown) {
            calls.push(payload);
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };
    const key = {
      userId: "user-1",
      eventId: "event-1",
      window: { since: "2026-04-01", until: "2026-04-30" },
    };

    assert.equal(
      await writeTikTokBreakdownSnapshots(supabase as never, key, {
        kind: "skip",
        reason: "no_credentials",
      }),
      false,
    );
    assert.equal(
      await writeTikTokBreakdownSnapshots(supabase as never, key, {
        kind: "error",
        message: "boom",
      }),
      false,
    );
    assert.equal(calls.length, 0);
  });
});
