import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { buildRollupTicketDeltasFromSnapshots } from "../../ticketing/rollup-tickets-from-snapshots.ts";
import {
  authorizeClientTicketSales,
  computeClientSalesRollupDeltas,
  evaluateManualSalesEntry,
  clientManualSalesPayload,
  reportedSalesFromSnapshots,
} from "../client-ticket-sales.ts";

describe("authorizeClientTicketSales", () => {
  const membership = { userId: "user-a", clientId: "client-a" };
  const event = { id: "event-1", clientId: "client-a" };

  it("rejects unauthenticated callers", () => {
    assert.deepEqual(
      authorizeClientTicketSales({
        userId: null,
        membership,
        event,
      }),
      { ok: false, reason: "unauthenticated" },
    );
    assert.deepEqual(
      authorizeClientTicketSales({
        userId: "user-a",
        membership: null,
        event,
      }),
      { ok: false, reason: "unauthenticated" },
    );
  });

  it("rejects an authenticated user writing another client's event", () => {
    assert.deepEqual(
      authorizeClientTicketSales({
        userId: "user-a",
        membership,
        event: { id: "event-2", clientId: "client-b" },
      }),
      { ok: false, reason: "wrong_client" },
    );
  });

  it("rejects an event id that does not belong to the client", () => {
    assert.deepEqual(
      authorizeClientTicketSales({
        userId: "user-a",
        membership,
        event: null,
      }),
      { ok: false, reason: "event_not_owned" },
    );
  });

  it("allows a member writing their own event", () => {
    assert.deepEqual(
      authorizeClientTicketSales({ userId: "user-a", membership, event }),
      { ok: true },
    );
  });
});

describe("evaluateManualSalesEntry", () => {
  it("requires confirm when the new total is lower than the previous", () => {
    assert.deepEqual(
      evaluateManualSalesEntry({
        previousTotal: 250,
        nextTotal: 40,
        confirmDecrease: false,
      }),
      { ok: false, reason: "decrease_needs_confirm" },
    );
    assert.deepEqual(
      evaluateManualSalesEntry({
        previousTotal: 250,
        nextTotal: 40,
        confirmDecrease: true,
      }),
      { ok: true },
    );
  });

  it("does not require confirm for equal or higher totals", () => {
    assert.deepEqual(
      evaluateManualSalesEntry({
        previousTotal: 250,
        nextTotal: 250,
        confirmDecrease: false,
      }),
      { ok: true },
    );
    assert.deepEqual(
      evaluateManualSalesEntry({
        previousTotal: 250,
        nextTotal: 280,
        confirmDecrease: false,
      }),
      { ok: true },
    );
  });

  it("rejects a non-finite or negative total", () => {
    assert.deepEqual(
      evaluateManualSalesEntry({
        previousTotal: null,
        nextTotal: -1,
        confirmDecrease: false,
      }),
      { ok: false, reason: "invalid_total" },
    );
  });
});

describe("computeClientSalesRollupDeltas", () => {
  it("is the #836 builder — same function, not a second math path", () => {
    assert.equal(
      computeClientSalesRollupDeltas,
      buildRollupTicketDeltasFromSnapshots,
    );
  });

  it("a cumulative manual entry becomes rollup purchases via that builder", () => {
    const snapshots = [
      {
        snapshot_at: "2026-08-01T12:00:00Z",
        tickets_sold: 100,
        source: "fourthefans",
      },
      {
        snapshot_at: "2026-08-25T12:00:00Z",
        tickets_sold: 180,
        source: "manual",
      },
    ];
    const rows = computeClientSalesRollupDeltas(snapshots);
    const purchases = rows.reduce((sum, r) => sum + r.tickets_sold, 0);
    assert.equal(purchases, 180);
    const last = rows[rows.length - 1];
    assert.equal(last?.tickets_sold, 80);
    const reported = reportedSalesFromSnapshots(snapshots, 900);
    assert.equal(reported.purchases, 180);
    assert.equal(reported.lastDate, "2026-08-25");
    assert.equal(reported.costPerTicket.kind, "amount");
    if (reported.costPerTicket.kind === "amount") {
      assert.equal(reported.costPerTicket.value, 5);
    }
  });
});

describe("clientManualSalesPayload", () => {
  it("records the entering client user id for operators", () => {
    const payload = clientManualSalesPayload({
      enteredByUserId: "client-user-9",
      enteredAt: "2026-08-25T21:00:00.000Z",
    });
    assert.equal(payload.source, "manual");
    assert.equal(payload.entered_by, "client-user-9");
    assert.equal(payload.entered_via, "client_admin");
    assert.equal(payload.entered_at, "2026-08-25T21:00:00.000Z");
  });
});
