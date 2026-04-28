import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  fetchTikTokEventCampaignInsights,
  type FetchTikTokEventCampaignInsightsInput,
} from "../insights.ts";

type MockRequest = NonNullable<FetchTikTokEventCampaignInsightsInput["request"]>;

function baseInput(request: MockRequest): FetchTikTokEventCampaignInsightsInput {
  return {
    advertiserId: "advertiser-1",
    token: "token-1",
    eventCode: "BB26-RIANBRAZIL",
    window: { since: "2026-04-01", until: "2026-04-28" },
    request,
  };
}

describe("fetchTikTokEventCampaignInsights", () => {
  it("fetches campaign names via /campaign/get/ and materialises enriched names", async () => {
    const calls: Array<{ path: string; params: Record<string, unknown> }> = [];
    const request: MockRequest = async <T>(
      path: string,
      params: Record<string, unknown>,
    ): Promise<T> => {
      calls.push({ path, params });
      if (path === "/report/integrated/get/") {
        return {
          list: [
            {
              dimensions: { campaign_id: "campaign-1", stat_time_day: "2026-04-10" },
              metrics: {
                spend: "10.5",
                impressions: "1000",
                clicks: "50",
                video_play_actions: "25",
              },
            },
          ],
          page_info: { page: 1, total_page: 1 },
        } as T;
      }
      if (path === "/campaign/get/") {
        return {
          list: [
            {
              campaign_id: "campaign-1",
              campaign_name: "[BB26-RIANBRAZIL] Prospecting",
            },
          ],
        } as T;
      }
      throw new Error(`Unexpected path ${path}`);
    };

    const rows = await fetchTikTokEventCampaignInsights(baseInput(request));

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.path, "/report/integrated/get/");
    assert.deepEqual(calls[0]?.params.dimensions, [
      "campaign_id",
      "stat_time_day",
    ]);
    assert.equal(calls[1]?.path, "/campaign/get/");
    assert.deepEqual(calls[1]?.params.campaign_ids, ["campaign-1"]);
    assert.deepEqual(calls[1]?.params.fields, [
      "campaign_id",
      "campaign_name",
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.name, "[BB26-RIANBRAZIL] Prospecting");
    assert.equal(rows[0]?.spend, 10.5);
    assert.equal(rows[0]?.impressions, 1000);
    assert.equal(rows[0]?.clicks, 50);
    assert.equal(rows[0]?.results, 25);
  });

  it("filters against enriched campaign names with case-insensitive event_code matching", async () => {
    const request: MockRequest = async <T>(path: string): Promise<T> => {
      if (path === "/report/integrated/get/") {
        return {
          list: [
            {
              dimensions: { campaign_id: "campaign-match", stat_time_day: "2026-04-10" },
              metrics: { spend: "10", impressions: "100", clicks: "10" },
            },
            {
              dimensions: { campaign_id: "campaign-other", stat_time_day: "2026-04-10" },
              metrics: { spend: "20", impressions: "200", clicks: "20" },
            },
          ],
          page_info: { page: 1, total_page: 1 },
        } as T;
      }
      return {
        list: [
          {
            campaign_id: "campaign-match",
            campaign_name: "[bb26-rianbrazil] Lowercase code",
          },
          {
            campaign_id: "campaign-other",
            campaign_name: "[OTHER-EVENT] Retargeting",
          },
        ],
      } as T;
    };

    const rows = await fetchTikTokEventCampaignInsights(baseInput(request));

    assert.deepEqual(
      rows.map((row) => row.id),
      ["campaign-match"],
    );
    assert.equal(rows[0]?.name, "[bb26-rianbrazil] Lowercase code");
  });

  it("keeps aggregated rows as '(unnamed)' when enrichment returns no campaigns", async () => {
    const request: MockRequest = async <T>(path: string): Promise<T> => {
      if (path === "/report/integrated/get/") {
        return {
          list: [
            {
              dimensions: { campaign_id: "campaign-1", stat_time_day: "2026-04-10" },
              metrics: { spend: "10", impressions: "100", clicks: "10" },
            },
          ],
          page_info: { page: 1, total_page: 1 },
        } as T;
      }
      return { list: [] } as T;
    };

    const rows = await fetchTikTokEventCampaignInsights(baseInput(request));

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, "campaign-1");
    assert.equal(rows[0]?.name, "(unnamed)");
  });
});
