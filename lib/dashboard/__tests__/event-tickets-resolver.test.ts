import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EventTicketTierRow } from "../../db/ticketing.ts";
import {
  resolveDisplayTicketCount,
  resolveDisplayTicketRevenue,
  resolvePortalEventTicketCount,
} from "../tier-channel-rollups.ts";

function tier(overrides: Partial<EventTicketTierRow> = {}): EventTicketTierRow {
  return {
    id: "tier-1",
    event_id: "event-1",
    tier_name: "General Admission",
    price: 10,
    quantity_sold: 0,
    quantity_available: null,
    snapshot_at: "2026-05-08T00:00:00.000Z",
    channel_breakdowns: [],
    ...overrides,
  };
}

describe("display ticket resolver", () => {
  it("uses tier-channel tickets when they exceed the latest snapshot", () => {
    assert.equal(
      resolveDisplayTicketCount({
        ticket_tiers: [tier({ quantity_sold: 356 })],
        latest_snapshot_tickets: 246,
      }),
      356,
    );
  });

  it("uses latest snapshot tickets when live fourthefans is ahead", () => {
    assert.equal(
      resolveDisplayTicketCount({
        ticket_tiers: [tier({ quantity_sold: 540 })],
        latest_snapshot_tickets: 600,
      }),
      600,
    );
  });

  it("falls back to snapshot tickets when tier-channel sales are empty", () => {
    assert.equal(
      resolveDisplayTicketCount({
        ticket_tiers: [],
        latest_snapshot_tickets: 699,
      }),
      699,
    );
  });

  it("returns zero when both snapshot and tier-channel sources are empty", () => {
    assert.equal(
      resolveDisplayTicketCount({
        ticket_tiers: [],
        latest_snapshot_tickets: 0,
      }),
      0,
    );
  });

  // Manchester WC26 regression: tier_tiers=699 (4TF write target),
  // snapshot=699 (same source), tier_channel_sales=1362 (4TF+Venue).
  // Math.max must pick 1362 not 699.
  it("picks tier_channel_sales_sum when it exceeds both snapshot and tier-rollup (Manchester WC26 scenario)", () => {
    assert.equal(
      resolveDisplayTicketCount({
        ticket_tiers: [tier({ quantity_sold: 699 })],
        latest_snapshot_tickets: 699,
        fallback_tickets: null,
        tier_channel_sales_sum: 1362,
      }),
      1362,
    );
  });

  it("ignores tier_channel_sales_sum when null (no multi-channel rows)", () => {
    assert.equal(
      resolveDisplayTicketCount({
        ticket_tiers: [tier({ quantity_sold: 356 })],
        latest_snapshot_tickets: 246,
        tier_channel_sales_sum: null,
      }),
      356,
    );
  });

  it("picks tier_channel_sales_sum over snapshot when tiers are empty (no tier rows)", () => {
    assert.equal(
      resolveDisplayTicketCount({
        ticket_tiers: [],
        latest_snapshot_tickets: 500,
        tier_channel_sales_sum: 800,
      }),
      800,
    );
  });

  it("uses tier-channel revenue when it exceeds snapshot revenue", () => {
    assert.equal(
      resolveDisplayTicketRevenue({
        ticket_tiers: [tier({ quantity_sold: 356, price: 8.62 })],
        latest_snapshot_revenue: 2120,
      }),
      3068.72,
    );
  });

  it("uses snapshot revenue when live fourthefans is ahead", () => {
    assert.equal(
      resolveDisplayTicketRevenue({
        ticket_tiers: [tier({ quantity_sold: 540, price: 8 })],
        latest_snapshot_revenue: 4984,
      }),
      4984,
    );
  });
});

describe("portal event ticket resolver", () => {
  // D.O.D regression: ticketing "Not linked", so no tiers and no
  // snapshot, but 557 typed into events.tickets_sold. The Tickets card
  // read that column; the event-breakdown row short-circuited on the
  // empty tier list and printed 0 for the same event on the same page.
  it("reads events.tickets_sold for a tier-less, unlinked event", () => {
    assert.equal(
      resolvePortalEventTicketCount({
        ticket_tiers: [],
        latest_snapshot: null,
        tickets_sold: 557,
        tier_channel_sales_tickets: null,
      }),
      557,
    );
  });

  it("agrees with the tiered resolver when the event has tiers", () => {
    const event = {
      ticket_tiers: [tier({ quantity_sold: 699 })],
      latest_snapshot: { tickets_sold: 699 },
      tickets_sold: null,
      tier_channel_sales_tickets: 1362,
    };
    assert.equal(resolvePortalEventTicketCount(event), 1362);
    assert.equal(
      resolvePortalEventTicketCount(event),
      resolveDisplayTicketCount({
        ticket_tiers: event.ticket_tiers,
        latest_snapshot_tickets: event.latest_snapshot.tickets_sold,
        fallback_tickets: event.tickets_sold,
        tier_channel_sales_sum: event.tier_channel_sales_tickets,
      }),
    );
  });

  // Null, not 0 — the venue card sums the daily rollups when no event
  // carries a count, and a fabricated 0 would suppress that fallback.
  it("returns null when no source carries a count at all", () => {
    assert.equal(
      resolvePortalEventTicketCount({
        ticket_tiers: [],
        latest_snapshot: null,
        tickets_sold: null,
        tier_channel_sales_tickets: null,
      }),
      null,
    );
  });

  it("keeps a real zero distinct from an absent count", () => {
    assert.equal(
      resolvePortalEventTicketCount({
        ticket_tiers: [],
        latest_snapshot: { tickets_sold: 0 },
        tickets_sold: null,
        tier_channel_sales_tickets: null,
      }),
      0,
    );
  });
});
