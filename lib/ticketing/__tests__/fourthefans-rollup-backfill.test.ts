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
