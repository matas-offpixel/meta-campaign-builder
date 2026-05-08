import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EventTicketTierRow } from "../../db/ticketing.ts";
import {
  resolveDisplayTicketCount,
  resolveDisplayTicketRevenue,
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
