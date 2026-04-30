import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { fetchGoogleAdsEventCampaignInsights, fetchGoogleAdsShareExtras } from "../insights.ts";
import { fetchGoogleAdsDailyRollupInsights } from "../rollup-insights.ts";

function fakeClient(rows: unknown[]) {
  return {
    async query<T>(): Promise<T> {
      return rows as T;
    },
  };
}

describe("fetchGoogleAdsEventCampaignInsights", () => {
  it("builds GAQL with unquoted enum values and YYYY-MM-DD dates", async () => {
    let gaql = "";
    await fetchGoogleAdsEventCampaignInsights({
      customerId: "288-501-5945",
      refreshToken: "refresh-token",
      eventCode: "BB26-KAYODE",
      window: { since: "2026-04-01", until: "2026-04-30" },
      client: {
        async query<T>(_credentials: unknown, query: string): Promise<T> {
          gaql = query;
          return [] as T;
        },
      },
    });

    assert.match(gaql, /segments\.date BETWEEN '2026-04-01' AND '2026-04-30'/);
    assert.match(gaql, /campaign\.advertising_channel_type IN \(SEARCH, VIDEO\)/);
    assert.match(gaql, /metrics\.engagements/);
    assert.match(gaql, /metrics\.video_quartile_p100_rate/);
    assert.doesNotMatch(gaql, /metrics\.video_views/);
    assert.doesNotMatch(gaql, /'SEARCH'|'VIDEO'/);
  });

  it("rejects non-YYYY-MM-DD date windows before issuing GAQL", async () => {
    await assert.rejects(
      fetchGoogleAdsEventCampaignInsights({
        customerId: "288-501-5945",
        refreshToken: "refresh-token",
        eventCode: "BB26-KAYODE",
        window: { since: "2026-04-01T00:00:00Z", until: "2026-04-30" },
        client: fakeClient([]),
      }),
      /window\.since must be YYYY-MM-DD/,
    );
  });

  it("returns a matching SEARCH campaign with no cost_per_view", async () => {
    const rows = await fetchGoogleAdsEventCampaignInsights({
      customerId: "333-703-8088",
      refreshToken: "refresh-token",
      eventCode: "BB26-RIANBRAZIL",
      window: { since: "2026-04-01", until: "2026-04-30" },
      client: fakeClient([
        {
          campaign: {
            id: "1",
            name: "Search - bb26-rianbrazil - Brand",
            status: "ENABLED",
            advertising_channel_type: "SEARCH",
          },
          metrics: {
            cost_micros: "125000000",
            impressions: "10000",
            clicks: "500",
            conversions: "25",
            engagements: "0",
          },
        },
      ]),
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].spend, 125);
    assert.equal(rows[0].cost_per_view, null);
    assert.equal(rows[0].campaign_type, "SEARCH");
  });

  it("returns a matching VIDEO campaign with engagement-backed cost_per_view", async () => {
    const rows = await fetchGoogleAdsEventCampaignInsights({
      customerId: "333-703-8088",
      refreshToken: "refresh-token",
      eventCode: "BB26-RIANBRAZIL",
      window: { since: "2026-04-01", until: "2026-04-30" },
      client: fakeClient([
        {
          campaign: {
            id: "2",
            name: "YouTube - BB26-RIANBRAZIL - Prospecting",
            status: "ENABLED",
            advertising_channel_type: "VIDEO",
            advertising_channel_sub_type: "VIDEO_ACTION",
          },
          metrics: {
            cost_micros: "60000000",
            impressions: "20000",
            clicks: "300",
            conversions: "0",
            engagements: "1200",
            video_quartile_p25_rate: "0.75",
            video_quartile_p50_rate: "0.50",
            video_quartile_p75_rate: "0.25",
            video_quartile_p100_rate: "0.10",
          },
        },
      ]),
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].video_views, 1200);
    assert.equal(rows[0].cost_per_view, 0.05);
    assert.equal(rows[0].campaign_type, "VIDEO:VIDEO_ACTION");
    assert.equal(rows[0].video_quartile_p100_rate, 0.1);
  });

  it("filters out campaigns that do not match event_code", async () => {
    const rows = await fetchGoogleAdsEventCampaignInsights({
      customerId: "333-703-8088",
      refreshToken: "refresh-token",
      eventCode: "BB26-RIANBRAZIL",
      window: { since: "2026-04-01", until: "2026-04-30" },
      client: fakeClient([
        {
          campaign: {
            id: "3",
            name: "Search - OTHER - Brand",
            status: "ENABLED",
            advertising_channel_type: "SEARCH",
          },
          metrics: {
            cost_micros: "1000000",
            impressions: "100",
            clicks: "1",
          },
        },
      ]),
    });

    assert.deepEqual(rows, []);
  });
});

describe("fetchGoogleAdsDailyRollupInsights", () => {
  it("builds a segments.date GAQL query and derives video views from p25 rate", async () => {
    let gaql = "";
    const rows = await fetchGoogleAdsDailyRollupInsights({
      customerId: "333-703-8088",
      refreshToken: "refresh-token",
      eventCode: "BB26-KAYODE",
      since: "2026-04-23",
      until: "2026-04-30",
      client: {
        async query<T>(_credentials: unknown, query: string): Promise<T> {
          gaql = query;
          return [
            {
              campaign: { id: "1", name: "YouTube - BB26-KAYODE - Awareness" },
              segments: { date: "2026-04-30" },
              metrics: {
                cost_micros: "15000000",
                impressions: "100000",
                clicks: "200",
                conversions: "0",
                engagements: "12000",
                video_quartile_p25_rate: "0.64",
              },
            },
          ] as T;
        },
      },
    });

    assert.match(gaql, /segments\.date/);
    assert.match(gaql, /metrics\.video_quartile_p25_rate/);
    assert.deepEqual(rows, [
      {
        date: "2026-04-30",
        google_ads_spend: 15,
        google_ads_impressions: 100000,
        google_ads_clicks: 200,
        google_ads_conversions: 0,
        google_ads_video_views: 64000,
      },
    ]);
  });
});

describe("fetchGoogleAdsShareExtras", () => {
  it("queries Top Regions via geographic_view segments.geo_target_country", async () => {
    const queries: string[] = [];
    const extras = await fetchGoogleAdsShareExtras({
      customerId: "288-501-5945",
      refreshToken: "refresh-token",
      loginCustomerId: "333-703-8088",
      eventCode: "BB26-KAYODE",
      window: { since: "2026-04-23", until: "2026-04-30" },
      campaignIds: ["1234567890"],
      client: {
        async query<T>(_credentials: unknown, query: string): Promise<T> {
          queries.push(query);
          if (query.includes("FROM geographic_view")) {
            return [
              {
                segments: { geo_target_country: "geoTargetConstants/2566" },
                metrics: { cost_micros: "10000000", impressions: "398839", clicks: "100" },
              },
              {
                segments: { geo_target_country: "geoTargetConstants/2826" },
                metrics: { cost_micros: "1000000", impressions: "5247", clicks: "10" },
              },
            ] as T;
          }
          return [] as T;
        },
      },
    });

    const geoQuery = queries.find((query) => query.includes("FROM geographic_view")) ?? "";
    assert.match(geoQuery, /segments\.geo_target_country/);
    assert.match(geoQuery, /campaign\.id IN \(1234567890\)/);
    assert.deepEqual(
      extras.demographics.regions.map((row) => ({
        label: row.label,
        impressions: row.impressions,
      })),
      [
        { label: "Nigeria", impressions: 398839 },
        { label: "United Kingdom", impressions: 5247 },
      ],
    );
  });
});
