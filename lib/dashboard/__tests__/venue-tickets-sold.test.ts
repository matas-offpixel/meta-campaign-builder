/**
 * lib/dashboard/__tests__/venue-tickets-sold.test.ts
 *
 * Regression tests for resolveVenueTicketsSold (#489).
 *
 * Scenarios:
 *   1. Single-channel venue — returns events.tickets_sold (no regression)
 *   2. Multi-channel venue — picks tier_channel_sales when higher
 *   3. Snapshot higher than tier_channel_sales — picks snapshot
 *   4. Multi-fixture venue sum (Manchester pattern)
 *   5. Sold-out venue — math doesn't break at remaining = 0
 *   6. Empty events array — returns 0
 *   7. Glasgow SWG3 pattern — large TCS gap detected
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveVenueTicketsSold } from "../venue-tickets-sold.ts";

/** Minimal mock event — ticket_tiers empty (tierTickets = 0). */
function ev({
  tickets_sold = null,
  tcs = null,
  snapshot = null,
}: {
  tickets_sold?: number | null;
  tcs?: number | null;
  snapshot?: number | null;
}) {
  return {
    tickets_sold,
    ticket_tiers: [] as never[],
    latest_snapshot: snapshot != null ? { tickets_sold: snapshot } : null,
    tier_channel_sales_tickets: tcs,
  };
}

describe("resolveVenueTicketsSold", () => {
  it("empty events → 0", () => {
    assert.equal(resolveVenueTicketsSold([]), 0);
  });

  it("single-channel venue: returns events.tickets_sold when no TCS rows", () => {
    // UTB pattern: no tier_channel_sales, no snapshot
    const result = resolveVenueTicketsSold([
      ev({ tickets_sold: 1_200 }),
    ]);
    assert.equal(result, 1_200);
  });

  it("multi-channel: picks tier_channel_sales when higher than events.tickets_sold", () => {
    // Manchester Croatia: events.ts=295, TCS=465
    const result = resolveVenueTicketsSold([
      ev({ tickets_sold: 295, tcs: 465 }),
    ]);
    assert.equal(result, 465);
  });

  it("snapshot higher than TCS: picks snapshot", () => {
    // Venue with a large manual snapshot import
    const result = resolveVenueTicketsSold([
      ev({ tickets_sold: 400, tcs: 465, snapshot: 500 }),
    ]);
    assert.equal(result, 500);
  });

  it("multi-fixture sum — Manchester: 849 → 1,348", () => {
    // SQL-verified values (2026-05-29):
    // Croatia: events.ts=295, TCS=465
    // Ghana:   events.ts=99,  TCS=116
    // Panama:  events.ts=412, TCS=724
    // Last 32: events.ts=43,  TCS=43
    const events = [
      ev({ tickets_sold: 295, tcs: 465 }),
      ev({ tickets_sold: 99, tcs: 116 }),
      ev({ tickets_sold: 412, tcs: 724 }),
      ev({ tickets_sold: 43, tcs: 43 }),
    ];
    assert.equal(resolveVenueTicketsSold(events), 465 + 116 + 724 + 43);
    assert.equal(resolveVenueTicketsSold(events), 1_348);
    // Confirms +499 uplift vs old events.tickets_sold SUM of 849
    const oldSum = events.reduce((s, e) => s + (e.tickets_sold ?? 0), 0);
    assert.equal(oldSum, 849);
    assert.equal(resolveVenueTicketsSold(events) - oldSum, 499);
  });

  it("Edinburgh: no change (TCS ≤ events.tickets_sold)", () => {
    // Edinburgh's TCS either doesn't exist or is ≤ events.tickets_sold;
    // the old sum and new sum must be identical.
    const events = [
      ev({ tickets_sold: 1_803 }),
      ev({ tickets_sold: 1_372 }),
      ev({ tickets_sold: 681 }),
    ];
    const expected = 1_803 + 1_372 + 681; // = 3_856
    assert.equal(resolveVenueTicketsSold(events), expected);
  });

  it("Glasgow SWG3 pattern: TCS surfaces +728 box-office tickets", () => {
    // Verified via Supabase: events.ts=2,570, TCS-based=3,298
    // We model this as a single-fixture event (simplified):
    const result = resolveVenueTicketsSold([
      ev({ tickets_sold: 2_570, tcs: 3_298 }),
    ]);
    assert.equal(result, 3_298);
    assert.equal(result - 2_570, 728);
  });

  it("sold-out: returns capacity without NaN or Infinity", () => {
    // capacity = ticketsSold → ticketsRemaining = 0 in canonical builder
    const result = resolveVenueTicketsSold([
      ev({ tickets_sold: 5_000, tcs: 5_000 }),
    ]);
    assert.equal(result, 5_000);
    assert.equal(Number.isFinite(result), true);
  });

  it("TCS = null: falls back to events.tickets_sold", () => {
    // Events that never had tier_channel_sales rows (e.g. new client)
    const result = resolveVenueTicketsSold([
      ev({ tickets_sold: 750, tcs: null }),
    ]);
    assert.equal(result, 750);
  });

  it("both null: returns 0 (safe default)", () => {
    const result = resolveVenueTicketsSold([
      ev({ tickets_sold: null, tcs: null }),
    ]);
    assert.equal(result, 0);
  });
});
