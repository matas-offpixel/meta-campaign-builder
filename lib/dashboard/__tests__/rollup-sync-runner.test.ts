import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  runTikTokRollupLeg,
  type RunTikTokRollupLegInput,
  type TikTokRollupDeps,
} from "../tiktok-rollup-leg.ts";
import { TikTokApiError } from "../../tiktok/client.ts";
import type { TikTokDailyInsightRow } from "../../tiktok/rollup-insights.ts";

function fakeSupabase(options?: {
  tiktokAdvertiserId?: string | null;
}): SupabaseClient {
  const tiktokAdvertiserId = options?.tiktokAdvertiserId ?? "advertiser-1";
  return {
    from(table: string) {
      if (table === "event_ticketing_links") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      }
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
                          data:
                            tiktokAdvertiserId === null
                              ? null
                              : { id: "tt-account-1", tiktok_advertiser_id: tiktokAdvertiserId },
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
      if (table === "event_daily_rollups") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      maybeSingle() {
                        return Promise.resolve({ data: null, error: null });
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

function baseInput(overrides: {
  eventTikTokAccountId?: string | null;
  clientTikTokAccountId?: string | null;
  fetchDailyInsights?: () => Promise<TikTokDailyInsightRow[]>;
  getCredentials?: () => Promise<{ access_token: string; advertiser_ids: string[] } | null>;
} = {}): { input: RunTikTokRollupLegInput; upserted: TikTokDailyInsightRow[][] } {
  const upserted: TikTokDailyInsightRow[][] = [];
  const deps: TikTokRollupDeps = {
    getCredentials: async () =>
      overrides.getCredentials
        ? overrides.getCredentials()
        : { access_token: "token-1", advertiser_ids: ["advertiser-1"] },
    fetchDailyInsights: async () =>
      overrides.fetchDailyInsights ? overrides.fetchDailyInsights() : [],
    upsertRollups: async (_supabase, args) => {
      upserted.push(args.rows);
    },
    sleep: async () => undefined,
  };
  return {
    upserted,
    input: {
      supabase: fakeSupabase(),
      eventId: "event-1",
      userId: "user-1",
      eventCode: "BB26-RIANBRAZIL",
      tiktokAccountId:
        overrides.eventTikTokAccountId ?? overrides.clientTikTokAccountId ?? null,
      since: "2026-03-01",
      until: "2026-04-28",
      retryDelayMs: 0,
      deps,
    },
  };
}

describe("runRollupSyncForEvent TikTok leg", () => {
  it("skips TikTok when event and client have no tiktok_account_id", async () => {
    const { input, upserted } = baseInput({
      eventTikTokAccountId: null,
      clientTikTokAccountId: null,
    });

    const result = await runTikTokRollupLeg(input);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "no_tiktok_account");
    assert.equal(upserted.length, 0);
  });

  it("does not upsert when valid credentials return no TikTok rows", async () => {
    const { input, upserted } = baseInput({
      eventTikTokAccountId: "tt-account-1",
      fetchDailyInsights: async () => [],
    });

    const result = await runTikTokRollupLeg(input);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "no_rows");
    assert.equal(upserted.length, 0);
  });

  it("writes only tiktok_* rollup rows when valid data returns", async () => {
    const rows: TikTokDailyInsightRow[] = [
      {
        date: "2026-04-27",
        tiktok_spend: 160,
        tiktok_impressions: 179459,
        tiktok_clicks: 612,
        tiktok_video_views: 12000,
        tiktok_results: 9000,
      },
    ];
    const { input, upserted } = baseInput({
      eventTikTokAccountId: "tt-account-1",
      fetchDailyInsights: async () => rows,
    });

    const result = await runTikTokRollupLeg(input);

    assert.equal(result.ok, true);
    assert.equal(result.rowsWritten, 1);
    assert.deepEqual(upserted, [rows]);
    const payloadKeys = Object.keys(upserted[0]?.[0] ?? {});
    assert.equal(payloadKeys.includes("ad_spend"), false);
    assert.equal(payloadKeys.includes("link_clicks"), false);
    assert.equal(payloadKeys.includes("meta_regs"), false);
  });

  it("retries TikTok 50001 once, then fails soft if still rate-limited", async () => {
    let calls = 0;
    const { input, upserted } = baseInput({
      eventTikTokAccountId: "tt-account-1",
      fetchDailyInsights: async () => {
        calls += 1;
        throw new TikTokApiError("rate limited", 50001, "req-1", 200);
      },
    });

    const result = await runTikTokRollupLeg(input);

    assert.equal(calls, 2);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "tiktok_failed");
    assert.equal(upserted.length, 0);
  });

  it("logs and skips when get_tiktok_credentials returns null", async () => {
    const { input, upserted } = baseInput({
      eventTikTokAccountId: "tt-account-1",
      getCredentials: async () => null,
    });

    const result = await runTikTokRollupLeg(input);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "no_credentials");
    assert.equal(upserted.length, 0);
  });
});
