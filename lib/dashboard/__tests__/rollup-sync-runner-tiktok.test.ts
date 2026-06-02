import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  runTikTokRollupLeg,
  type RunTikTokRollupLegInput,
  type TikTokRollupDeps,
} from "../tiktok-rollup-leg.ts";
import {
  fetchTikTokDailyRollupInsights,
  type TikTokDailyInsightRow,
} from "../../tiktok/rollup-insights.ts";

function fakeSupabase(): SupabaseClient {
  return {
    from(table: string) {
      if (table === "tiktok_accounts") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      maybeSingle() {
                        return Promise.resolve({
                          data: { id: "tt-1", tiktok_advertiser_id: "advertiser-1" },
                          error: null,
                        });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe("runTikTokRollupLeg — VIEW_CONTENT dual metrics upsert", () => {
  it("writes tiktok_results=173 and tiktok_engagement_results=488868 for Ironworks shape", async () => {
    const upserted: TikTokDailyInsightRow[][] = [];
    const deps: TikTokRollupDeps = {
      getCredentials: async () => ({ access_token: "token-1", advertiser_ids: ["advertiser-1"] }),
      fetchDailyInsights: (args) =>
        fetchTikTokDailyRollupInsights({
          ...args,
          request: async (path) => {
            if (path === "/campaign/get/") {
              return {
                list: [
                  {
                    campaign_id: "c1",
                    campaign_name: "[IRWOHD] VENUE SIGNUP",
                    optimization_goal: "VIEW_CONTENT",
                  },
                  {
                    campaign_id: "c2",
                    campaign_name: "[IRWOHD] VENUE SIGNUP (boosted)",
                    optimization_goal: "VIEW_CONTENT",
                  },
                  {
                    campaign_id: "c3",
                    campaign_name: "[IRWOHD] VENUE ENGAGEMENT",
                    optimization_goal: "VIEW_CONTENT",
                  },
                ],
              } as never;
            }
            return {
              list: [
                {
                  dimensions: {
                    campaign_id: "c1",
                    stat_time_day: "2026-05-01 00:00:00",
                  },
                  metrics: {
                    spend: "1.91",
                    impressions: "1000",
                    conversion: "108",
                    view_content: "278105",
                  },
                },
                {
                  dimensions: {
                    campaign_id: "c2",
                    stat_time_day: "2026-05-01 00:00:00",
                  },
                  metrics: {
                    spend: "1.54",
                    impressions: "800",
                    conversion: "65",
                    view_content: "208311",
                  },
                },
                {
                  dimensions: {
                    campaign_id: "c3",
                    stat_time_day: "2026-05-01 00:00:00",
                  },
                  metrics: {
                    spend: "56.02",
                    impressions: "500",
                    conversion: "0",
                    view_content: "2452",
                  },
                },
              ],
              page_info: { page: 1, total_page: 1 },
            } as never;
          },
        }),
      upsertRollups: async (_supabase, args) => {
        upserted.push(args.rows);
        return { upserted: args.rows.length, skipped_noop: 0 };
      },
      sleep: async () => undefined,
    };

    const input: RunTikTokRollupLegInput = {
      supabase: fakeSupabase(),
      eventId: "68535c85-0394-435f-9439-245dd2e87043",
      userId: "user-1",
      eventCode: "IRWOHD",
      tiktokAccountId: "tt-1",
      since: "2026-05-01",
      until: "2026-05-01",
      retryDelayMs: 0,
      deps,
    };

    const result = await runTikTokRollupLeg(input);

    assert.equal(result.ok, true);
    assert.equal(upserted.length, 1);
    const row = upserted[0]![0]!;
    assert.equal(row.tiktok_results, 173);
    assert.equal(row.tiktok_engagement_results, 488_868);
  });
});
