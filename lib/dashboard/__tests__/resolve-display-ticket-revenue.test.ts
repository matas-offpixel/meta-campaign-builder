import assert from "node:assert/strict";
import test from "node:test";

import type { EventTicketTierRow } from "../../db/ticketing.ts";

import {
  perTierDisplayTicketRevenue,
  resolveDisplayTicketRevenue,
} from "../tier-channel-rollups.ts";

test("Brighton Croatia-style: CP channel slice + remainder × price", () => {
  const tier = {
    id: "t1",
    event_id: "e1",
    tier_name: "Croatia GA",
    price: 6,
    quantity_sold: 671,
    quantity_available: 5000,
    snapshot_at: "2026-01-01",
    channel_breakdowns: [
      {
        channel_id: "cp",
        channel_name: "CP",
        display_label: "CP",
        is_automatic: false,
        allocation_count: null,
        tickets_sold: 70,
        revenue_amount: 564,
        revenue_overridden: false,
      },
    ],
  } satisfies EventTicketTierRow;

  const expected = 564 + (671 - 70) * 6;
  assert.equal(perTierDisplayTicketRevenue(tier), expected);

  const total = resolveDisplayTicketRevenue({
    ticket_tiers: [tier],
    latest_snapshot_revenue: null,
  });
  assert.equal(total, expected);
});

test("when channel rows cover all tier quantity_sold, only channel revenue counts", () => {
  const tier = {
    id: "t2",
    event_id: "e1",
    tier_name: "VIP",
    price: 50,
    quantity_sold: 2,
    quantity_available: 100,
    snapshot_at: "2026-01-01",
    channel_breakdowns: [
      {
        channel_id: "v",
        channel_name: "Venue",
        display_label: "Venue",
        is_automatic: false,
        allocation_count: 50,
        tickets_sold: 2,
        revenue_amount: 471.5,
        revenue_overridden: false,
      },
    ],
  } satisfies EventTicketTierRow;

  assert.equal(
    resolveDisplayTicketRevenue({ ticket_tiers: [tier], latest_snapshot_revenue: 0 }),
    471.5,
  );
});

test("no channel rows: full tier.quantity_sold × price", () => {
  const tier = {
    id: "t3",
    event_id: "e1",
    tier_name: "GA",
    price: 10,
    quantity_sold: 5,
    quantity_available: 100,
    snapshot_at: "2026-01-01",
    channel_breakdowns: [],
  } satisfies EventTicketTierRow;

  assert.equal(perTierDisplayTicketRevenue(tier), 50);
});

test("empty tiers falls back to positive snapshot revenue", () => {
  assert.equal(
    resolveDisplayTicketRevenue({
      ticket_tiers: [],
      latest_snapshot_revenue: 1250,
    }),
    1250,
  );
});
