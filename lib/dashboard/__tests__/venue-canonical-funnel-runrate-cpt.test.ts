/**
 * lib/dashboard/__tests__/venue-canonical-funnel-runrate-cpt.test.ts
 *
 * Workstreams C (Run Rate Forecast) and D (CPT-at-sellout + budget
 * anchor) of the WC26 reconciliation. Both are pure derivations on the
 * existing canonical-funnel inputs.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildVenueCanonicalFunnel,
  type VenueCanonicalFunnelInput,
} from "../venue-canonical-funnel.ts";
import type { DailyRollupRow } from "../../db/client-portal-server.ts";

/** Minimal rollup row factory. */
function rollup(
  date: string,
  overrides: Partial<DailyRollupRow> = {},
): DailyRollupRow {
  return {
    id: `r-${date}`,
    event_id: "e1",
    date,
    ad_spend: null,
    ad_spend_allocated: null,
    ad_spend_presale: null,
    tickets_sold: 0,
    revenue: null,
    link_clicks: null,
    landing_page_views: null,
    meta_regs: null,
    meta_purchases: null,
    meta_leads: null,
    meta_impressions: null,
    meta_reach: null,
    meta_video_plays_3s: null,
    meta_video_plays_15s: null,
    meta_video_plays_p100: null,
    meta_engagements: null,
    ...overrides,
  } as DailyRollupRow;
}

function baseInput(
  overrides: Partial<VenueCanonicalFunnelInput> = {},
): VenueCanonicalFunnelInput {
  return {
    capacity: 1000,
    ticketsSold: 100,
    lifetimeCacheRow: null,
    dailyRollups: [],
    eventDate: null,
    allocatedBudget: null,
    today: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  };
}

describe("Run Rate Forecast (Workstream C)", () => {
  it("no sales yet → avgDailySalesToDate null, baseline null", () => {
    const f = buildVenueCanonicalFunnel(baseInput({ ticketsSold: 0 }));
    assert.equal(f.runRate.avgDailySalesToDate, null);
    assert.equal(f.runRate.baselineProjected, null);
    assert.equal(f.runRate.firstSaleDate, null);
  });

  it("computes avg daily rate from first-sale date (inclusive day count)", () => {
    // First sale 2026-05-22, today 2026-06-01 → 11 inclusive days.
    // 220 tickets / 11 days = 20/day.
    const rollups = [
      rollup("2026-05-22", { tickets_sold: 50 }),
      rollup("2026-05-28", { tickets_sold: 100 }),
      rollup("2026-06-01", { tickets_sold: 70 }),
    ];
    const f = buildVenueCanonicalFunnel(
      baseInput({
        ticketsSold: 220,
        capacity: 1000,
        dailyRollups: rollups,
        eventDate: "2026-06-21", // 20 days remaining
        today: new Date("2026-06-01T00:00:00Z"),
      }),
    );
    assert.equal(f.runRate.firstSaleDate, "2026-05-22");
    assert.equal(f.runRate.daysElapsed, 11);
    assert.equal(f.runRate.avgDailySalesToDate, 20);
    assert.equal(f.runRate.daysRemaining, 20);
    // baseline = 220 + 20 × 20 = 620
    assert.equal(f.runRate.baselineProjected, 620);
    assert.ok(
      Math.abs((f.runRate.baselineSellThroughFraction ?? 0) - 0.62) < 1e-9,
    );
  });

  it("baseline caps at capacity", () => {
    const rollups = [rollup("2026-05-02", { tickets_sold: 900 })];
    const f = buildVenueCanonicalFunnel(
      baseInput({
        ticketsSold: 900,
        capacity: 1000,
        dailyRollups: rollups,
        eventDate: "2026-12-01", // far future → huge projection
        today: new Date("2026-06-01T00:00:00Z"),
      }),
    );
    assert.equal(f.runRate.baselineProjected, 1000); // capped
  });

  it("surge scenarios add capacity × uplift, capped, with deltas", () => {
    const rollups = [rollup("2026-05-22", { tickets_sold: 220 })];
    const f = buildVenueCanonicalFunnel(
      baseInput({
        ticketsSold: 220,
        capacity: 1000,
        dailyRollups: rollups,
        eventDate: "2026-06-21",
        today: new Date("2026-06-01T00:00:00Z"),
      }),
    );
    // baseline = 620. +15% = 620 + 150 = 770. +50% = 620 + 500 = 1000 (capped).
    const uplifts = f.runRate.surge.map((s) => s.uplift);
    assert.deepEqual(uplifts, [0.15, 0.25, 0.35, 0.5]);
    assert.equal(f.runRate.surge[0]!.projected, 770);
    assert.equal(f.runRate.surge[0]!.deltaVsBaseline, 150);
    assert.equal(f.runRate.surge[3]!.projected, 1000); // capped
    assert.equal(f.runRate.surge[3]!.deltaVsBaseline, 380); // 1000 - 620
  });

  it("no event date → daysRemaining null, baseline null", () => {
    const rollups = [rollup("2026-05-22", { tickets_sold: 220 })];
    const f = buildVenueCanonicalFunnel(
      baseInput({ ticketsSold: 220, dailyRollups: rollups, eventDate: null }),
    );
    assert.equal(f.runRate.daysRemaining, null);
    assert.equal(f.runRate.baselineProjected, null);
  });
});

