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
        makeRollupRow({ ad_spend_allocated: 17_490, tickets_sold: 0 }),
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

  it("sums ad_spend_allocated + ad_spend_presale only; ignores raw ad_spend (PR #475 source-of-truth)", () => {
    // Raw `ad_spend` is fanned ×fixture-count across sibling rows for the
    // same event_code, so it MUST NOT contribute to the venue SUM — same
    // contract Performance Summary uses (PR #474). On rows where the
    // allocator hasn't run (`ad_spend_allocated == null`), only the
    // `ad_spend_presale` portion (if any) contributes; the raw fan-out
    // is intentionally dropped.
    const result = buildVenueCanonicalFunnel({
      capacity: 5_000,
      ticketsSold: 0,
      lifetimeCacheRow: null,
      dailyRollups: [
        // allocator ran: 50 allocated + 10 presale = 60 (raw 100 ignored)
        makeRollupRow({ ad_spend: 100, ad_spend_allocated: 50, ad_spend_presale: 10 }),
        // allocator didn't run, no presale: contributes 0 (raw 200 ignored)
        makeRollupRow({ ad_spend: 200, ad_spend_allocated: null, ad_spend_presale: 0 }),
        // allocator didn't run, presale only: contributes 30
        makeRollupRow({ ad_spend: null, ad_spend_allocated: null, ad_spend_presale: 30 }),
      ],
      eventDate: null,
    });

    // 60 + 0 + 30 = 90
    assert.equal(result.metrics.spend, 90);
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

// ─── spendReconciliation tests (PR-C) ─────────────────────────────────────

/**
 * Deterministic Edinburgh-shaped fixture.
 * Pinned numbers derived from live data (2026-05-28):
 *   - 3 fixtures × £3,000 spend = £9,000 total
 *   - 3 fixtures × £9,000 allocated = £27,000 total
 *   - first_spend_date = 2026-01-28 → 120 days back from today
 *   - tickets_sold = 3,000, capacity = 5,000 (ticketsRemaining = 2,000)
 *   - daysToEvent = 16 (event_date = 2026-06-13, today = 2026-05-28)
 *   - liveCpt = 9000 / 3000 = £3
 *   - requiredPerDay = (2000 × 3) / 16 = 375
 *   - required total = 6000; remaining = 27000 - 9000 = 18000 → pace_covered
 */
describe("buildVenueCanonicalFunnel — spendReconciliation (PR-C)", () => {
  const TODAY = new Date("2026-05-28T12:00:00Z");

  function makeSpendRollups({
    spent = 9_000,
    numDays = 120,
    firstDate = "2026-01-28",
  }: {
    spent?: number;
    numDays?: number;
    firstDate?: string;
  } = {}): DailyRollupRow[] {
    const perDay = spent / numDays;
    const rows: DailyRollupRow[] = [];
    const base = new Date(`${firstDate}T00:00:00Z`);
    for (let i = 0; i < numDays; i++) {
      const d = new Date(base.getTime() + i * 86_400_000);
      rows.push(
        makeRollupRow({
          event_id: "ev-1",
          date: d.toISOString().slice(0, 10),
          ad_spend_allocated: perDay,
        }),
      );
    }
    return rows;
  }

  it("Edinburgh shape: computed values within rounding of expected", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 5_000,
      ticketsSold: 3_000,
      lifetimeCacheRow: null,
      dailyRollups: makeSpendRollups({
        spent: 9_000,
        numDays: 120,
        firstDate: "2026-01-28",
      }),
      eventDate: "2026-06-13",
      allocatedBudget: 27_000,
      today: TODAY,
    });

    const sr = result.spendReconciliation;
    assert.equal(sr.spent, 9_000);
    assert.equal(sr.allocated, 27_000);
    assert.equal(sr.remaining, 18_000);
    assert.equal(sr.firstSpendDate, "2026-01-28");
    assert.equal(sr.daysSinceFirstSpend, 120);
    // spentPerDay = 9000 / 120 = 75
    assert.ok(
      Math.abs((sr.spentPerDay ?? 0) - 75) < 0.01,
      `spentPerDay expected ~75, got ${sr.spentPerDay}`,
    );
    // requiredPerDay = (2000 × 3) / 16 = 375
    assert.equal(sr.requiredPerDayState, "ok");
    assert.ok(
      sr.requiredPerDay != null && Math.abs(sr.requiredPerDay - 375) < 0.01,
      `requiredPerDay expected ~375, got ${sr.requiredPerDay}`,
    );
    assert.equal(sr.suggestedDaily, sr.requiredPerDay);
    // required total = 6000 < remaining 18000 → pace_covered
    assert.equal(sr.warning, "pace_covered");
  });

  it("warning=additional_needed when required total > remaining", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 5_000,
      ticketsSold: 3_000,
      lifetimeCacheRow: null,
      dailyRollups: makeSpendRollups({
        spent: 9_000,
        numDays: 120,
        firstDate: "2026-01-28",
      }),
      eventDate: "2026-06-13",
      // remaining = 9800 - 9000 = 800 < required 6000
      allocatedBudget: 9_800,
      today: TODAY,
    });

    assert.equal(result.spendReconciliation.warning, "additional_needed");
  });

  it("sold-out: requiredPerDay suppressed", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 3_000,
      ticketsSold: 3_000, // sold out — ticketsRemaining = 0
      lifetimeCacheRow: null,
      dailyRollups: makeSpendRollups({ spent: 6_000 }),
      eventDate: "2026-06-13",
      allocatedBudget: 10_000,
      today: TODAY,
    });

    const sr = result.spendReconciliation;
    assert.equal(sr.requiredPerDayState, "sold_out");
    assert.equal(sr.requiredPerDay, null);
    assert.equal(sr.suggestedDaily, null);
    assert.equal(sr.warning, null);
  });

  it("event passed: requiredPerDay suppressed", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 5_000,
      ticketsSold: 3_000,
      lifetimeCacheRow: null,
      dailyRollups: makeSpendRollups({ spent: 9_000 }),
      // event in the past
      eventDate: "2025-01-01",
      allocatedBudget: 20_000,
      today: TODAY,
    });

    const sr = result.spendReconciliation;
    assert.equal(sr.requiredPerDayState, "event_passed");
    assert.equal(sr.requiredPerDay, null);
    assert.equal(sr.warning, null);
  });

  it("null CPT (no tickets yet): requiredPerDay suppressed", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 5_000,
      ticketsSold: 0, // no purchases → liveCpt = null
      lifetimeCacheRow: null,
      dailyRollups: makeSpendRollups({ spent: 500 }),
      eventDate: "2026-06-13",
      allocatedBudget: 10_000,
      today: TODAY,
    });

    const sr = result.spendReconciliation;
    assert.equal(sr.requiredPerDayState, "no_tickets_yet");
    assert.equal(sr.requiredPerDay, null);
    assert.equal(sr.warning, null);
  });

  it("null allocated budget: allocated/remaining/warning all null", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 5_000,
      ticketsSold: 3_000,
      lifetimeCacheRow: null,
      dailyRollups: makeSpendRollups({ spent: 9_000 }),
      eventDate: "2026-06-13",
      allocatedBudget: null,
      today: TODAY,
    });

    const sr = result.spendReconciliation;
    assert.equal(sr.allocated, null);
    assert.equal(sr.remaining, null);
    assert.equal(sr.warning, null);
    // spent and spentPerDay still computed
    assert.equal(sr.spent, 9_000);
    assert.ok(sr.spentPerDay != null);
  });

  it("no spend yet: firstSpendDate/daysSinceFirstSpend/spentPerDay all null", () => {
    const result = buildVenueCanonicalFunnel({
      capacity: 5_000,
      ticketsSold: 0,
      lifetimeCacheRow: null,
      dailyRollups: [],
      eventDate: "2026-06-13",
      allocatedBudget: 10_000,
      today: TODAY,
    });

    const sr = result.spendReconciliation;
    assert.equal(sr.spent, 0);
    assert.equal(sr.firstSpendDate, null);
    assert.equal(sr.daysSinceFirstSpend, null);
    assert.equal(sr.spentPerDay, null);
  });
});
