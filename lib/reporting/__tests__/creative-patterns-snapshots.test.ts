import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { selectLatestSnapshotsByEvent } from "../creative-patterns-snapshots.ts";

describe("selectLatestSnapshotsByEvent", () => {
  it("keeps the latest fetched_at row regardless of build_version", () => {
    const rows = selectLatestSnapshotsByEvent([
      snapshot("event-1", "2026-05-02T09:00:00.000Z", "current-sha"),
      snapshot("event-1", "2026-05-02T11:00:00.000Z", "old-sha"),
      snapshot("event-2", "2026-05-02T08:00:00.000Z", "current-sha"),
      snapshot("event-2", "2026-05-02T10:00:00.000Z", null),
      snapshot("event-3", "2026-05-02T07:00:00.000Z", null),
      snapshot("event-3", "2026-05-02T06:00:00.000Z", "old-sha"),
    ]);

    assert.deepEqual(
      rows.map((row) => [row.event_id, row.fetched_at, row.build_version]),
      [
        ["event-1", "2026-05-02T11:00:00.000Z", "old-sha"],
        ["event-2", "2026-05-02T10:00:00.000Z", null],
        ["event-3", "2026-05-02T07:00:00.000Z", null],
      ],
    );
  });
});

function snapshot(
  eventId: string,
  fetchedAt: string,
  buildVersion: string | null,
) {
  return {
    event_id: eventId,
    fetched_at: fetchedAt,
    build_version: buildVersion,
  };
}