describe("CPT projection + budget anchor (Workstream D)", () => {
  it("CPT at sellout equals current CPT (the framing, not new math)", () => {
    // spent £400 over 200 tickets → CPT £2.00. capacity 1000.
    const rollups = [
      rollup("2026-05-20", { ad_spend_allocated: 400, tickets_sold: 200 }),
    ];
    const f = buildVenueCanonicalFunnel(
      baseInput({
        ticketsSold: 200,
        capacity: 1000,
        dailyRollups: rollups,
        eventDate: "2026-06-21",
      }),
    );
    assert.equal(f.cptProjection.currentCostPerTicket, 2);
    // (400 + 800 × 2) / 1000 = 2000/1000 = 2.0
    assert.ok(
      Math.abs((f.cptProjection.costPerTicketAtSellout ?? 0) - 2) < 1e-9,
    );
  });

  it("budget anchor = allocatedBudget / capacity (the £2.50 anchor)", () => {
    const rollups = [
      rollup("2026-05-20", { ad_spend_allocated: 400, tickets_sold: 200 }),
    ];
    const f = buildVenueCanonicalFunnel(
      baseInput({
        ticketsSold: 200,
        capacity: 1000,
        dailyRollups: rollups,
        eventDate: "2026-06-21",
        allocatedBudget: 2500, // 2500 / 1000 = £2.50
      }),
    );
    assert.equal(f.cptProjection.budgetAnchorCostPerTicket, 2.5);
    // headroom = 2.50 − 2.00 = +0.50/ticket; total = 0.50 × 1000 = £500
    assert.ok(
      Math.abs((f.cptProjection.budgetHeadroomPerTicket ?? 0) - 0.5) < 1e-9,
    );
    assert.equal(f.cptProjection.budgetHeadroomTotal, 500);
    assert.equal(f.cptProjection.headroomTone, "above"); // under budget (green)
  });

  it("over-budget → red tone, negative headroom", () => {
    // CPT £3.00 vs anchor £2.50 → over by £0.50.
    const rollups = [
      rollup("2026-05-20", { ad_spend_allocated: 600, tickets_sold: 200 }),
    ];
    const f = buildVenueCanonicalFunnel(
      baseInput({
        ticketsSold: 200,
        capacity: 1000,
        dailyRollups: rollups,
        eventDate: "2026-06-21",
        allocatedBudget: 2500,
      }),
    );
    assert.equal(f.cptProjection.currentCostPerTicket, 3);
    assert.ok((f.cptProjection.budgetHeadroomPerTicket ?? 0) < 0);
    assert.equal(f.cptProjection.headroomTone, "below");
  });

  it("within ±10% of anchor → amber tone", () => {
    // CPT £2.40 vs anchor £2.50 → headroom +0.10 = 4% of anchor → within.
    const rollups = [
      rollup("2026-05-20", { ad_spend_allocated: 480, tickets_sold: 200 }),
    ];
    const f = buildVenueCanonicalFunnel(
      baseInput({
        ticketsSold: 200,
        capacity: 1000,
        dailyRollups: rollups,
        eventDate: "2026-06-21",
        allocatedBudget: 2500,
      }),
    );
    assert.equal(f.cptProjection.headroomTone, "within");
  });

  it("no budget set → anchor + headroom null", () => {
    const rollups = [
      rollup("2026-05-20", { ad_spend_allocated: 400, tickets_sold: 200 }),
    ];
    const f = buildVenueCanonicalFunnel(
      baseInput({
        ticketsSold: 200,
        capacity: 1000,
        dailyRollups: rollups,
        eventDate: "2026-06-21",
        allocatedBudget: null,
      }),
    );
    assert.equal(f.cptProjection.budgetAnchorCostPerTicket, null);
    assert.equal(f.cptProjection.budgetHeadroomPerTicket, null);
    assert.equal(f.cptProjection.headroomTone, null);
  });

  it("sold out (remaining = 0) → CPT at sellout still equals current CPT, no NaN", () => {
    const rollups = [
      rollup("2026-05-20", { ad_spend_allocated: 2000, tickets_sold: 1000 }),
    ];
    const f = buildVenueCanonicalFunnel(
      baseInput({
        ticketsSold: 1000,
        capacity: 1000,
        dailyRollups: rollups,
        eventDate: "2026-06-21",
        allocatedBudget: 2500,
      }),
    );
    assert.equal(f.cptProjection.currentCostPerTicket, 2);
    assert.equal(f.cptProjection.costPerTicketAtSellout, 2);
    assert.equal(Number.isFinite(f.cptProjection.costPerTicketAtSellout!), true);
  });
});
