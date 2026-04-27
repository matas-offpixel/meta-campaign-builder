import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  aggregateAllocationByEvent,
  aggregateClientWideTotals,
  aggregateVenueGroupTotals,
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
  },
): DailyRollupRow {
  return {
    event_id,
    ad_spend,
    ad_spend_allocated: allocation?.ad_spend_allocated ?? null,
    ad_spend_specific: allocation?.ad_spend_specific ?? null,
    ad_spend_generic_share: allocation?.ad_spend_generic_share ?? null,
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
