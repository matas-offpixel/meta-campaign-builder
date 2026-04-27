import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  aggregateClientWideTotals,
  aggregateVenueGroupTotals,
  type AdditionalSpendRow,
  type AggregatableEvent,
} from "../client-dashboard-aggregations.ts";
import type { DailyRollupRow } from "../client-portal-server.ts";

function ev(
  overrides: Partial<AggregatableEvent> & { id: string },
): AggregatableEvent {
  return {
    event_code: null,
    event_date: null,
    capacity: null,
    prereg_spend: null,
    tickets_sold: null,
    latest_snapshot: null,
    ...overrides,
  };
}

function rollup(
  event_id: string,
  ad_spend: number | null,
): DailyRollupRow {
  return { event_id, ad_spend };
}

function addl(event_id: string, amount: number | null): AdditionalSpendRow {
  return { event_id, amount };
}

describe("aggregateClientWideTotals", () => {
  it("returns zero-ish totals for an empty event list", () => {
    const t = aggregateClientWideTotals([], [], []);
    assert.equal(t.events, 0);
    assert.equal(t.venueGroups, 0);
    assert.equal(t.adSpend, 0);
    assert.equal(t.totalSpend, 0);
    assert.equal(t.ticketsSold, 0);
    assert.equal(t.capacity, null);
    assert.equal(t.ticketRevenue, null);
    assert.equal(t.roas, null);
    assert.equal(t.cpt, null);
    assert.equal(t.sellThroughPct, null);
  });

  it("sums ad_spend, additional_spend, prereg_spend, and tickets across events", () => {
    const events = [
      ev({
        id: "a",
        capacity: 1000,
        prereg_spend: 100,
        latest_snapshot: { tickets_sold: 200, revenue: 2000 },
      }),
      ev({
        id: "b",
        capacity: 500,
        prereg_spend: 50,
        latest_snapshot: { tickets_sold: 100, revenue: 800 },
      }),
    ];
    const rollups: DailyRollupRow[] = [
      rollup("a", 400),
      rollup("a", 100),
      rollup("b", 200),
    ];
    const additional: AdditionalSpendRow[] = [addl("a", 50), addl("b", 25)];

    const t = aggregateClientWideTotals(events, rollups, additional);
    assert.equal(t.adSpend, 700);
    assert.equal(t.additionalSpend, 75);
    assert.equal(t.preregSpend, 150);
    assert.equal(t.totalSpend, 925);
    assert.equal(t.ticketsSold, 300);
    assert.equal(t.capacity, 1500);
    assert.equal(t.ticketRevenue, 2800);
    assert.equal(t.sellThroughPct, 20);
    assert.equal(t.cpt, 925 / 300);
    assert.equal(t.roas, 2800 / 700);
  });

  it("ignores rollup + additional spend rows whose event is not in the list", () => {
    const events = [ev({ id: "a" })];
    const rollups: DailyRollupRow[] = [
      rollup("a", 50),
      rollup("zzz_unknown", 999),
    ];
    const additional = [addl("a", 10), addl("zzz_unknown", 999)];
    const t = aggregateClientWideTotals(events, rollups, additional);
    assert.equal(t.adSpend, 50);
    assert.equal(t.additionalSpend, 10);
  });

  it("treats a single event with no event_code as its own venue group", () => {
    const t = aggregateClientWideTotals(
      [ev({ id: "solo" })],
      [],
      [],
    );
    assert.equal(t.venueGroups, 1);
    assert.equal(t.events, 1);
  });

  it("coalesces events that share (event_code, event_date) into one venue group", () => {
    const t = aggregateClientWideTotals(
      [
        ev({ id: "a", event_code: "X", event_date: "2026-06-27" }),
        ev({ id: "b", event_code: "X", event_date: "2026-06-27" }),
        ev({ id: "c", event_code: "X", event_date: "2026-06-27" }),
        ev({ id: "d", event_code: "Y", event_date: "2026-07-10" }),
      ],
      [],
      [],
    );
    assert.equal(t.events, 4);
    assert.equal(t.venueGroups, 2);
  });

  it("returns null ROAS when ad spend is zero", () => {
    const events = [
      ev({
        id: "a",
        latest_snapshot: { tickets_sold: 10, revenue: 100 },
      }),
    ];
    const t = aggregateClientWideTotals(events, [], []);
    assert.equal(t.roas, null);
  });

  it("returns null ticketRevenue when no event has revenue reported", () => {
    const events = [
      ev({
        id: "a",
        latest_snapshot: { tickets_sold: 10, revenue: null },
      }),
    ];
    const t = aggregateClientWideTotals(events, [], []);
    assert.equal(t.ticketRevenue, null);
  });

  it("adds extraAdSpend (e.g. shared London on-sale campaign) into adSpend", () => {
    const events = [ev({ id: "a" })];
    const t = aggregateClientWideTotals(events, [], [], 1234);
    assert.equal(t.adSpend, 1234);
    assert.equal(t.totalSpend, 1234);
  });

  it("null capacities collapse to null; mixed null/non-null sums non-null only", () => {
    const all = aggregateClientWideTotals(
      [ev({ id: "a" }), ev({ id: "b" })],
      [],
      [],
    );
    assert.equal(all.capacity, null);

    const partial = aggregateClientWideTotals(
      [ev({ id: "a", capacity: 100 }), ev({ id: "b", capacity: null })],
      [],
      [],
    );
    assert.equal(partial.capacity, 100);
  });
});

