import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";

import {
  ARCHIVED_CLIENT_REASON,
  planUnlinkedTicketRows,
  runUnlinkedTicketsRollupLeg,
  type UnlinkedTicketsDeps,
} from "../unlinked-tickets-rollup-leg.ts";
import { legOutcome } from "../rollup-sync-leg-tally.ts";
import {
  buildRollupTicketDeltasFromSnapshots,
  type RollupTicketDeltaRow,
  type SnapshotForRollupTickets,
} from "../../ticketing/rollup-tickets-from-snapshots.ts";

function snap(
  snapshot_at: string,
  tickets_sold: number,
  source = "internal_counts",
  extra: Partial<SnapshotForRollupTickets> = {},
): SnapshotForRollupTickets {
  return { snapshot_at, tickets_sold, source, gross_revenue_cents: null, ...extra };
}

function fakeDeps(opts: {
  snapshots?: SnapshotForRollupTickets[];
  archived?: boolean;
}): UnlinkedTicketsDeps & { upserts: RollupTicketDeltaRow[][]; listed: number } {
  const state = { upserts: [] as RollupTicketDeltaRow[][], listed: 0 };
  return {
    get upserts() {
      return state.upserts;
    },
    get listed() {
      return state.listed;
    },
    listSnapshots: async () => {
      state.listed += 1;
      return opts.snapshots ?? [];
    },
    isClientArchived: async () => opts.archived ?? false,
    upsertRollups: async ({ rows }) => {
      state.upserts.push(rows);
      return { upserted: rows.length, skipped_noop: 0 };
    },
  };
}

const input = { userId: "u1", eventId: "e1", clientId: "c1" };

describe("unlinked tickets rollup leg", () => {
  it("an Electric show with three PDF snapshots across two days writes one row per day from the day's last count", async () => {
    const deps = fakeDeps({
      snapshots: [
        snap("2026-11-20T09:00:00Z", 90),
        snap("2026-11-20T16:00:00Z", 100),
        snap("2026-11-21T12:00:00Z", 130),
      ],
    });
    const result = await runUnlinkedTicketsRollupLeg(input, deps);
    assert.equal(result.ok, true);
    assert.equal(result.snapshotRows, 3);
    assert.equal(result.rowsWritten, 2);
    assert.deepEqual(deps.upserts, [
      [
        { date: "2026-11-20", tickets_sold: 100, revenue: 0 },
        { date: "2026-11-21", tickets_sold: 30, revenue: 0 },
      ],
    ]);
    assert.equal(legOutcome("tickets", result), "ok");
  });

  it("a day with no snapshot gets no row: the total carries forward and no sale is shown", async () => {
    const deps = fakeDeps({
      snapshots: [snap("2026-11-20T12:00:00Z", 100), snap("2026-11-23T12:00:00Z", 130)],
    });
    await runUnlinkedTicketsRollupLeg(input, deps);
    const rows = deps.upserts[0];
    assert.deepEqual(
      rows.map((r) => r.date),
      ["2026-11-20", "2026-11-23"],
      "no row for 21 or 22 Nov, so nothing is zero-padded",
    );
    assert.equal(rows.reduce((n, r) => n + r.tickets_sold, 0), 130, "summed deltas = the last cumulative total");
    assert.equal(rows[1].tickets_sold, 30, "the weekend's sales land on the next count day");
  });

  it("an archived client is skipped before any read or write", async () => {
    const deps = fakeDeps({ snapshots: [snap("2026-11-20T12:00:00Z", 100)], archived: true });
    const result = await runUnlinkedTicketsRollupLeg(input, deps);
    assert.equal(result.ok, false);
    assert.equal(result.reason, ARCHIVED_CLIENT_REASON);
    assert.equal(deps.listed, 0);
    assert.equal(deps.upserts.length, 0);
    assert.equal(legOutcome("tickets", result), "skipped");
  });

  it("no link and no snapshots stays a not_linked skip and writes nothing", async () => {
    const deps = fakeDeps({ snapshots: [] });
    const result = await runUnlinkedTicketsRollupLeg(input, deps);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_linked");
    assert.equal(deps.upserts.length, 0);
    assert.equal(legOutcome("tickets", result), "skipped");
  });

  it("uses the collapse priority unchanged: manual beats internal_counts on the same day", () => {
    const rows = planUnlinkedTicketRows([
      snap("2026-11-20T12:00:00Z", 100, "internal_counts"),
      snap("2026-11-20T12:00:00Z", 104, "manual"),
      snap("2026-11-21T12:00:00Z", 110, "internal_counts"),
    ]);
    assert.deepEqual(
      rows.map((r) => [r.date, r.tickets_sold]),
      [
        ["2026-11-20", 104],
        ["2026-11-21", 6],
      ],
    );
  });

  it("a linked show's snapshots give exactly what the linked path builds", () => {
    // Two 4TF listings on one event, the shape the linked path handles.
    const linked = [
      snap("2026-06-01T06:00:00Z", 200, "fourthefans", { external_event_id: "A" }),
      snap("2026-06-01T06:00:00Z", 4000, "fourthefans", { external_event_id: "B" }),
      snap("2026-06-02T06:00:00Z", 218, "fourthefans", { external_event_id: "A" }),
      snap("2026-06-02T06:00:00Z", 4318, "fourthefans", { external_event_id: "B" }),
    ];
    assert.deepEqual(planUnlinkedTicketRows(linked), buildRollupTicketDeltasFromSnapshots(linked));
  });
});

describe("rollup-sync runner wiring", () => {
  const root = path.resolve(import.meta.dirname ?? __dirname, "../../..");
  const src = fs.readFileSync(path.join(root, "lib/dashboard/rollup-sync-runner.ts"), "utf8");

  it("calls the unlinked leg only inside the no-link branch", () => {
    const noLink = src.indexOf("if (links.length === 0) {");
    const linkedElse = src.indexOf("} else {", noLink);
    const call = src.indexOf("runUnlinkedTicketsRollupLeg(");
    assert.ok(noLink > 0 && linkedElse > noLink, "no-link branch present");
    assert.ok(call > noLink && call < linkedElse, "the unlinked leg runs in the no-link branch");
    assert.equal(src.split("runUnlinkedTicketsRollupLeg(").length - 1, 1, "called once");
  });

  it("leaves the linked path building tickets from collapsed snapshots as before", () => {
    const linkedElse = src.indexOf("} else {", src.indexOf("if (links.length === 0) {"));
    const linked = src.slice(linkedElse);
    assert.ok(linked.includes("const snapshots = await listAllSnapshotsForEvent(supabase, eventId);"));
    assert.ok(linked.includes("const fromSnapshots = buildRollupTicketDeltasFromSnapshots(snapshots);"));
    assert.ok(linked.includes("fromSnapshots.length > 0 ? fromSnapshots : liveFallbackRows"));
  });
});

describe("unlinked tickets dry run", () => {
  it("never writes: no insert, upsert, update, delete or rpc in the script", () => {
    const root = path.resolve(import.meta.dirname ?? __dirname, "../../..");
    const src = fs.readFileSync(path.join(root, "scripts/rollup-tickets-unlinked-dry-run.mts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const call of [".insert(", ".upsert(", ".update(", ".delete(", ".rpc("]) {
      assert.ok(!code.includes(call), `dry run must not call ${call}`);
    }
  });
});
