import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  aggregateAllocationByEvent,
  aggregateClientWideTotals,
  aggregateVenueCampaignPerformance,
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
    tiktok_spend?: number | null;
    ad_spend_specific?: number | null;
    ad_spend_generic_share?: number | null;
    ad_spend_presale?: number | null;
    /** Optional date for the WoW aggregator tests. Aggregators that
     *  don't care about the day axis (e.g. the lifetime topline) leave
     *  this at the sentinel `2020-01-01`. */
    date?: string;
    tickets_sold?: number | null;
    revenue?: number | null;
    meta_regs?: number | null;
  },
): DailyRollupRow {
  return {
    event_id,
    date: allocation?.date ?? "2020-01-01",
    tickets_sold: allocation?.tickets_sold ?? null,
    ad_spend,
    tiktok_spend: allocation?.tiktok_spend ?? null,
    ad_spend_allocated: allocation?.ad_spend_allocated ?? null,
    revenue: allocation?.revenue ?? null,
    link_clicks: null,
    meta_regs: allocation?.meta_regs ?? null,
    tiktok_clicks: null,
    ad_spend_specific: allocation?.ad_spend_specific ?? null,
    ad_spend_generic_share: allocation?.ad_spend_generic_share ?? null,
    ad_spend_presale: allocation?.ad_spend_presale ?? null,
    google_ads_spend: null,
  };
}

function addl(event_id: string, amount: number | null): AdditionalSpendRow {
  return {
    event_id,
    date: "2020-01-01",
    amount: amount ?? 0,
    category: "OTHER",
    scope: "event",
    venue_event_code: null,
  };
}

