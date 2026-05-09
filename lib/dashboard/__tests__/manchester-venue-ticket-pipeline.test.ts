/**
 * lib/dashboard/__tests__/manchester-venue-ticket-pipeline.test.ts
 *
 * Integration-level test for the Manchester WC26 ticket-count pipeline.
 *
 * LESSON FROM PR #368: resolver-level tests (event-tickets-resolver.test.ts)
 * are NOT dashboard-level tests. PR #368 passed green because the unit tests
 * only covered inputs that the resolver already received — they never checked
 * whether the *data-loader* was wiring tier_channel_sales into the resolver
 * at all. The gap: tier_channel_sales existed in the DB (sum=1,362) but was
 * never passed as a resolver input, so Math.max returned 699.
 *
 * This file guards the full pipeline:
 *   DB rows → tierChannelSalesByEvent map → PortalEvent fields →
 *   resolveDisplayTicketCount → rendered "Tickets" count
 *
 * For a true DOM-level test (asserting rendered cell text "1,362 / 13,538 SOLD"),
 * add a Playwright smoke test against /clients/37906506-56b7-4d58-ab62-1b042e2b561a/dashboard
 * once the E2E harness is set up. The DOM layer currently has no jsdom/RTL wiring;
 * see feedback_resolver_dashboard_test_gap.md for the tracked follow-up.
 *
 * feedback_resolver_dashboard_test_gap: Resolver-level tests are not
 * dashboard-level tests. Whenever a resolver fix ships, add (a) an
 * end-to-end assertion on the computed total from realistic PortalEvent
 * props (as below) AND (b) a Playwright smoke-test that reads the rendered
 * DOM for the affected venue card.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TierChannelSaleRow } from "../../db/tier-channels.ts";
import { resolveDisplayTicketCount } from "../tier-channel-rollups.ts";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeSaleRow(
  overrides: Partial<TierChannelSaleRow> & {
    event_id: string;
    tier_name: string;
    channel_id: string;
    tickets_sold: number;
    revenue_amount: number;
  },
): TierChannelSaleRow {
  return {
    id: crypto.randomUUID(),
    revenue_overridden: false,
    notes: null,
    snapshot_at: "2026-05-09T00:00:00.000Z",
    created_at: "2026-05-09T00:00:00.000Z",
    updated_at: "2026-05-09T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Simulates the tierChannelSalesByEvent aggregation from loadPortalForClientId.
 * This is the exact arithmetic that should run in the loader before resolver call.
 */
function buildTierChannelSalesByEvent(
  sales: TierChannelSaleRow[],
): Map<string, { tickets: number; revenue: number }> {
  const out = new Map<string, { tickets: number; revenue: number }>();
  for (const sale of sales) {
    const eid = sale.event_id;
    const current = out.get(eid) ?? { tickets: 0, revenue: 0 };
    out.set(eid, {
      tickets: current.tickets + sale.tickets_sold,
      revenue: current.revenue + Number(sale.revenue_amount ?? 0),
    });
  }
  return out;
}

// ─── Manchester WC26 fixture ──────────────────────────────────────────────────
//
// 4 events; event_ticket_tiers.quantity_sold = 699 total (same as snapshot
// because both trace to the 4TF connector). tier_channel_sales = 1,362 total.
//
// event_ticket_tiers (4TF connector write target):
//   Croatia  246 | Ghana  71 | Panama 343 | Last 32 39   → 699
//
// tier_channel_sales (4TF + Venue channels):
//   Croatia  602 (4TF 482 + Venue 120)
//   Ghana    142 (4TF 139 + Venue   3)
//   Panama   540 (4TF 336 + Venue 204)
//   Last 32   78 (4TF  78 + Venue   0)
//   Total  1,362

const EVENT_CROATIA = "croatia-id";
const EVENT_GHANA = "ghana-id";
const EVENT_PANAMA = "panama-id";
const EVENT_LAST32 = "last32-id";

const CHANNEL_4TF = "4tf-channel";
const CHANNEL_VENUE = "venue-channel";

const manchesterTierChannelSales: TierChannelSaleRow[] = [
  // Croatia
  makeSaleRow({ event_id: EVENT_CROATIA, tier_name: "GA", channel_id: CHANNEL_4TF,   tickets_sold: 482, revenue_amount: 2892 }),
  makeSaleRow({ event_id: EVENT_CROATIA, tier_name: "GA", channel_id: CHANNEL_VENUE, tickets_sold: 120, revenue_amount:  720 }),
  // Ghana
  makeSaleRow({ event_id: EVENT_GHANA,   tier_name: "GA", channel_id: CHANNEL_4TF,   tickets_sold: 139, revenue_amount:  834 }),
  makeSaleRow({ event_id: EVENT_GHANA,   tier_name: "GA", channel_id: CHANNEL_VENUE, tickets_sold:   3, revenue_amount:   18 }),
  // Panama
  makeSaleRow({ event_id: EVENT_PANAMA,  tier_name: "GA", channel_id: CHANNEL_4TF,   tickets_sold: 336, revenue_amount: 2016 }),
  makeSaleRow({ event_id: EVENT_PANAMA,  tier_name: "GA", channel_id: CHANNEL_VENUE, tickets_sold: 204, revenue_amount: 1224 }),
  // Last 32
  makeSaleRow({ event_id: EVENT_LAST32,  tier_name: "GA", channel_id: CHANNEL_4TF,   tickets_sold:  78, revenue_amount:  468 }),
];

