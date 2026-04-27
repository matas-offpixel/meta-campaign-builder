import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  aggregateAllocationByEvent,
  aggregateClientWideTotals,
  aggregateVenueGroupTotals,
  aggregateVenueWoW,
  isKnockoutStage,
  sortEventsGroupStageFirst,
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
  allocation?: {
    ad_spend_allocated?: number | null;
    ad_spend_specific?: number | null;
    ad_spend_generic_share?: number | null;
    ad_spend_presale?: number | null;
    /** Optional date for the WoW aggregator tests. Aggregators that
     *  don't care about the day axis (e.g. the lifetime topline) leave
     *  this at the sentinel `2020-01-01`. */
    date?: string;
    tickets_sold?: number | null;
  },
): DailyRollupRow {
  return {
    event_id,
    date: allocation?.date ?? "2020-01-01",
    tickets_sold: allocation?.tickets_sold ?? null,
    ad_spend,
    ad_spend_allocated: allocation?.ad_spend_allocated ?? null,
    ad_spend_specific: allocation?.ad_spend_specific ?? null,
    ad_spend_generic_share: allocation?.ad_spend_generic_share ?? null,
    ad_spend_presale: allocation?.ad_spend_presale ?? null,
  };
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

describe("isKnockoutStage", () => {
  it("detects canonical markers case-insensitively", () => {
    assert.equal(isKnockoutStage("WC26 Last 32 Leeds"), true);
    assert.equal(isKnockoutStage("Last 16"), true);
    assert.equal(isKnockoutStage("last-16 round"), true);
    assert.equal(isKnockoutStage("Quarter Final"), true);
    assert.equal(isKnockoutStage("Semi-Final"), true);
    assert.equal(isKnockoutStage("FINAL"), true);
    assert.equal(isKnockoutStage("Knockout Round"), true);
    assert.equal(isKnockoutStage("Round of 16"), true);
  });

  it("returns false for group-stage names", () => {
    assert.equal(isKnockoutStage("Croatia vs Ghana"), false);
    assert.equal(isKnockoutStage("England v Panama"), false);
    assert.equal(isKnockoutStage("Match Day 1"), false);
  });

  it("null / empty names return false", () => {
    assert.equal(isKnockoutStage(null), false);
    assert.equal(isKnockoutStage(undefined), false);
    assert.equal(isKnockoutStage(""), false);
  });
});

describe("sortEventsGroupStageFirst", () => {
  it("group-stage matches sort alphabetical by opponent, knockouts last", () => {
    const input = [
      ev({ id: "p", name: "Panama" }),
      ev({ id: "l32", name: "Last 32" }),
      ev({ id: "c", name: "Croatia" }),
      ev({ id: "g", name: "Ghana" }),
      ev({ id: "f", name: "Final" }),
    ];
    const sorted = sortEventsGroupStageFirst(input);
    assert.deepEqual(
      sorted.map((e) => e.id),
      ["c", "g", "p", "l32", "f"],
    );
  });

  it("orders knockouts by bracket stage: Last 32 → Last 16 → QF → SF → Final", () => {
    const input = [
      ev({ id: "final", name: "Final" }),
      ev({ id: "qf", name: "Quarter Final" }),
      ev({ id: "l32", name: "Last 32" }),
      ev({ id: "sf", name: "Semi Final" }),
      ev({ id: "l16", name: "Last 16" }),
    ];
    const sorted = sortEventsGroupStageFirst(input);
    assert.deepEqual(
      sorted.map((e) => e.id),
      ["l32", "l16", "qf", "sf", "final"],
    );
  });

  it("is a pure function — does not mutate the input array", () => {
    const input = [
      ev({ id: "b", name: "B team" }),
      ev({ id: "a", name: "A team" }),
    ];
    const snapshot = input.map((e) => e.id);
    const sorted = sortEventsGroupStageFirst(input);
    assert.deepEqual(
      input.map((e) => e.id),
      snapshot,
    );
    assert.notEqual(sorted, input);
  });

  it("is stable — equal names preserve input order", () => {
    const input = [
      ev({ id: "first", name: "Same" }),
      ev({ id: "second", name: "Same" }),
      ev({ id: "third", name: "Same" }),
    ];
    assert.deepEqual(
      sortEventsGroupStageFirst(input).map((e) => e.id),
      ["first", "second", "third"],
    );
  });

  it("treats null / missing names as group-stage rows at the end of the group bucket", () => {
    const input = [
      ev({ id: "z", name: null }),
      ev({ id: "a", name: "Alpha" }),
      ev({ id: "f", name: "Final" }),
    ];
    const sorted = sortEventsGroupStageFirst(input);
    // null name sorts as empty → comes before "Alpha" by localeCompare
    // of "" vs "Alpha". That's fine — we just assert knockout still
    // lands last.
    assert.equal(sorted.at(-1)?.id, "f");
  });

  it("handles the 4theFans WC26 venue shape (Croatia, Ghana, Panama + bracket)", () => {
    const input = [
      ev({ id: "l32", name: "WC26 Last 32 Leeds" }),
      ev({ id: "ghana", name: "Ghana vs England" }),
      ev({ id: "pan", name: "Panama vs England" }),
      ev({ id: "cro", name: "Croatia vs England" }),
      ev({ id: "l16", name: "WC26 Last 16 Leeds" }),
    ];
    const sorted = sortEventsGroupStageFirst(input);
    assert.deepEqual(
      sorted.map((e) => e.id),
      ["cro", "ghana", "pan", "l32", "l16"],
    );
  });
});

describe("aggregateAllocationByEvent", () => {
  it("returns an empty map when no rows have allocation populated", () => {
    const rows = [
      rollup("a", 100),
      rollup("b", 200),
    ];
    const map = aggregateAllocationByEvent(rows);
    assert.equal(map.size, 0);
  });

  it("sums specific / generic / allocated per event across days", () => {
    const rows: DailyRollupRow[] = [
      // Event A: two allocated days, one with specific.
      rollup("a", 100, {
        ad_spend_allocated: 100,
        ad_spend_specific: 50,
        ad_spend_generic_share: 50,
      }),
      rollup("a", 80, {
        ad_spend_allocated: 80,
        ad_spend_specific: 30,
        ad_spend_generic_share: 50,
      }),
      // Event B: single allocated day.
      rollup("b", 60, {
        ad_spend_allocated: 60,
        ad_spend_specific: 0,
        ad_spend_generic_share: 60,
      }),
    ];
    const map = aggregateAllocationByEvent(rows);
    assert.equal(map.size, 2);
    const a = map.get("a")!;
    assert.equal(a.allocated, 180);
    assert.equal(a.specific, 80);
    assert.equal(a.genericShare, 100);
    assert.equal(a.daysCovered, 2);

    const b = map.get("b")!;
    assert.equal(b.allocated, 60);
    assert.equal(b.specific, 0);
    assert.equal(b.genericShare, 60);
    assert.equal(b.daysCovered, 1);
  });

  it("skips days with null ad_spend_allocated even if other columns are non-null", () => {
    const rows: DailyRollupRow[] = [
      // Degenerate row — defensive — allocator should never write
      // only specific without also writing allocated, but if the
      // table gets partially populated by a historical cleanup we
      // don't want to count it.
      rollup("a", 100, {
        ad_spend_allocated: null,
        ad_spend_specific: 10,
        ad_spend_generic_share: 10,
      }),
      rollup("a", 50, {
        ad_spend_allocated: 50,
        ad_spend_specific: 20,
        ad_spend_generic_share: 30,
      }),
    ];
    const map = aggregateAllocationByEvent(rows);
    const a = map.get("a")!;
    assert.equal(a.allocated, 50);
    assert.equal(a.specific, 20);
    assert.equal(a.genericShare, 30);
    assert.equal(a.daysCovered, 1);
  });
});

describe("aggregateVenueWoW", () => {
  // Anchor every test to 2026-04-27 so the WoW windows are:
  //   current:  2026-04-21 .. 2026-04-27 (7 days, inclusive)
  //   previous: 2026-04-14 .. 2026-04-20 (7 days, inclusive)
  const TODAY = "2026-04-27";
  const events = [ev({ id: "a" }), ev({ id: "b" })];

  it("computes tickets + CPT delta from rollups inside each window", () => {
    const rollups: DailyRollupRow[] = [
      // Current window — 300 tickets, £300 spend across two events
      rollup("a", 100, { date: "2026-04-22", tickets_sold: 150 }),
      rollup("b", 200, { date: "2026-04-25", tickets_sold: 150 }),
      // Previous window — 200 tickets, £400 spend
      rollup("a", 300, { date: "2026-04-14", tickets_sold: 100 }),
      rollup("b", 100, { date: "2026-04-20", tickets_sold: 100 }),
    ];

    const result = aggregateVenueWoW(events, rollups, TODAY);

    assert.equal(result.tickets.current, 300);
    assert.equal(result.tickets.previous, 200);
    assert.equal(result.tickets.delta, 100);
    assert.equal(result.tickets.deltaPct, 50);

    // CPT: curr = 300/300 = 1.00, prev = 400/200 = 2.00 → delta -1.00, -50%
    assert.equal(result.cpt.current, 1);
    assert.equal(result.cpt.previous, 2);
    assert.equal(result.cpt.delta, -1);
    assert.equal(result.cpt.deltaPct, -50);
  });

  it("surfaces current-window data but nulls the delta when previous window is empty", () => {
    const rollups: DailyRollupRow[] = [
      // Current only — previous window is empty.
      rollup("a", 50, { date: "2026-04-23", tickets_sold: 100 }),
    ];
    const result = aggregateVenueWoW(events, rollups, TODAY);
    // The current half is non-null so the header can still render a
    // plain "Tickets: 100" / "CPT: £0.50" — only the parenthetical
    // delta gets hidden.
    assert.equal(result.tickets.current, 100);
    assert.equal(result.tickets.previous, null);
    assert.equal(result.tickets.delta, null);
    assert.equal(result.tickets.deltaPct, null);
    assert.equal(result.cpt.current, 0.5);
    assert.equal(result.cpt.previous, null);
    assert.equal(result.cpt.delta, null);
  });

  it("ignores rollup rows outside either window", () => {
    const rollups: DailyRollupRow[] = [
      // Inside windows
      rollup("a", 100, { date: "2026-04-25", tickets_sold: 10 }),
      rollup("a", 100, { date: "2026-04-15", tickets_sold: 10 }),
      // Too old — more than 13 days back.
      rollup("a", 9999, { date: "2026-04-01", tickets_sold: 9999 }),
      // Future — future-dated test data.
      rollup("a", 9999, { date: "2026-05-10", tickets_sold: 9999 }),
    ];
    const result = aggregateVenueWoW(events, rollups, TODAY);
    assert.equal(result.tickets.current, 10);
    assert.equal(result.tickets.previous, 10);
    assert.equal(result.tickets.delta, 0);
  });

  it("nulls CPT when spend or tickets is zero in a window", () => {
    const rollups: DailyRollupRow[] = [
      rollup("a", 100, { date: "2026-04-23", tickets_sold: 50 }),
      // Previous window had spend but zero tickets → previous CPT = null
      rollup("a", 50, { date: "2026-04-18", tickets_sold: 0 }),
    ];
    const result = aggregateVenueWoW(events, rollups, TODAY);
    assert.notEqual(result.cpt.current, null);
    assert.equal(result.cpt.previous, null);
    assert.equal(result.cpt.delta, null);
    assert.equal(result.cpt.deltaPct, null);
    // Tickets delta still renders — one window with zero tickets is
    // legitimate data, not missing data.
    assert.equal(result.tickets.current, 50);
    assert.equal(result.tickets.previous, 0);
  });

  it("ignores rollup rows for events outside the group", () => {
    const rollups: DailyRollupRow[] = [
      rollup("a", 100, { date: "2026-04-22", tickets_sold: 100 }),
      rollup("a", 100, { date: "2026-04-17", tickets_sold: 80 }),
      // Different event id — not in `events` list.
      rollup("outsider", 9999, { date: "2026-04-23", tickets_sold: 9999 }),
    ];
    const result = aggregateVenueWoW(events, rollups, TODAY);
    assert.equal(result.tickets.current, 100);
    assert.equal(result.tickets.previous, 80);
  });

  it("returns null halves for an empty event list", () => {
    const result = aggregateVenueWoW([], [], TODAY);
    assert.equal(result.tickets.delta, null);
    assert.equal(result.cpt.delta, null);
  });
});