function venueAddl(
  event_id: string,
  amount: number | null,
  venue_event_code: string,
): AdditionalSpendRow {
  return {
    event_id,
    date: "2020-01-01",
    amount: amount ?? 0,
    category: "OTHER",
    scope: "venue",
    venue_event_code,
  };
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

  it("uses allocator spend for multi-event codes and raw spend for solo events", () => {
    const events = [
      ev({
        id: "multi-a",
        event_code: "WC26-MANCHESTER",
        latest_snapshot: { tickets_sold: 10, revenue: 300 },
      }),
      ev({
        id: "multi-b",
        event_code: "WC26-MANCHESTER",
        latest_snapshot: { tickets_sold: 10, revenue: 300 },
      }),
      ev({
        id: "multi-c",
        event_code: "WC26-MANCHESTER",
        latest_snapshot: { tickets_sold: 10, revenue: 300 },
      }),
      ev({
        id: "multi-d",
        event_code: "WC26-MANCHESTER",
        latest_snapshot: { tickets_sold: 10, revenue: 300 },
      }),
      ev({
        id: "solo-leeds",
        event_code: "LEEDS-FA-CUP",
        latest_snapshot: { tickets_sold: 5, revenue: 150 },
      }),
    ];
    const rollups: DailyRollupRow[] = [
      // Raw Meta spend is duplicated across the four shared-code rows.
      rollup("multi-a", 100, { ad_spend_allocated: 25 }),
      rollup("multi-b", 100, { ad_spend_allocated: 25 }),
      rollup("multi-c", 100, { ad_spend_allocated: 25 }),
      rollup("multi-d", 100, { ad_spend_allocated: 25 }),
      // Solo events are skipped by the venue allocator, so raw spend is valid.
      rollup("solo-leeds", 50),
    ];

    const t = aggregateClientWideTotals(events, rollups, []);

    assert.equal(t.adSpend, 150);
    assert.equal(t.totalSpend, 150);
    assert.equal(t.ticketRevenue, 1350);
    assert.equal(t.roas, 9);
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

  it("sums TikTok-only spend into paid media, CPT, and ROAS", () => {
    const events = [
      ev({
        id: "black-butter",
        latest_snapshot: { tickets_sold: 20, revenue: 640 },
      }),
    ];
    const t = aggregateClientWideTotals(
      events,
      [rollup("black-butter", null, { tiktok_spend: 160 })],
      [],
    );

    assert.equal(t.adSpend, 160);
    assert.equal(t.totalSpend, 160);
    assert.equal(t.cpt, 8);
    assert.equal(t.roas, 4);
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

  it("marketingBudget is null when no event carries a budget_marketing value", () => {
    const t = aggregateClientWideTotals(
      [ev({ id: "a" }), ev({ id: "b" })],
      [],
      [],
    );
    assert.equal(t.marketingBudget, null);
    assert.equal(t.marketingSpend, 0);
  });

  it("marketingBudget dedupes shared venue budget_marketing by event_code", () => {
    const events = [
      ev({ id: "a", event_code: "VENUE-A", budget_marketing: 1000 }),
      ev({ id: "b", event_code: "VENUE-A", budget_marketing: 1000 }),
      ev({ id: "c", event_code: "VENUE-B", budget_marketing: 2500 }),
      ev({ id: "solo", budget_marketing: 750 }),
      ev({ id: "empty", budget_marketing: null }),
    ];
    const rollups = [
      rollup("a", 200, { ad_spend_allocated: 200 }),
      rollup("b", 100, { ad_spend_allocated: 100 }),
    ];
    const additional = [addl("a", 50)];

    const t = aggregateClientWideTotals(events, rollups, additional);
    assert.equal(t.marketingBudget, 4250);
    // marketingSpend == adSpend + additionalSpend + preregSpend (totalSpend
    // without the extra shared-campaign bucket — none supplied here).
    assert.equal(t.marketingSpend, t.totalSpend);
    assert.equal(t.marketingSpend, 350);
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

  it("uses TikTok-only spend for venue paid media totals", () => {
    const events = [
      ev({
        id: "black-butter",
        event_date: TODAY,
        latest_snapshot: { tickets_sold: 16, revenue: 640 },
      }),
    ];
    const t = aggregateVenueGroupTotals(
      events,
      [rollup("black-butter", null, { tiktok_spend: 160 })],
      [],
      TODAY,
    );

    assert.equal(t.adSpend, 160);
    assert.equal(t.totalSpend, 160);
    assert.equal(t.cpt, 10);
    assert.equal(t.roas, 4);
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

describe("aggregateVenueCampaignPerformance", () => {
  const TODAY = "2026-04-28";

  it("aggregates budgets, additional spend, tickets, sell-through, CPT, and pacing", () => {
    const events = [
      ev({
        id: "a",
        event_code: "WC26-BOURNEMOUTH",
        event_date: "2026-06-01",
        budget_marketing: 2500,
        capacity: 1000,
        latest_snapshot: { tickets_sold: 300, revenue: 3000 },
      }),
      ev({
        id: "b",
        event_code: "WC26-BOURNEMOUTH",
        event_date: "2026-06-15",
        budget_marketing: 3000,
        capacity: 800,
        tickets_sold: 200,
        latest_snapshot: null,
      }),
    ];
    const additional = [
      addl("a", 125),
      venueAddl("a", 75, "WC26-BOURNEMOUTH"),
      venueAddl("a", 999, "WC26-OTHER"),
      addl("outside", 999),
    ];
    const rollups = [rollup("a", 100), rollup("b", 200)];

    const t = aggregateVenueCampaignPerformance(
      events,
      additional,
      rollups,
      TODAY,
    );

    assert.equal(t.paidMediaBudget, 3000);
    assert.equal(t.additionalSpend, 200);
    assert.equal(t.totalMarketingBudget, 3200);
    assert.equal(t.paidMediaSpent, 300);
    assert.equal(t.paidMediaRemaining, 2700);
    assert.equal(t.paidMediaUsedPct, (300 / 3000) * 100);
    assert.equal(t.ticketsSold, 500);
    assert.equal(t.capacity, 1800);
    assert.equal(t.sellThroughPct, (500 / 1800) * 100);
    assert.equal(t.costPerTicket, 300 / 500);
    assert.equal(t.earliestEventDate, "2026-06-01");
    assert.equal(t.pacingTicketsPerDay, Math.round(1300 / 34));
    assert.equal(t.pacingSpendPerDay, Math.round(2700 / 34));
    assert.equal(t.dailyBudget, null);
  });

  it("uses the earliest upcoming event_date for venue pacing and ignores past dates", () => {
    const events = [
      ev({
        id: "past",
        event_code: "WC26-MANCHESTER",
        event_date: "2026-04-20",
        budget_marketing: 16000,
        capacity: 0,
        latest_snapshot: { tickets_sold: 0, revenue: null },
      }),
      ev({
        id: "future",
        event_code: "WC26-MANCHESTER",
        event_date: "2026-06-27",
        budget_marketing: 16000,
        capacity: 16000,
        latest_snapshot: { tickets_sold: 878, revenue: null },
      }),
    ];

    const t = aggregateVenueCampaignPerformance(
      events,
      [],
      [rollup("future", 1000)],
      TODAY,
      1000,
    );

    console.info("[pacing-test] Manchester tickets/day", t.pacingTicketsPerDay);
    assert.equal(t.earliestEventDate, "2026-06-27");
    assert.equal(t.pacingTicketsPerDay, 252);
    assert.equal(t.pacingSpendPerDay, 250);
  });

  it("normalizes timestamp-shaped event_date values before pacing comparison", () => {
    const t = aggregateVenueCampaignPerformance(
      [
        ev({
          id: "future-timestamp",
          event_code: "WC26-MANCHESTER",
          event_date: "2026-06-27T00:00:00+00:00",
          budget_marketing: 16000,
          capacity: 16000,
          latest_snapshot: { tickets_sold: 878, revenue: null },
        }),
      ],
      [],
      [rollup("future-timestamp", 1000)],
      TODAY,
      1000,
    );

    assert.equal(t.earliestEventDate, "2026-06-27");
    assert.equal(t.pacingTicketsPerDay, 252);
  });

  it("returns null pacing when every venue event date is in the past", () => {
    const t = aggregateVenueCampaignPerformance(
      [
        ev({
          id: "past",
          event_date: "2026-04-20",
          budget_marketing: 1000,
          capacity: 1000,
          latest_snapshot: { tickets_sold: 100, revenue: null },
        }),
      ],
      [],
      [rollup("past", 100)],
      TODAY,
    );

    assert.equal(t.earliestEventDate, null);
    assert.equal(t.pacingTicketsPerDay, null);
    assert.equal(t.pacingSpendPerDay, null);
  });

  it("uses a documented 90-day pacing window when every venue event date is null", () => {
    const t = aggregateVenueCampaignPerformance(
      [
        ev({
          id: "manchester-croatia",
          event_code: "WC26-MANCHESTER",
          event_date: null,
          budget_marketing: 16000,
          capacity: 8000,
          latest_snapshot: { tickets_sold: 500, revenue: null },
        }),
        ev({
          id: "manchester-ghana",
          event_code: "WC26-MANCHESTER",
          event_date: null,
          budget_marketing: 16000,
          capacity: 8000,
          latest_snapshot: { tickets_sold: 400, revenue: null },
        }),
      ],
      [],
      [rollup("manchester-croatia", 1000), rollup("manchester-ghana", 1000)],
      TODAY,
      3359,
    );

    assert.equal(t.earliestEventDate, null);
    assert.equal(t.pacingTicketsPerDay, Math.round((16000 - 900) / 90));
    assert.equal(t.pacingSpendPerDay, Math.round((16000 - 3359) / 90));
  });

  it("uses the displayed venue Meta spend override when supplied", () => {
    const events = [
      ev({
        id: "a",
        event_code: "WC26-BOURNEMOUTH",
        event_date: "2026-06-01",
        budget_marketing: 10125,
        capacity: 1000,
        latest_snapshot: { tickets_sold: 568, revenue: null },
      }),
    ];

    const t = aggregateVenueCampaignPerformance(
      events,
      [],
      [rollup("a", 9999)],
      TODAY,
      2594,
    );

    assert.equal(t.paidMediaBudget, 10125);
    assert.equal(t.paidMediaSpent, 2594);
    assert.equal(t.paidMediaUsedPct, (2594 / 10125) * 100);
    assert.equal(t.costPerTicket, 2594 / 568);
  });

  it("aggregates TikTok-only rollups into the venue Paid Media card", () => {
    const events = [
      ev({
        id: "black-butter",
        event_code: "BB26",
        event_date: "2026-06-01",
        budget_marketing: 500,
        capacity: 100,
        latest_snapshot: { tickets_sold: 20, revenue: 640 },
      }),
    ];

    const t = aggregateVenueCampaignPerformance(
      events,
      [],
      [rollup("black-butter", null, { tiktok_spend: 160 })],
      TODAY,
    );

    assert.equal(t.paidMediaSpent, 160);
    assert.equal(t.paidMediaRemaining, 340);
    assert.equal(t.paidMediaUsedPct, 32);
    assert.equal(t.costPerTicket, 8);
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
    assert.equal(a.paidMedia, 180);
    assert.equal(a.specific, 80);
    assert.equal(a.genericShare, 100);
    assert.equal(a.daysCovered, 2);

    const b = map.get("b")!;
    assert.equal(b.allocated, 60);
    assert.equal(b.paidMedia, 60);
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
    assert.equal(a.paidMedia, 50);
    assert.equal(a.specific, 20);
    assert.equal(a.genericShare, 30);
    assert.equal(a.daysCovered, 1);
  });

  it("includes presale allocation in paidMedia without changing allocated", () => {
    const rows: DailyRollupRow[] = [
      rollup("a", 120, {
        ad_spend_allocated: 80,
        ad_spend_specific: 30,
        ad_spend_generic_share: 50,
        ad_spend_presale: 40,
      }),
      rollup("a", 60, {
        ad_spend_allocated: 20,
        ad_spend_specific: 0,
        ad_spend_generic_share: 20,
        ad_spend_presale: 40,
      }),
    ];

    const map = aggregateAllocationByEvent(rows);
    const a = map.get("a")!;
    assert.equal(a.allocated, 100);
    assert.equal(a.presale, 80);
    assert.equal(a.paidMedia, 180);
    assert.equal(a.daysCovered, 2);
    assert.equal(a.daysCoveredPresale, 2);
  });
});

describe("aggregateVenueWoW", () => {
  // Anchor every test to 2026-04-27 so the WoW windows are:
  //   current:  2026-04-21 .. 2026-04-27 (7 days, inclusive)
  //   previous: 2026-04-14 .. 2026-04-20 (7 days, inclusive)
  const TODAY = "2026-04-27";

  /**
   * Default two-event fixture. Events carry a cumulative
   * `latest_snapshot.tickets_sold`; tests that want to exercise the
   * "no cumulative baseline" path override with a plain `ev({ id })`.
   */
  function eventsWithCumulative(a: number, b: number) {
    return [
      ev({ id: "a", latest_snapshot: { tickets_sold: a, revenue: null } }),
      ev({ id: "b", latest_snapshot: { tickets_sold: b, revenue: null } }),
    ];
  }

  it("prefers weekly-snapshot cumulative for the previous edge when available", () => {
    const events = eventsWithCumulative(200, 100); // current = 300 total
    const rollups: DailyRollupRow[] = [
      // Current window — £300 spend across two events, incremental
      // tickets sum to 100 (matches current - previous = 300 - 200).
      rollup("a", 100, { date: "2026-04-22", tickets_sold: 60 }),
      rollup("b", 200, { date: "2026-04-25", tickets_sold: 40 }),
      // Previous window — £400 spend, incremental tickets sum to 120
      // so the previous-window CPT denominator = 120.
      rollup("a", 300, { date: "2026-04-14", tickets_sold: 80 }),
      rollup("b", 100, { date: "2026-04-20", tickets_sold: 40 }),
    ];
    const snapshots = [
      // Each event's cumulative on the day just before the current
      // window opens. Sum = 200 → prev cumulative.
      { event_id: "a", snapshot_at: "2026-04-20", tickets_sold: 140, source: "eventbrite" },
      { event_id: "b", snapshot_at: "2026-04-20", tickets_sold: 60, source: "eventbrite" },
      { event_id: "a", snapshot_at: "2026-04-27", tickets_sold: 200, source: "eventbrite" },
      { event_id: "b", snapshot_at: "2026-04-27", tickets_sold: 100, source: "eventbrite" },
    ];

    const result = aggregateVenueWoW(events, rollups, TODAY, snapshots);

    // Cumulative today vs cumulative last week.
    assert.equal(result.tickets.current, 300);
    assert.equal(result.tickets.previous, 200);
    assert.equal(result.tickets.delta, 100);
    assert.equal(result.tickets.deltaPct, 50);

    // CPT compares cumulative spend/tickets now vs 7 days ago.
    assert.ok(result.cpt.current !== null);
    assert.ok(Math.abs(result.cpt.current! - 700 / 300) < 1e-9);
    assert.equal(result.cpt.previous, 700 / 200);
    assert.ok(result.cpt.delta !== null);
    assert.ok(Math.abs(result.cpt.delta! - (700 / 300 - 700 / 200)) < 1e-9);
    assert.ok(result.cpt.deltaPct !== null);
    assert.ok(
      Math.abs(
        result.cpt.deltaPct! - ((700 / 300 - 700 / 200) / (700 / 200)) * 100,
      ) < 1e-9,
    );
  });

  it("falls back to (current − last-7-day rollup sum) when no snapshot before the window edge", () => {
    const events = eventsWithCumulative(500, 0);
    const rollups: DailyRollupRow[] = [
      // Last 7 days: rollup tickets sum to 80 → previous cumulative
      // derives to 500 − 80 = 420. No weekly snapshot older than
      // 2026-04-20 in this fixture, so the fallback path triggers.
      rollup("a", 50, { date: "2026-04-25", tickets_sold: 80 }),
    ];
    const result = aggregateVenueWoW(events, rollups, TODAY);
    assert.equal(result.tickets.current, 500);
    assert.equal(result.tickets.previous, 420);
    assert.equal(result.tickets.delta, 80);
  });

  it("suppresses the delta when the derived previous exceeds current (monotonic guard)", () => {
    // Simulates the Leeds FA Cup SF regression from PR 2's brief:
    // current cumulative 1,091, a spurious "previous" of 1,783
    // coming in from a cross-source contamination. The aggregator
    // must refuse to render -692 rather than paper it over.
    const events = [
      ev({
        id: "leeds",
        latest_snapshot: { tickets_sold: 1091, revenue: null },
      }),
    ];
    const snapshots = [
      {
        event_id: "leeds",
        snapshot_at: "2026-04-20",
        tickets_sold: 1783,
        source: "xlsx_import",
      },
      {
        event_id: "leeds",
        snapshot_at: "2026-04-27",
        tickets_sold: 1091,
        source: "eventbrite",
      },
    ];
    const result = aggregateVenueWoW(events, [], TODAY, snapshots);
    // current still renders (the main header number is safe).
    assert.equal(result.tickets.current, 1091);
    // previous suppressed so the parenthetical hides.
    assert.equal(result.tickets.previous, null);
    assert.equal(result.tickets.delta, null);
    assert.equal(result.tickets.deltaPct, null);
  });

  it("clamps negative rollup tickets_sold values in the windows", () => {
    // A contaminated rollup day with negative tickets (possible after
    // a bad sync / reconciliation) must not drag CPT denominators
    // below zero or let the cumulative-fallback produce a previous
    // > current.
    const events = eventsWithCumulative(100, 0);
    const rollups: DailyRollupRow[] = [
      rollup("a", 40, { date: "2026-04-22", tickets_sold: 20 }),
      rollup("a", 60, { date: "2026-04-23", tickets_sold: -999 }),
    ];
    const result = aggregateVenueWoW(events, rollups, TODAY);
    // Fallback: previous = 100 − 20 = 80 (negative row clamped).
    assert.equal(result.tickets.previous, 80);
    assert.equal(result.tickets.delta, 20);
  });

  it("surfaces current cumulative but nulls the delta when no previous source is available", () => {
    const events = eventsWithCumulative(100, 0);
    const rollups: DailyRollupRow[] = [];
    const result = aggregateVenueWoW(events, rollups, TODAY);
    // With no rollup window data AND no snapshots, previous
    // cumulative can't be derived → delta hides, current stays.
    assert.equal(result.tickets.current, 100);
    assert.equal(result.tickets.previous, null);
    assert.equal(result.tickets.delta, null);
  });

  it("ignores rollup rows outside either window", () => {
    const events = eventsWithCumulative(100, 0);
    const rollups: DailyRollupRow[] = [
      // Inside current window — contributes 10 tickets.
      rollup("a", 100, { date: "2026-04-25", tickets_sold: 10 }),
      // Inside previous window — ignored for ticket math but spend
      // feeds the prev-CPT denominator.
      rollup("a", 100, { date: "2026-04-15", tickets_sold: 10 }),
      // Too old — more than 13 days back.
      rollup("a", 9999, { date: "2026-04-01", tickets_sold: 9999 }),
      // Future-dated.
      rollup("a", 9999, { date: "2026-05-10", tickets_sold: 9999 }),
    ];
    const result = aggregateVenueWoW(events, rollups, TODAY);
    // Previous cumulative via fallback = 100 − 10 = 90.
    assert.equal(result.tickets.current, 100);
    assert.equal(result.tickets.previous, 90);
    assert.equal(result.tickets.delta, 10);
  });

  it("ignores rollup + snapshot rows for events outside the group", () => {
    const events = eventsWithCumulative(100, 0);
    const rollups: DailyRollupRow[] = [
      rollup("a", 100, { date: "2026-04-22", tickets_sold: 20 }),
      rollup("outsider", 9999, { date: "2026-04-23", tickets_sold: 9999 }),
    ];
    const snapshots = [
      { event_id: "a", snapshot_at: "2026-04-20", tickets_sold: 80, source: "eventbrite" },
      { event_id: "a", snapshot_at: "2026-04-27", tickets_sold: 100, source: "eventbrite" },
      { event_id: "outsider", snapshot_at: "2026-04-20", tickets_sold: 9999, source: "eventbrite" },
    ];
    const result = aggregateVenueWoW(events, rollups, TODAY, snapshots);
    assert.equal(result.tickets.current, 100);
    assert.equal(result.tickets.previous, 80);
  });

  it("returns null halves for an empty event list", () => {
    const result = aggregateVenueWoW([], [], TODAY);
    assert.equal(result.tickets.delta, null);
    assert.equal(result.cpt.delta, null);
    assert.equal(result.roas.delta, null);
  });

  it("prefers latest-at-or-before when multiple snapshots exist before the window edge", () => {
    const events = eventsWithCumulative(100, 0);
    const snapshots = [
      { event_id: "a", snapshot_at: "2026-04-10", tickets_sold: 50, source: "eventbrite" },
      // Closer to the window edge — should win.
      { event_id: "a", snapshot_at: "2026-04-19", tickets_sold: 75, source: "eventbrite" },
      // After the window edge — must be ignored.
      { event_id: "a", snapshot_at: "2026-04-22", tickets_sold: 90, source: "eventbrite" },
      // Latest current edge — drives current tickets.
      { event_id: "a", snapshot_at: "2026-04-27", tickets_sold: 100, source: "eventbrite" },
    ];
    const result = aggregateVenueWoW(events, [], TODAY, snapshots);
    assert.equal(result.tickets.previous, 75);
    assert.equal(result.tickets.delta, 25);
  });

  it("prefers the latest ticket_sales_snapshots row over a stale event value for current tickets", () => {
    const events = [
      ev({
        id: "leeds",
        tickets_sold: 1091,
        latest_snapshot: { tickets_sold: 1091, revenue: null },
      }),
    ];
    const snapshots = [
      {
        event_id: "leeds",
        snapshot_at: "2026-04-20",
        tickets_sold: 1142,
        source: "eventbrite",
      },
      {
        event_id: "leeds",
        snapshot_at: "2026-04-27",
        tickets_sold: 1219,
        source: "eventbrite",
      },
    ];
    const result = aggregateVenueWoW(events, [], TODAY, snapshots);
    assert.equal(result.tickets.current, 1219);
    assert.equal(result.tickets.previous, 1142);
    assert.equal(result.tickets.delta, 77);
  });

  it("computes frozen-spend CPT delta with snapshot-preferred previous tickets", () => {
    const events = eventsWithCumulative(570, 0);
    const rollups: DailyRollupRow[] = [
      rollup("a", 600, { date: "2026-04-18" }),
      rollup("a", 300, { date: "2026-04-21" }),
      rollup("a", 35, { date: "2026-04-24" }),
    ];
    const snapshots = [
      {
        event_id: "a",
        snapshot_at: "2026-04-20",
        tickets_sold: 566,
        source: "eventbrite",
      },
      {
        event_id: "a",
        snapshot_at: "2026-04-27",
        tickets_sold: 570,
        source: "eventbrite",
      },
    ];

    const result = aggregateVenueWoW(events, rollups, TODAY, snapshots);

    const current = 935 / 570;
    const previous = 935 / 566;
    assert.ok(result.cpt.current !== null);
    assert.ok(Math.abs(result.cpt.current! - current) < 1e-9);
    assert.equal(result.cpt.previous, previous);
    assert.ok(result.cpt.delta !== null);
    assert.ok(Math.abs(result.cpt.delta! - (current - previous)) < 1e-9);
  });

  it("computes frozen-spend CPT delta with rollup-fallback previous tickets", () => {
    const events = eventsWithCumulative(570, 0);
    const rollups: DailyRollupRow[] = [
      rollup("a", 600, { date: "2026-04-18" }),
      rollup("a", 300, { date: "2026-04-21", tickets_sold: 2 }),
      rollup("a", 35, { date: "2026-04-24", tickets_sold: 2 }),
    ];

    const result = aggregateVenueWoW(events, rollups, TODAY);

    const previousTickets = 566;
    const current = 935 / 570;
    const previous = 935 / previousTickets;
    assert.equal(result.tickets.previous, previousTickets);
    assert.ok(result.cpt.current !== null);
    assert.ok(Math.abs(result.cpt.current! - current) < 1e-9);
    assert.equal(result.cpt.previous, previous);
    assert.ok(result.cpt.delta !== null);
    assert.ok(Math.abs(result.cpt.delta! - (current - previous)) < 1e-9);
  });

  it("nulls CPT delta when the previous ticket edge is missing", () => {
    const events = eventsWithCumulative(570, 0);
    const rollups: DailyRollupRow[] = [
      rollup("a", 300, {
        date: "2026-04-24",
        revenue: 900,
      }),
    ];

    const result = aggregateVenueWoW(events, rollups, TODAY);

    assert.equal(result.tickets.previous, null);
    assert.ok(result.cpt.current !== null);
    assert.equal(result.cpt.previous, null);
    assert.equal(result.cpt.delta, null);
  });

  it("freezes ROAS at the current edge so collapsed and expanded views align", () => {
    const events = eventsWithCumulative(570, 0);
    const rollups: DailyRollupRow[] = [
      rollup("a", 600, { date: "2026-04-18", revenue: 1200 }),
      rollup("a", 300, { date: "2026-04-21", tickets_sold: 2, revenue: 450 }),
      rollup("a", 35, { date: "2026-04-24", tickets_sold: 2, revenue: 150 }),
    ];

    const result = aggregateVenueWoW(events, rollups, TODAY);

    const current = 1800 / 935;
    assert.ok(result.roas.current !== null);
    assert.ok(Math.abs(result.roas.current! - current) < 1e-9);
    assert.equal(result.roas.previous, current);
    assert.equal(result.roas.delta, 0);
  });

  it("nulls ROAS delta when the current revenue/spend edge is missing", () => {
    const events = eventsWithCumulative(570, 0);
    const rollups: DailyRollupRow[] = [
      rollup("a", 300, { date: "2026-04-24", tickets_sold: 4 }),
    ];

    const result = aggregateVenueWoW(events, rollups, TODAY);

    assert.equal(result.roas.current, null);
    assert.equal(result.roas.previous, null);
    assert.equal(result.roas.delta, null);
  });
});