describe("aggregateVenueGroupTotals", () => {
  const TODAY = "2026-06-27";

  it("sums ad_spend + additional + prereg + tickets within the group", () => {
    const events = [
      ev({
        id: "a",
        event_date: TODAY,
        capacity: 1176,
        prereg_spend: 200,
        latest_snapshot: { tickets_sold: 800, revenue: 6400 },
      }),
      ev({
        id: "b",
        event_date: TODAY,
        capacity: 1176,
        prereg_spend: 150,
        latest_snapshot: { tickets_sold: 700, revenue: 5600 },
      }),
    ];
    const rollups = [rollup("a", 500), rollup("b", 400)];
    const additional = [addl("a", 50)];

    const t = aggregateVenueGroupTotals(events, rollups, additional, TODAY);
    assert.equal(t.adSpend, 900);
    assert.equal(t.additionalSpend, 50);
    assert.equal(t.preregSpend, 350);
    assert.equal(t.totalSpend, 1300);
    assert.equal(t.ticketsSold, 1500);
    assert.equal(t.capacity, 2352);
    assert.equal(t.ticketRevenue, 12000);
    assert.ok(t.roas !== null && Math.abs(t.roas - 12000 / 900) < 1e-9);
    assert.ok(t.cpt !== null && Math.abs(t.cpt - 1300 / 1500) < 1e-9);
    assert.ok(
      t.sellThroughPct !== null &&
        Math.abs(t.sellThroughPct - (1500 / 2352) * 100) < 1e-9,
    );
  });

  it("ignores rollup / additional rows for events not in the group", () => {
    const events = [ev({ id: "a", event_date: TODAY })];
    const rollups = [rollup("a", 10), rollup("b_other", 9999)];
    const additional = [addl("a", 5), addl("b_other", 9999)];
    const t = aggregateVenueGroupTotals(events, rollups, additional, TODAY);
    assert.equal(t.adSpend, 10);
    assert.equal(t.additionalSpend, 5);
  });

  it("activity score is higher for events happening today than last year", () => {
    const recent = aggregateVenueGroupTotals(
      [ev({ id: "a", event_date: TODAY })],
      [rollup("a", 100)],
      [],
      TODAY,
    );
    const old = aggregateVenueGroupTotals(
      [ev({ id: "a", event_date: "2025-06-27" })],
      [rollup("a", 100)],
      [],
      TODAY,
    );
    assert.ok(recent.activityScore > old.activityScore);
  });

  it("activity score tolerates null event_date (no recency bonus)", () => {
    const t = aggregateVenueGroupTotals(
      [ev({ id: "a" })],
      [rollup("a", 42)],
      [],
      TODAY,
    );
    assert.equal(t.activityScore, 42);
  });

  it("null ROAS when ad spend is zero", () => {
    const t = aggregateVenueGroupTotals(
      [
        ev({
          id: "a",
          latest_snapshot: { tickets_sold: 10, revenue: 100 },
        }),
      ],
      [],
      [],
      TODAY,
    );
    assert.equal(t.roas, null);
  });
});
