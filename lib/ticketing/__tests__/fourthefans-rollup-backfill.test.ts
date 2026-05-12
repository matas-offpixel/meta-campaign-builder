import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  aggregateMultiLinkSnapshots,
  reconstructFourthefansRollupDeltas,
} from "../fourthefans-rollup-backfill.ts";

describe("reconstructFourthefansRollupDeltas", () => {
  it("reconstructs daily deltas from cumulative lifetime snapshots", () => {
    const rows = reconstructFourthefansRollupDeltas([
      snapshot("2026-04-30T10:00:00.000Z", 100, 100_00),
      snapshot("2026-05-01T10:00:00.000Z", 250, 250_00),
      snapshot("2026-05-02T10:00:00.000Z", 400, 400_00),
    ]);

    assert.deepEqual(
      rows.map((row) => row.tickets_sold),
      [100, 150, 150],
    );
    assert.deepEqual(
      rows.map((row) => row.revenue),
      [100, 150, 150],
    );
  });

  it("skips dates that already have positive real rollup deltas", () => {
    const rows = reconstructFourthefansRollupDeltas(
      [
        snapshot("2026-04-30T10:00:00.000Z", 100, 100_00),
        snapshot("2026-05-01T10:00:00.000Z", 250, 250_00),
        snapshot("2026-05-02T10:00:00.000Z", 400, 400_00),
      ],
      [{ date: "2026-05-01", tickets_sold: 150 }],
    );

    assert.deepEqual(
      rows.map((row) => [row.date, row.tickets_sold]),
      [
        ["2026-04-30", 100],
        ["2026-05-02", 150],
      ],
    );
  });

  it("revenue delta sequence [100, 250, 250, 380] → [100, 150, 0, 130]", () => {
    const rows = reconstructFourthefansRollupDeltas([
      snapshot("2026-05-09T10:00:00.000Z", 10, 100_00),
      snapshot("2026-05-10T10:00:00.000Z", 25, 250_00),
      snapshot("2026-05-11T10:00:00.000Z", 25, 250_00),
      snapshot("2026-05-12T10:00:00.000Z", 38, 380_00),
    ]);
    assert.deepEqual(
      rows.map((row) => row.revenue),
      [100, 150, 0, 130],
    );
  });

  it("revenue refund clamp: lifetime drops [300→250] → daily delta=0, not -50", () => {
    const rows = reconstructFourthefansRollupDeltas([
      snapshot("2026-05-10T10:00:00.000Z", 30, 300_00),
      snapshot("2026-05-11T10:00:00.000Z", 25, 250_00),
    ]);
    assert.deepEqual(
      rows.map((row) => row.revenue),
      [300, 0],
    );
  });

  it("uses the latest same-day lifetime snapshot before differencing days", () => {
    const rows = reconstructFourthefansRollupDeltas([
      snapshot("2026-04-30T09:00:00.000Z", 100, 100_00),
      snapshot("2026-04-30T18:00:00.000Z", 140, 140_00),
      snapshot("2026-05-01T18:00:00.000Z", 250, 250_00),
    ]);

    assert.deepEqual(
      rows.map((row) => [row.date, row.tickets_sold]),
      [
        ["2026-04-30", 140],
        ["2026-05-01", 110],
      ],
    );
  });
});

describe("aggregateMultiLinkSnapshots", () => {
  it("sums two links on the same day and computes correct delta", () => {
    const raw = [
      rawSnapshot("conn-1", "ext-A", "2026-05-01T10:00:00.000Z", 100, 100_00),
      rawSnapshot("conn-1", "ext-B", "2026-05-01T10:00:00.000Z", 50, 50_00),
      rawSnapshot("conn-1", "ext-A", "2026-05-02T10:00:00.000Z", 150, 150_00),
      rawSnapshot("conn-1", "ext-B", "2026-05-02T10:00:00.000Z", 80, 80_00),
    ];
    const aggregated = aggregateMultiLinkSnapshots(raw);
    assert.equal(aggregated.length, 2);
    assert.deepEqual(
      aggregated.map((r) => r.tickets_sold),
      [150, 230],
    );
    assert.deepEqual(
      aggregated.map((r) => r.gross_revenue_cents),
      [150_00, 230_00],
    );

    const deltas = reconstructFourthefansRollupDeltas(aggregated);
    assert.deepEqual(
      deltas.map((r) => r.tickets_sold),
      [150, 80],
    );
    assert.deepEqual(
      deltas.map((r) => r.revenue),
      [150, 80],
    );
  });

  it("picks the latest intra-day snapshot per link before summing", () => {
    const raw = [
      rawSnapshot("conn-1", "ext-A", "2026-05-01T09:00:00.000Z", 90, 90_00),
      rawSnapshot("conn-1", "ext-A", "2026-05-01T18:00:00.000Z", 110, 110_00),
      rawSnapshot("conn-1", "ext-B", "2026-05-01T10:00:00.000Z", 40, 40_00),
    ];
    const aggregated = aggregateMultiLinkSnapshots(raw);
    assert.equal(aggregated.length, 1);
    assert.equal(aggregated[0].tickets_sold, 150);
    assert.equal(aggregated[0].gross_revenue_cents, 150_00);
  });
});

