import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  runTikTokRollupLeg,
  type RunTikTokRollupLegInput,
  type TikTokRollupDeps,
} from "../tiktok-rollup-leg.ts";
import {
  runGoogleAdsRollupLeg,
  type GoogleAdsRollupDeps,
  type RunGoogleAdsRollupLegInput,
} from "../google-ads-rollup-leg.ts";
import { shouldInvokeVenueAllocator } from "../venue-allocator-trigger.ts";
import { isSuspiciousTicketingZeroFetch } from "../ticketing-zero-fetch-guard.ts";
import { TikTokApiError } from "../../tiktok/client.ts";
import type { TikTokDailyInsightRow } from "../../tiktok/rollup-insights.ts";
import type { GoogleAdsCredentials } from "../../google-ads/credentials.ts";
import type { GoogleAdsDailyInsightRow } from "../../google-ads/rollup-insights.ts";

function fakeSupabase(options?: {
  tiktokAdvertiserId?: string | null;
  googleCustomerId?: string | null;
}): SupabaseClient {
  const tiktokAdvertiserId = options?.tiktokAdvertiserId ?? "advertiser-1";
  const googleCustomerId = options?.googleCustomerId ?? "333-703-8088";
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
      if (table === "google_ads_accounts") {
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
                            googleCustomerId === null
                              ? null
                              : {
                                  id: "gads-account-1",
                                  google_customer_id: googleCustomerId,
                                  login_customer_id: "999-999-9999",
                                },
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

function googleInput(overrides: {
  googleAdsAccountId?: string | null;
  fetchDailyInsights?: () => Promise<GoogleAdsDailyInsightRow[]>;
  getCredentials?: () => Promise<GoogleAdsCredentials | null>;
} = {}): { input: RunGoogleAdsRollupLegInput; upserted: GoogleAdsDailyInsightRow[][] } {
  const upserted: GoogleAdsDailyInsightRow[][] = [];
  const deps: GoogleAdsRollupDeps = {
    getCredentials: async () =>
      overrides.getCredentials
        ? overrides.getCredentials()
        : {
            access_token: "access-token",
            refresh_token: "refresh-token",
            customer_id: "333-703-8088",
            login_customer_id: "999-999-9999",
          },
    fetchDailyInsights: async () =>
      overrides.fetchDailyInsights ? overrides.fetchDailyInsights() : [],
    upsertRollups: async (_supabase, args) => {
      upserted.push(args.rows);
      return { upserted: args.rows.length, skipped_noop: 0 };
    },
  };
  return {
    upserted,
    input: {
      supabase: fakeSupabase(),
      eventId: "event-1",
      userId: "user-1",
      eventCode: "BB26-KAYODE",
      googleAdsAccountId:
        "googleAdsAccountId" in overrides
          ? (overrides.googleAdsAccountId ?? null)
          : "gads-account-1",
      since: "2026-04-28",
      until: "2026-04-30",
      deps,
    },
  };
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
      return { upserted: args.rows.length, skipped_noop: 0 };
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
        tiktok_reach: 120000,
        tiktok_clicks: 612,
        tiktok_video_views: 12000,
        tiktok_video_views_2s: 85000,
        tiktok_video_views_6s: 64000,
        tiktok_video_views_100p: 12000,
        tiktok_avg_play_time_ms: 4200,
        tiktok_post_engagement: 9000,
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
    assert.equal(payloadKeys.includes("tiktok_reach"), true);
    assert.equal(payloadKeys.includes("tiktok_video_views_2s"), true);
    assert.equal(payloadKeys.includes("tiktok_video_views_6s"), true);
    assert.equal(payloadKeys.includes("tiktok_video_views_100p"), true);
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

describe("runRollupSyncForEvent Google Ads leg", () => {
  it("skips Google Ads when event and client have no google_ads_account_id", async () => {
    const { input, upserted } = googleInput({ googleAdsAccountId: null });

    const result = await runGoogleAdsRollupLeg(input);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "no_google_ads_account");
    assert.equal(upserted.length, 0);
  });

  it("zero-pads the full sync window before upsert", async () => {
    const rows: GoogleAdsDailyInsightRow[] = [
      {
        date: "2026-04-29",
        google_ads_spend: 42.5,
        google_ads_impressions: 1000,
        google_ads_clicks: 25,
        google_ads_conversions: 3,
        google_ads_video_views: 600,
      },
    ];
    const { input, upserted } = googleInput({
      fetchDailyInsights: async () => rows,
    });

    const result = await runGoogleAdsRollupLeg(input);

    assert.equal(result.ok, true);
    assert.equal(result.rowsWritten, 3);
    assert.equal(upserted.length, 1);
    assert.deepEqual(
      upserted[0]?.map((row) => ({
        date: row.date,
        spend: row.google_ads_spend,
        impressions: row.google_ads_impressions,
      })),
      [
        { date: "2026-04-28", spend: 0, impressions: 0 },
        { date: "2026-04-29", spend: 42.5, impressions: 1000 },
        { date: "2026-04-30", spend: 0, impressions: 0 },
      ],
    );
  });

  it("writes zero rows for connected events with no matching campaigns", async () => {
    const { input, upserted } = googleInput({
      fetchDailyInsights: async () => [],
    });

    const result = await runGoogleAdsRollupLeg(input);

    assert.equal(result.ok, true);
    assert.equal(result.rowsWritten, 3);
    assert.deepEqual(
      upserted[0]?.map((row) => row.google_ads_spend),
      [0, 0, 0],
    );
  });
});

describe("shouldInvokeVenueAllocator", () => {
  it("allows null-date venue groups when Meta scope is otherwise complete", () => {
    assert.equal(
      shouldInvokeVenueAllocator({
        metaOk: true,
        eventCode: "WC26-MANCHESTER",
        adAccountId: "act_123",
        clientId: "client-1",
      }),
      true,
    );
  });

  it("still skips when Meta did not run or required scope is missing", () => {
    assert.equal(
      shouldInvokeVenueAllocator({
        metaOk: false,
        eventCode: "WC26-MANCHESTER",
        adAccountId: "act_123",
        clientId: "client-1",
      }),
      false,
    );
    assert.equal(
      shouldInvokeVenueAllocator({
        metaOk: true,
        eventCode: null,
        adAccountId: "act_123",
        clientId: "client-1",
      }),
      false,
    );
    assert.equal(
      shouldInvokeVenueAllocator({
        metaOk: true,
        eventCode: "WC26-MANCHESTER",
        adAccountId: null,
        clientId: "client-1",
      }),
      false,
    );
    assert.equal(
      shouldInvokeVenueAllocator({
        metaOk: true,
        eventCode: "WC26-MANCHESTER",
        adAccountId: "act_123",
        clientId: null,
      }),
      false,
    );
  });
});

// ── Bug #1: today-zeros guard ─────────────────────────────────────────────
//
// The 4theFans / foursomething provider returns a cumulative lifetime total.
// A lifetime total of 0 when a previous snapshot already recorded > 0 is
// physically impossible — it means the API returned bad data (rate-limit,
// empty body, outage).  The guard must detect this and skip the row write
// so today's rollup is not corrupted with false zeros.
describe("isSuspiciousTicketingZeroFetch", () => {
  it("flags a zero lifetime total when previous snapshot was positive", () => {
    // Core regression: cron returned 0 but yesterday had 100 cumulative → skip
    assert.equal(isSuspiciousTicketingZeroFetch(0, 100), true);
    assert.equal(isSuspiciousTicketingZeroFetch(0, 1), true);
  });

  it("does not flag a zero when there is no previous snapshot (genuine first sync)", () => {
    assert.equal(isSuspiciousTicketingZeroFetch(0, null), false);
  });

  it("does not flag a zero when previous was also zero (no tickets sold yet)", () => {
    assert.equal(isSuspiciousTicketingZeroFetch(0, 0), false);
  });

  it("does not flag positive totals regardless of previous", () => {
    assert.equal(isSuspiciousTicketingZeroFetch(5, 3), false);
    assert.equal(isSuspiciousTicketingZeroFetch(100, null), false);
    assert.equal(isSuspiciousTicketingZeroFetch(242, 238), false);
  });
});
