import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  buildRollupTicketDeltasFromSnapshots,
} from "../rollup-tickets-from-snapshots.ts";

/**
 * Regression for the dead tickets leg (2026-07-01 → today).
 *
 * Production shape, England Last 32 / Brighton (`WC26-BRIGHTON`):
 * `ticket_sales_snapshots` lifetime climbed 334 → 2505 over 2026-06-20
 * → 2026-07-01 while `event_daily_rollups.tickets_sold` stayed 0 every
 * day. The live Eventbrite/4TF writers never read snapshots through
 * collapse, so a 2,000-ticket sale window never landed on the rollup.
 *
 * This file must fail against main-before-the-fix (module missing, or
 * a writer that emits only today's 0-delta) and pass once the pipe
 * derives daily rollup tickets from collapsed snapshot cumulatives.
 */
describe("buildRollupTicketDeltasFromSnapshots", () => {
  it("Brighton Last 32: collapsed snapshot growth becomes daily rollup deltas, including July 1", () => {
    const snapshots = [
      { snapshot_at: "2026-06-20T07:02:00Z", tickets_sold: 334, source: "fourthefans" },
      { snapshot_at: "2026-06-20T19:02:00Z", tickets_sold: 346, source: "fourthefans" },
      { snapshot_at: "2026-06-21T22:02:00Z", tickets_sold: 360, source: "fourthefans" },
      { snapshot_at: "2026-06-30T22:02:00Z", tickets_sold: 2003, source: "fourthefans" },
      { snapshot_at: "2026-07-01T13:02:00Z", tickets_sold: 2386, source: "fourthefans" },
      { snapshot_at: "2026-07-01T18:03:00Z", tickets_sold: 2505, source: "fourthefans" },
      { snapshot_at: "2026-07-02T13:01:00Z", tickets_sold: 2505, source: "fourthefans" },
    ];

    const rows = buildRollupTicketDeltasFromSnapshots(snapshots);
    const byDate = new Map(rows.map((r) => [r.date, r.tickets_sold]));

    assert.equal(byDate.get("2026-06-20"), 346);
    assert.equal(byDate.get("2026-06-21"), 14);
    assert.equal(byDate.get("2026-06-30"), 1643);
    assert.equal(byDate.get("2026-07-01"), 502);
    assert.equal(byDate.get("2026-07-02"), 0);

    const july = rows
      .filter((r) => r.date >= "2026-07-01")
      .reduce((sum, r) => sum + r.tickets_sold, 0);
    assert.equal(july, 502);
    assert.ok(july > 0, "July rollup tickets must not stay zero when snapshots grew");
  });

  it("honours snapshot source priority: manual > xlsx_import > fourthefans > eventbrite", () => {
    const rows = buildRollupTicketDeltasFromSnapshots([
      { snapshot_at: "2026-07-01T10:00:00Z", tickets_sold: 100, source: "eventbrite" },
      { snapshot_at: "2026-07-01T10:00:00Z", tickets_sold: 180, source: "fourthefans" },
      { snapshot_at: "2026-07-01T10:00:00Z", tickets_sold: 210, source: "xlsx_import" },
      { snapshot_at: "2026-07-01T12:00:00Z", tickets_sold: 250, source: "manual" },
      { snapshot_at: "2026-07-02T10:00:00Z", tickets_sold: 280, source: "manual" },
    ]);
    const byDate = new Map(rows.map((r) => [r.date, r.tickets_sold]));
    assert.equal(byDate.get("2026-07-01"), 250);
    assert.equal(byDate.get("2026-07-02"), 30);
  });

  it("uses the latest intra-day snapshot of the winning source, not the first", () => {
    const rows = buildRollupTicketDeltasFromSnapshots([
      { snapshot_at: "2026-07-01T07:00:00Z", tickets_sold: 100, source: "fourthefans" },
      { snapshot_at: "2026-07-01T19:00:00Z", tickets_sold: 140, source: "fourthefans" },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.tickets_sold, 140);
  });

  it("returns no rows for an empty snapshot list (new client is not a dead leg)", () => {
    assert.deepEqual(buildRollupTicketDeltasFromSnapshots([]), []);
  });

  it("sums same-source listings on one day instead of bouncing between lifetimes", () => {
    const rows = buildRollupTicketDeltasFromSnapshots([
      {
        snapshot_at: "2026-07-01T10:00:00Z",
        tickets_sold: 218,
        source: "fourthefans",
        external_event_id: "218",
      },
      {
        snapshot_at: "2026-07-01T10:00:00Z",
        tickets_sold: 4318,
        source: "fourthefans",
        external_event_id: "4318",
      },
      {
        snapshot_at: "2026-07-02T10:00:00Z",
        tickets_sold: 220,
        source: "fourthefans",
        external_event_id: "218",
      },
      {
        snapshot_at: "2026-07-02T10:00:00Z",
        tickets_sold: 4320,
        source: "fourthefans",
        external_event_id: "4318",
      },
    ]);
    const byDate = new Map(rows.map((r) => [r.date, r.tickets_sold]));
    assert.equal(byDate.get("2026-07-01"), 4536);
    assert.equal(byDate.get("2026-07-02"), 4);
  });
});
