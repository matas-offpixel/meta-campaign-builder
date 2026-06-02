import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchTikTokDailyRollupInsights,
  type FetchTikTokDailyRollupInsightsInput,
} from "../rollup-insights.ts";

type Request = NonNullable<FetchTikTokDailyRollupInsightsInput["request"]>;

function campaignRow(
  id: string,
  name: string,
  goal: string,
): object {
  return { campaign_id: id, campaign_name: name, optimization_goal: goal };
}

function reportRow(
  campaignId: string,
  day: string,
  metrics: Record<string, string>,
): object {
  return {
    dimensions: {
      campaign_id: campaignId,
      stat_time_day: `${day} 00:00:00`,
    },
    metrics,
  };
}

describe("fetchTikTokDailyRollupInsights — tiktok_results mapping", () => {
  it("VIEW_CONTENT: sums conversion to tiktok_results and view_content to tiktok_engagement_results", async () => {
    const request: Request = async <T,>(path: string): Promise<T> => {
      if (path === "/campaign/get/") {
        return {
          list: [
            campaignRow("c1", "[IRWOHD] VENUE SIGNUP", "VIEW_CONTENT"),
            campaignRow("c2", "[IRWOHD] VENUE SIGNUP (boosted)", "VIEW_CONTENT"),
            campaignRow("c3", "[IRWOHD] VENUE ENGAGEMENT", "VIEW_CONTENT"),
          ],
        } as T;
      }
      return {
        list: [
          reportRow("c1", "2026-05-01", {
            spend: "1.91",
            impressions: "1000",
            conversion: "108",
            view_content: "278105",
          }),
          reportRow("c2", "2026-05-01", {
            spend: "1.54",
            impressions: "800",
            conversion: "65",
            view_content: "208311",
          }),
          reportRow("c3", "2026-05-01", {
            spend: "56.02",
            impressions: "500",
            conversion: "0",
            view_content: "2452",
          }),
        ],
        page_info: { page: 1, total_page: 1 },
      } as T;
    };

    const rows = await fetchTikTokDailyRollupInsights({
      advertiserId: "advertiser-1",
      token: "token-1",
      eventCode: "IRWOHD",
      since: "2026-05-01",
      until: "2026-05-01",
      request,
    });

    assert.equal(rows.length, 1);
    const day = rows[0]!;
    assert.equal(day.tiktok_results, 173, "108 + 65 + 0 conversions");
    assert.equal(day.tiktok_engagement_results, 488_868, "view_content sum");
  });

  it("COMPLETE_REGISTRATION: writes complete_registration to tiktok_results only", async () => {
    const request: Request = async <T,>(path: string): Promise<T> => {
      if (path === "/campaign/get/") {
        return {
          list: [
            campaignRow("c1", "[IRWOHD] SIGNUP A", "COMPLETE_REGISTRATION"),
            campaignRow("c2", "[IRWOHD] SIGNUP B", "COMPLETE_REGISTRATION"),
            campaignRow("c3", "[IRWOHD] SIGNUP C", "COMPLETE_REGISTRATION"),
          ],
        } as T;
      }
      return {
        list: [
          reportRow("c1", "2026-05-01", {
            spend: "10",
            impressions: "100",
            complete_registration: "108",
            view_content: "1000",
          }),
          reportRow("c2", "2026-05-01", {
            spend: "10",
            impressions: "100",
            complete_registration: "65",
            view_content: "800",
          }),
          reportRow("c3", "2026-05-01", {
            spend: "10",
            impressions: "100",
            complete_registration: "0",
            view_content: "50",
          }),
        ],
        page_info: { page: 1, total_page: 1 },
      } as T;
    };

    const rows = await fetchTikTokDailyRollupInsights({
      advertiserId: "advertiser-1",
      token: "token-1",
      eventCode: "IRWOHD",
      since: "2026-05-01",
      until: "2026-05-01",
      request,
    });

    assert.equal(rows[0]!.tiktok_results, 173);
    assert.equal(rows[0]!.tiktok_engagement_results, 0);
  });
});