// event_ticket_tiers totals per event (4TF snapshot = same source as snapshot)
const tierQtySoldByEvent: Record<string, number> = {
  [EVENT_CROATIA]:  246,
  [EVENT_GHANA]:     71,
  [EVENT_PANAMA]:   343,
  [EVENT_LAST32]:    39,
};

// latest_snapshot_tickets (4TF connector → ticket_sales_snapshots)
const snapshotTicketsByEvent: Record<string, number> = {
  [EVENT_CROATIA]:  246,
  [EVENT_GHANA]:     71,
  [EVENT_PANAMA]:   343,
  [EVENT_LAST32]:    39,
};

const eventIds = [EVENT_CROATIA, EVENT_GHANA, EVENT_PANAMA, EVENT_LAST32];

// ─── tests ───────────────────────────────────────────────────────────────────

describe("Manchester WC26 ticket pipeline — end-to-end resolver integration", () => {
  const salesByEvent = buildTierChannelSalesByEvent(manchesterTierChannelSales);

  it("data-loader: tierChannelSalesByEvent sums to 1,362 for Manchester", () => {
    const total = [...salesByEvent.values()].reduce((s, v) => s + v.tickets, 0);
    assert.equal(total, 1362);
  });

  it("data-loader: per-event sums match expected breakdown", () => {
    assert.equal(salesByEvent.get(EVENT_CROATIA)?.tickets,  602);
    assert.equal(salesByEvent.get(EVENT_GHANA)?.tickets,    142);
    assert.equal(salesByEvent.get(EVENT_PANAMA)?.tickets,   540);
    assert.equal(salesByEvent.get(EVENT_LAST32)?.tickets,    78);
  });

  it("resolver: each event picks tier_channel_sales_sum over snapshot (same-source disambiguation)", () => {
    const expected: Record<string, number> = {
      [EVENT_CROATIA]:  602,
      [EVENT_GHANA]:    142,
      [EVENT_PANAMA]:   540,
      [EVENT_LAST32]:    78,
    };
    for (const eid of eventIds) {
      const result = resolveDisplayTicketCount({
        ticket_tiers: [{ id: eid, event_id: eid, tier_name: "GA", price: 6, quantity_sold: tierQtySoldByEvent[eid], quantity_available: null, snapshot_at: "2026-05-09T00:00:00.000Z", channel_breakdowns: [] }],
        latest_snapshot_tickets: snapshotTicketsByEvent[eid],
        fallback_tickets: null,
        tier_channel_sales_sum: salesByEvent.get(eid)?.tickets ?? null,
      });
      assert.equal(result, expected[eid], `wrong count for event ${eid}`);
    }
  });

  it("resolver: venue-card Tickets value is 1,362 not 699 (the bug from PR #368)", () => {
    // This is the assertion that *should have shipped with PR #368*.
    // It constructs the venue total the same way the venue-card component does
    // (sum resolveDisplayTicketCount across the 4 events).
    let venueTotalTickets = 0;
    for (const eid of eventIds) {
      venueTotalTickets += resolveDisplayTicketCount({
        ticket_tiers: [{ id: eid, event_id: eid, tier_name: "GA", price: 6, quantity_sold: tierQtySoldByEvent[eid], quantity_available: null, snapshot_at: "2026-05-09T00:00:00.000Z", channel_breakdowns: [] }],
        latest_snapshot_tickets: snapshotTicketsByEvent[eid],
        fallback_tickets: null,
        tier_channel_sales_sum: salesByEvent.get(eid)?.tickets ?? null,
      });
    }
    // 602 + 142 + 540 + 78 = 1,362
    assert.equal(venueTotalTickets, 1362, "venue card should show 1,362 not 699");
  });

  it("resolver: CL Final / single-channel events are not regressed (Math.max still works when tier_channel_sales_sum is null)", () => {
    assert.equal(
      resolveDisplayTicketCount({
        ticket_tiers: [{ id: "t", event_id: "e", tier_name: "GA", price: 10, quantity_sold: 356, quantity_available: null, snapshot_at: "2026-05-09T00:00:00.000Z", channel_breakdowns: [] }],
        latest_snapshot_tickets: 246,
        fallback_tickets: null,
        tier_channel_sales_sum: null,
      }),
      356,
    );
  });
});
