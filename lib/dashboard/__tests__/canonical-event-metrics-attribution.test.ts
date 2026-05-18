/**
 * Resolver-level tests for the attribution gap fields surfaced by
 * `computeCanonicalEventMetrics`. Five pinned states + a multi-link
 * SUM-before-delta case (the Outernet shape).
 *
 * Per `feedback_resolver_dashboard_test_gap.md`: this file pins
 * ONLY the resolver contract. The DOM-level gates that catch
 * missing-wire-up failures live in
 * `__tests__/components/AttributionGapTile.test.tsx`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeCanonicalEventMetrics } from "../canonical-event-metrics.ts";
import type { EventCodeLifetimeMetaCacheRow } from "../../db/event-code-lifetime-meta-cache.ts";
import type { DailyRollupRow } from "../../db/client-portal-server.ts";

const FROZEN_NOW = "2026-05-13T12:00:00.000Z";

function cache(
  overrides: Partial<EventCodeLifetimeMetaCacheRow>,
): EventCodeLifetimeMetaCacheRow {
  return {
    client_id: "c-4tf",
    event_code: "WC26-EXAMPLE",
    meta_reach: null,
    meta_impressions: null,
    meta_link_clicks: null,
    meta_regs: null,
    meta_video_plays_3s: null,
    meta_video_plays_15s: null,
    meta_video_plays_p100: null,
    meta_engagements: null,
    campaign_names: [],
    fetched_at: FROZEN_NOW,
    created_at: FROZEN_NOW,
    updated_at: FROZEN_NOW,
    ...overrides,
  };
}

function rollup(overrides: Partial<DailyRollupRow>): DailyRollupRow {
  return {
    event_id: overrides.event_id ?? "e1",
    date: overrides.date ?? "2026-05-01",
    tickets_sold: null,
    ad_spend: null,
    tiktok_spend: null,
    google_ads_spend: null,
    revenue: null,
    link_clicks: null,
    meta_regs: null,
    meta_impressions: null,
    meta_reach: null,
    meta_video_plays_3s: null,
    meta_video_plays_15s: null,
    meta_video_plays_p100: null,
    meta_engagements: null,
    tiktok_impressions: null,
    tiktok_video_views: null,
    tiktok_clicks: null,
    google_ads_impressions: null,
    google_ads_clicks: null,
    google_ads_video_views: null,
    ad_spend_allocated: null,
    ad_spend_presale: null,
    ad_spend_specific: null,
    ad_spend_generic_share: null,
    source_meta_at: null,
    source_eventbrite_at: null,
    ...overrides,
  } as DailyRollupRow;
}

describe("canonical resolver — attribution gap (5 pinned states)", () => {
  it("no_data: cache miss + zero rollup tickets", () => {
    const m = computeCanonicalEventMetrics({
      cacheRow: null,
      dailyRollups: [],
      events: [],
    });
    assert.equal(m.metaRegs, null);
    assert.equal(m.ticketsTrue, 0);
    assert.equal(m.attribution.state, "no_data");
    assert.equal(m.attributionRate, null);
  });

  it("capi_missing (WC26-LONDON-SHEPHERDS): tickets > 0, metaRegs == 0", () => {
    const m = computeCanonicalEventMetrics({
      cacheRow: cache({
        event_code: "WC26-LONDON-SHEPHERDS",
        meta_regs: 0,
      }),
      dailyRollups: [
        rollup({ event_id: "e1", date: "2026-05-12", tickets_sold: 61 }),
      ],
      events: [{ id: "e1", event_code: "WC26-LONDON-SHEPHERDS" }],
    });
    assert.equal(m.metaRegs, 0);
    assert.equal(m.ticketsTrue, 61);
    assert.equal(m.attribution.state, "capi_missing");
  });

  it("over_attributed (WC26-BRIGHTON): metaRegs 14,696 > ticketsTrue 1,709", () => {
    const m = computeCanonicalEventMetrics({
      cacheRow: cache({
        event_code: "WC26-BRIGHTON",
        meta_regs: 14_696,
      }),
      dailyRollups: [
        rollup({ event_id: "e1", date: "2026-04-01", tickets_sold: 1_709 }),
      ],
      events: [{ id: "e1", event_code: "WC26-BRIGHTON" }],
    });
    assert.equal(m.metaRegs, 14_696);
    assert.equal(m.ticketsTrue, 1_709);
    assert.equal(m.attribution.state, "over_attributed");
  });

  it("tracked-low (WC26-EDINBURGH): 54 / 1,648 ≈ 3% → red band", () => {
    const m = computeCanonicalEventMetrics({
      cacheRow: cache({
        event_code: "WC26-EDINBURGH",
        meta_regs: 54,
      }),
      dailyRollups: [
        rollup({ event_id: "e1", date: "2026-04-01", tickets_sold: 1_648 }),
      ],
      events: [{ id: "e1", event_code: "WC26-EDINBURGH" }],
    });
    assert.equal(m.metaRegs, 54);
    assert.equal(m.ticketsTrue, 1_648);
    assert.equal(m.attribution.state, "tracked");
    assert.equal(m.attribution.band, "red");
    assert(m.attributionRate != null);
    assert(m.attributionRate < 0.05);
  });

  it("tracked-high: 850 / 1,000 ratio → green band", () => {
    const m = computeCanonicalEventMetrics({
      cacheRow: cache({ meta_regs: 850 }),
      dailyRollups: [
        rollup({ event_id: "e1", date: "2026-04-01", tickets_sold: 1_000 }),
      ],
      events: [{ id: "e1", event_code: "WC26-EXAMPLE" }],
    });
    assert.equal(m.attribution.state, "tracked");
    assert.equal(m.attribution.band, "green");
  });
});

describe("canonical resolver — multi-link SUM-before-delta on tickets side", () => {
  it("Outernet shape: two events under one event_code SUM tier_channel before delta", () => {
    // The asymmetry per `feedback_multi_link_backfill_scope.md`:
    // tickets are summed across `external_event_id` rows BEFORE the
    // canonical struct sees them. The portal layer constructs
    // `tier_channel_sales_tickets` per event already SUM'd over
    // its multi-link rows; the resolver only needs to sum across
    // events under the same event_code.
    //
    // Outernet venue: e1 (presale) + e2 (gen sale), each with a
    // tier-channel total. tier-channel side wins over rollup side.
    const tierChannelTickets = new Map<string, number | null>([
      ["e1", 320], // presale
      ["e2", 540], // gen sale
    ]);
    const m = computeCanonicalEventMetrics({
      cacheRow: cache({
        event_code: "WC26-LONDON-OUTERNET",
        meta_regs: 200,
      }),
      dailyRollups: [
        // Rollup side under-reports — the tier-channel side is the
        // truer figure. MAX picks the tier-channel sum (860).
        rollup({ event_id: "e1", date: "2026-04-01", tickets_sold: 100 }),
        rollup({ event_id: "e2", date: "2026-04-15", tickets_sold: 200 }),
      ],
      events: [
        { id: "e1", event_code: "WC26-LONDON-OUTERNET" },
        { id: "e2", event_code: "WC26-LONDON-OUTERNET" },
      ],
      tierChannelTicketsByEventId: tierChannelTickets,
    });
    assert.equal(m.ticketsTrue, 860);
    assert.equal(m.metaRegs, 200);
    // 200 / 860 ≈ 23% → tracked-red
    assert.equal(m.attribution.state, "tracked");
    assert.equal(m.attribution.band, "red");
  });

  it("falls back to rollup side when tier-channel map is undefined", () => {
    const m = computeCanonicalEventMetrics({
      cacheRow: cache({ meta_regs: 50 }),
      dailyRollups: [
        rollup({ event_id: "e1", date: "2026-04-01", tickets_sold: 250 }),
      ],
      events: [{ id: "e1", event_code: "WC26-EXAMPLE" }],
    });
    assert.equal(m.ticketsTrue, 250);
    assert.equal(m.attribution.state, "tracked");
    assert.equal(m.attribution.band, "red"); // 50/250 = 20% < 40%
  });

  it("MAX picks rollup side when it exceeds tier-channel map", () => {
    const m = computeCanonicalEventMetrics({
      cacheRow: cache({ meta_regs: 100 }),
      dailyRollups: [
        rollup({ event_id: "e1", date: "2026-04-01", tickets_sold: 700 }),
      ],
      events: [{ id: "e1", event_code: "WC26-EXAMPLE" }],
      tierChannelTicketsByEventId: new Map([["e1", 500]]),
    });
    assert.equal(m.ticketsTrue, 700);
  });
});
