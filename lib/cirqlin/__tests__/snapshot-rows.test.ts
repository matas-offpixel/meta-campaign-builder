import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCirqlinSnapshotRows } from "../snapshot-rows.ts";
import type { CirqlinSignupsPayload } from "../types.ts";

const payload: CirqlinSignupsPayload = {
  ok: true,
  tag: "CQ-dod-newcastle",
  page: {
    id: "e0b4a82d-a530-49a8-a04d-e5494b947d14",
    slug: "dod",
    title: "D.O.D",
    onsale_at: null,
    presale_at: null,
  },
  totals: { signups: 1844, spam_flagged: 1, counted: 1843 },
  daily: [
    { day: "2026-08-26", signups: 64 },
    { day: "2026-08-27", signups: 160 },
  ],
  sync: {
    mailchimp: { synced: 1837, failed: 4, skipped: 1 },
    bird: { synced: 0, failed: 0, skipped: 0 },
  },
  capturedAt: "2026-09-15T12:00:00.000Z",
};

describe("buildCirqlinSnapshotRows", () => {
  it("writes one row per day and stamps the counted total on each", () => {
    const rows = buildCirqlinSnapshotRows("event-1", payload);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.day, "2026-08-26");
    assert.equal(rows[0]?.signups_day, 64);
    assert.equal(rows[0]?.signups_total, 1843);
    assert.equal(rows[1]?.signups_day, 160);
    assert.equal((rows[0]?.raw_json.sync as { mailchimp: { failed: number } }).mailchimp.failed, 4);
  });

  it("keeps a zero-day page as a single totals row", () => {
    const rows = buildCirqlinSnapshotRows("event-1", { ...payload, daily: [] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.signups_total, 1843);
    assert.equal(rows[0]?.signups_day, 0);
  });
});
