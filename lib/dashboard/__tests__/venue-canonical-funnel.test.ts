/**
 * lib/dashboard/__tests__/venue-canonical-funnel.test.ts
 *
 * Unit tests for the venue-scope canonical funnel-pacing helper
 * (PR-B of issue #467). Pins the Edinburgh acceptance criteria the
 * user spec'd:
 *
 *   - Canonical tickets: 3,498 / capacity 5,475
 *   - Lifetime cache: reach 733,878 / clicks 105,563 / LPV 53,758
 *   - Reach: 733,878 / 1,564,286 → reach→click 14.4% ≥ 14% → ON TRACK
 *   - Clicks: 105,563 / 219,000 → click→LPV 50.9% ≥ 50% → ON TRACK
 *   - LPV: 53,758 / 109,500 → LPV→ticket 6.5% ≥ 5% → ON TRACK
 *   - Purchases: 3,498 / 5,475 = 64% → ON TRACK (no underPacing flag
 *     when backward-read inputs are absent)
 *
 * Also pins:
 *   - cache_miss → reach/clicks/lpv are null, sources flag cache_miss
 *   - sliding scale arithmetic at benchmark and live conversion
 *   - backward read: requiredPace + achievedPace + underPacing flag
 *   - spend SUM prefers allocator output, adds presale on top
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildVenueCanonicalFunnel,
  FUNNEL_BENCHMARKS,
} from "../venue-canonical-funnel.ts";
import type { EventCodeLifetimeMetaCacheRow } from "../../db/event-code-lifetime-meta-cache.ts";
import type { DailyRollupRow } from "../../db/client-portal-server.ts";

function makeCacheRow(
  overrides: Partial<EventCodeLifetimeMetaCacheRow> = {},
): EventCodeLifetimeMetaCacheRow {
  return {
    client_id: "client-1",
    event_code: "WC26-EDINBURGH",
    meta_reach: null,
    meta_impressions: null,
    meta_link_clicks: null,
    meta_landing_page_views: null,
    meta_regs: null,
    meta_video_plays_3s: null,
    meta_video_plays_15s: null,
    meta_video_plays_p100: null,
    meta_engagements: null,
    campaign_names: [],
    fetched_at: "2026-05-28T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-05-28T00:00:00Z",
    ...overrides,
  };
}

function makeRollupRow(
  overrides: Partial<DailyRollupRow> = {},
): DailyRollupRow {
  return {
    event_id: "ev-1",
    date: "2026-05-01",
    tickets_sold: 0,
    ad_spend: null,
    tiktok_spend: null,
    google_ads_spend: null,
    ad_spend_allocated: null,
    revenue: null,
    link_clicks: null,
    ...overrides,
  } as DailyRollupRow;
}

describe("buildVenueCanonicalFunnel — Edinburgh acceptance", () => {
  const edinburghCache = makeCacheRow({
    meta_reach: 733_878,
    meta_link_clicks: 105_563,
    meta_landing_page_views: 53_758,
  });

  it("renders the four canonical metrics from the lifetime cache + tickets SUM", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 5_475,
      ticketsSold: 3_498,
      lifetimeCacheRow: edinburghCache,
      dailyRollups: [],
      eventDate: null,
    });

    assert.equal(result.metrics.reach, 733_878);
    assert.equal(result.metrics.clicks, 105_563);
    assert.equal(result.metrics.landingPageViews, 53_758);
    assert.equal(result.metrics.purchases, 3_498);
    assert.equal(result.metrics.capacity, 5_475);
  });

  it("computes capacity-derived targets at 286 / 40 / 20 / 1", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 5_475,
      ticketsSold: 3_498,
      lifetimeCacheRow: edinburghCache,
      dailyRollups: [],
      eventDate: null,
    });

    const [reachStage, clicksStage, lpvStage, purchasesStage] = result.stages;
    assert.equal(reachStage.target, 1_564_286);
    assert.equal(clicksStage.target, 219_000);
    assert.equal(lpvStage.target, 109_500);
    assert.equal(purchasesStage.target, 5_475);
  });

  it("flags all four bars ON TRACK when conversion rates beat benchmarks", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 5_475,
      ticketsSold: 3_498,
      lifetimeCacheRow: edinburghCache,
      dailyRollups: [],
      eventDate: null,
    });

    const [reachStage, clicksStage, lpvStage, purchasesStage] = result.stages;
    // 105_563 / 733_878 ≈ 14.39%, benchmark 14%
    assert.equal(reachStage.status, "on_track");
    assert.ok(
      reachStage.conversionRate != null &&
        reachStage.conversionRate >= FUNNEL_BENCHMARKS.reachToClick,
    );
    // 53_758 / 105_563 ≈ 50.92%, benchmark 50%
    assert.equal(clicksStage.status, "on_track");
    assert.ok(
      clicksStage.conversionRate != null &&
        clicksStage.conversionRate >= FUNNEL_BENCHMARKS.clickToLpv,
    );
    // 3_498 / 53_758 ≈ 6.51%, benchmark 5%
    assert.equal(lpvStage.status, "on_track");
    assert.ok(
      lpvStage.conversionRate != null &&
        lpvStage.conversionRate >= FUNNEL_BENCHMARKS.lpvToTicket,
    );
    // Purchases: no underPacing flag because no event_date supplied
    // (backward-read defaults to ON_TRACK in that case).
    assert.equal(purchasesStage.status, "on_track");
  });

  it("provenance flags each metric's source", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 5_475,
      ticketsSold: 3_498,
      lifetimeCacheRow: edinburghCache,
      dailyRollups: [makeRollupRow({ ad_spend: 100 })],
      eventDate: null,
    });

    assert.equal(result.sources.reach, "lifetime_cache");
    assert.equal(result.sources.clicks, "lifetime_cache");
    assert.equal(result.sources.landingPageViews, "lifetime_cache");
    assert.equal(result.sources.purchases, "tier_channel_sales");
    assert.equal(result.sources.spend, "rollups");
  });
});

describe("buildVenueCanonicalFunnel — sliding scale", () => {
  it("renders both benchmark and live CPT arithmetic", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 5_475,
      ticketsSold: 3_498,
      lifetimeCacheRow: makeCacheRow({
        meta_reach: 733_878,
        meta_link_clicks: 105_563,
        meta_landing_page_views: 53_758,
      }),
      // £17_490 spend ⇒ £5.00 CPT
      dailyRollups: [
        makeRollupRow({ ad_spend: 17_490, tickets_sold: 0 }),
      ],
      eventDate: null,
    });

    assert.equal(result.slidingScale.extraTicketsToCapacity, 1_977);
    assert.equal(
      result.slidingScale.benchmarkCostPerTicket,
      FUNNEL_BENCHMARKS.benchmarkCostPerTicket,
    );
    assert.equal(result.slidingScale.liveCostPerTicket, 17_490 / 3_498);
    assert.equal(
      result.slidingScale.additionalSpendAtBenchmark,
      1_977 * FUNNEL_BENCHMARKS.benchmarkCostPerTicket,
    );
    assert.equal(
      result.slidingScale.additionalSpendAtLiveConversion,
      1_977 * (17_490 / 3_498),
    );
  });

  it("null live CPT when no spend yet", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 5_475,
      ticketsSold: 3_498,
      lifetimeCacheRow: makeCacheRow({ meta_reach: 100 }),
      dailyRollups: [],
      eventDate: null,
    });
    assert.equal(result.slidingScale.liveCostPerTicket, null);
    assert.equal(
      result.slidingScale.additionalSpendAtLiveConversion,
      null,
    );
  });

  it("zero extra tickets when sold ≥ capacity", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 5_000,
      ticketsSold: 5_000,
      lifetimeCacheRow: null,
      dailyRollups: [],
      eventDate: null,
    });
    assert.equal(result.slidingScale.extraTicketsToCapacity, 0);
    assert.equal(result.slidingScale.additionalSpendAtBenchmark, 0);
  });
});

describe("buildVenueCanonicalFunnel — backward read", () => {
  it("computes days_to_event + required_pace + achieved_pace from rollups", () => {
    const today = new Date("2026-05-28T00:00:00Z");
    // Edinburgh event date 30 days away. Need 1977 / 30 ≈ 65.9 / day.
    // Recent 14d rollups: 14 days × 70 tickets/day = 980 tickets ⇒
    // achieved pace = 70 / day. 70 ≥ 0.8 × 65.9 (52.7) ⇒ NOT under-pacing.
    const rollups: DailyRollupRow[] = [];
    for (let d = 1; d <= 14; d += 1) {
      const date = new Date("2026-05-28T00:00:00Z");
      date.setUTCDate(date.getUTCDate() - d);
      rollups.push(
        makeRollupRow({
          date: date.toISOString().slice(0, 10),
          tickets_sold: 70,
        }),
      );
    }

    const result = buildVenueCanonicalFunnel({
      capacity: 5_475,
      ticketsSold: 3_498,
      lifetimeCacheRow: null,
      dailyRollups: rollups,
      eventDate: "2026-06-27",
      today,
    });

    assert.equal(result.backwardRead.daysToEvent, 30);
    assert.equal(result.backwardRead.ticketsRemaining, 1_977);
    assert.equal(
      Math.round((result.backwardRead.requiredDailyPace ?? 0) * 100) / 100,
      Math.round((1_977 / 30) * 100) / 100,
    );
    assert.equal(result.backwardRead.achievedDailyPace, 70);
    assert.equal(result.backwardRead.underPacing, false);
  });

  it("flags underPacing as a separate banner; Purchases stage stays ON_TRACK", () => {
    // 1977 / 30 ≈ 65.9 required. Achieved 20/day ⇒ 20 < 0.8 × 65.9 = 52.7 ⇒ under.
    // The underPacing flag drives the BackwardReadCard banner, NOT
    // the Purchases bar status — the bar status reflects funnel
    // conversion (upstream gating), and Purchases is the terminal
    // stage with no downstream conversion rate to evaluate.
    const today = new Date("2026-05-28T00:00:00Z");
    const rollups: DailyRollupRow[] = [];
    for (let d = 1; d <= 14; d += 1) {
      const date = new Date("2026-05-28T00:00:00Z");
      date.setUTCDate(date.getUTCDate() - d);
      rollups.push(
        makeRollupRow({
          date: date.toISOString().slice(0, 10),
          tickets_sold: 20,
        }),
      );
    }

    const result = buildVenueCanonicalFunnel({
      capacity: 5_475,
      ticketsSold: 3_498,
      lifetimeCacheRow: null,
      dailyRollups: rollups,
      eventDate: "2026-06-27",
      today,
    });

    assert.equal(result.backwardRead.underPacing, true);
    const purchases = result.stages.find((s) => s.key === "purchases")!;
    assert.equal(purchases.status, "on_track");
  });

  it("defaults to ON_TRACK on purchases when no event_date / no rollups", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 5_475,
      ticketsSold: 3_498,
      lifetimeCacheRow: null,
      dailyRollups: [],
      eventDate: null,
    });

    assert.equal(result.backwardRead.daysToEvent, null);
    assert.equal(result.backwardRead.achievedDailyPace, null);
    assert.equal(result.backwardRead.underPacing, false);
    const purchases = result.stages.find((s) => s.key === "purchases")!;
    assert.equal(purchases.status, "on_track");
  });
});

describe("buildVenueCanonicalFunnel — cache miss + spend allocator", () => {
  it("flags cache_miss when lifetime cache row is null", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 5_475,
      ticketsSold: 3_498,
      lifetimeCacheRow: null,
      dailyRollups: [],
      eventDate: null,
    });

    assert.equal(result.metrics.reach, null);
    assert.equal(result.metrics.clicks, null);
    assert.equal(result.metrics.landingPageViews, null);
    assert.equal(result.sources.reach, "cache_miss");
    assert.equal(result.sources.clicks, "cache_miss");
    assert.equal(result.sources.landingPageViews, "cache_miss");

    // Status on reach/clicks/lpv flips to "unknown" without numerator.
    for (const stage of result.stages.slice(0, 3)) {
      assert.equal(stage.status, "unknown");
      assert.equal(stage.conversionRate, null);
    }
  });

  it("prefers allocator output over raw ad_spend and adds presale", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 5_000,
      ticketsSold: 0,
      lifetimeCacheRow: null,
      dailyRollups: [
        makeRollupRow({ ad_spend: 100, ad_spend_allocated: 50, ad_spend_presale: 10 }),
        makeRollupRow({ ad_spend: 200, ad_spend_allocated: null, ad_spend_presale: 0 }),
        makeRollupRow({ ad_spend: null, ad_spend_allocated: null, ad_spend_presale: 30 }),
      ],
      eventDate: null,
    });

    // (50+10) + (200+0) + (30) = 290
    assert.equal(result.metrics.spend, 290);
  });
});

describe("buildVenueCanonicalFunnel — OFF_TRACK scenarios", () => {
  it("reach OFF_TRACK when reach→click rate < benchmark", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 5_000,
      ticketsSold: 0,
      lifetimeCacheRow: makeCacheRow({
        meta_reach: 1_000_000,
        meta_link_clicks: 50_000, // 5% reach→click, below 14%
        meta_landing_page_views: 10_000,
      }),
      dailyRollups: [],
      eventDate: null,
    });
    const reach = result.stages.find((s) => s.key === "reach")!;
    assert.equal(reach.status, "off_track");
  });

  it("clicks OFF_TRACK when click→LPV rate < benchmark", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 5_000,
      ticketsSold: 0,
      lifetimeCacheRow: makeCacheRow({
        meta_reach: 1_000_000,
        meta_link_clicks: 200_000,
        meta_landing_page_views: 50_000, // 25%, below 50%
      }),
      dailyRollups: [],
      eventDate: null,
    });
    const clicks = result.stages.find((s) => s.key === "clicks")!;
    assert.equal(clicks.status, "off_track");
  });

  it("LPV OFF_TRACK when LPV→ticket rate < benchmark", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 5_000,
      ticketsSold: 100, // 100/100_000 = 0.1%, below 5%
      lifetimeCacheRow: makeCacheRow({
        meta_reach: 1_000_000,
        meta_link_clicks: 200_000,
        meta_landing_page_views: 100_000,
      }),
      dailyRollups: [],
      eventDate: null,
    });
    const lpv = result.stages.find((s) => s.key === "lpv")!;
    assert.equal(lpv.status, "off_track");
  });
});
