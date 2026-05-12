import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { reconstructFourthefansRollupDeltas } from "../fourthefans-rollup-backfill.ts";

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