// ── Bug #2: pre-PR-395 backfill ───────────────────────────────────────────
//
// Before PR #395 (~2026-05-08) the runner stored cumulative lifetime totals
// in event_daily_rollups.tickets_sold instead of daily deltas.  The backfill
// route calls aggregateMultiLinkSnapshots → reconstructFourthefansRollupDeltas
// with an empty existing-rollups list (no date protection) to overwrite every
// pre-cutoff row with the correct delta value.
describe("pre-PR-395 backfill: Manchester Croatia 242 phantom spike", () => {
  it("corrects cumulative-stored row: 2026-05-07 tickets_sold=242 → correct daily delta", () => {
    // Simulate: the rollup row on 2026-05-07 was written as the lifetime
    // cumulative total (242) rather than the daily delta.  Snapshots show:
    //   2026-05-01: 50 lifetime
    //   2026-05-04: 130 lifetime
    //   2026-05-07: 242 lifetime   ← was written verbatim into rollup as 242
    //
    // The backfill reconstructs correct deltas: 50, 80, 112.
    const snaps = [
      snapshot("2026-05-01T10:00:00.000Z", 50, 5000_00),
      snapshot("2026-05-04T10:00:00.000Z", 130, 13000_00),
      snapshot("2026-05-07T10:00:00.000Z", 242, 24200_00),
    ];

    // Backfill passes empty existing-rollups → no protection, all dates rewritten.
    const deltas = reconstructFourthefansRollupDeltas(snaps, []);

    assert.deepEqual(
      deltas.map((r) => ({ date: r.date, tickets_sold: r.tickets_sold })),
      [
        { date: "2026-05-01", tickets_sold: 50 },
        { date: "2026-05-04", tickets_sold: 80 },
        { date: "2026-05-07", tickets_sold: 112 },
      ],
    );
    // None should be 242 (the cumulative value)
    assert.ok(
      deltas.every((r) => r.tickets_sold !== 242),
      "no row should retain the cumulative total of 242",
    );
  });

  it("multi-link Manchester Croatia: SUM both links before delta to avoid double-counting", () => {
    // Event has two links (ext-A primary, ext-B presale/additional).
    // Before PR-395 the runner summed their deltas correctly going forward,
    // but historical rows may have cumulative totals from a single link.
    // aggregateMultiLinkSnapshots correctly SUMs both links per day.
    const raw = [
      // Day 1: link A=50, link B=10 → combined lifetime=60
      rawSnapshot("conn-1", "ext-A", "2026-05-01T10:00:00.000Z", 50, 5000_00),
      rawSnapshot("conn-1", "ext-B", "2026-05-01T10:00:00.000Z", 10, 1000_00),
      // Day 2: link A=120, link B=22 → combined lifetime=142
      rawSnapshot("conn-1", "ext-A", "2026-05-04T10:00:00.000Z", 120, 12000_00),
      rawSnapshot("conn-1", "ext-B", "2026-05-04T10:00:00.000Z", 22, 2200_00),
    ];
    const aggregated = aggregateMultiLinkSnapshots(raw);
    // Aggregated lifetimes: day 1=60, day 2=142
    assert.deepEqual(
      aggregated.map((r) => r.tickets_sold),
      [60, 142],
    );
    const deltas = reconstructFourthefansRollupDeltas(aggregated, []);
    // Deltas: day 1=60, day 2=82
    assert.deepEqual(
      deltas.map((r) => r.tickets_sold),
      [60, 82],
    );
  });
});

function snapshot(
  snapshot_at: string,
  tickets_sold: number,
  gross_revenue_cents: number | null,
) {
  return {
    event_id: "event-1",
    user_id: "user-1",
    snapshot_at,
    tickets_sold,
    gross_revenue_cents,
  };
}

function rawSnapshot(
  connection_id: string,
  external_event_id: string,
  snapshot_at: string,
  tickets_sold: number,
  gross_revenue_cents: number | null,
) {
  return {
    event_id: "event-1",
    user_id: "user-1",
    connection_id,
    external_event_id,
    snapshot_at,
    tickets_sold,
    gross_revenue_cents,
  };
}
