import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MailchimpSnapshotRow } from "../compute-registrations.ts";
import { netNewMailchimpRegistrationsForRange } from "../tracker-registrations.ts";

function snap(day: string, subs: number | null): MailchimpSnapshotRow {
  return {
    snapshot_at: `${day}T12:00:00Z`,
    email_subscribers: subs,
  } as MailchimpSnapshotRow;
}

describe("netNewMailchimpRegistrationsForRange", () => {
  const snapshots = [
    snap("2026-08-25", 100),
    snap("2026-08-31", 800),
    snap("2026-09-08", 1786),
    snap("2026-09-15", 1900),
  ];

  it("differences the cumulative totals at both ends of the range", () => {
    assert.equal(
      netNewMailchimpRegistrationsForRange(
        snapshots,
        "2026-08-26",
        "2026-09-08",
      ),
      1686,
    );
  });

  it("carries the last known total forward across sparse days", () => {
    assert.equal(
      netNewMailchimpRegistrationsForRange(
        snapshots,
        "2026-09-01",
        "2026-09-10",
      ),
      986,
    );
  });

  it("counts from zero when the range starts before the first snapshot", () => {
    assert.equal(
      netNewMailchimpRegistrationsForRange(
        snapshots,
        "2026-08-01",
        "2026-08-25",
      ),
      100,
    );
  });

  it("returns null when no snapshot exists on or before the range end", () => {
    assert.equal(
      netNewMailchimpRegistrationsForRange(
        snapshots,
        "2026-08-01",
        "2026-08-20",
      ),
      null,
    );
  });

  it("returns null for an inverted range", () => {
    assert.equal(
      netNewMailchimpRegistrationsForRange(
        snapshots,
        "2026-09-08",
        "2026-08-26",
      ),
      null,
    );
  });
});
