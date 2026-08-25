import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countPageViewsByUtcDay,
  lifetimePageViewCount,
} from "../page-view-count.ts";

describe("countPageViewsByUtcDay", () => {
  it("buckets per event per UTC day, not by local clock", () => {
    const byDay = countPageViewsByUtcDay([
      "2026-08-25T01:00:00.000Z",
      "2026-08-25T23:59:00.000Z",
      "2026-08-26T00:00:00.000Z",
    ]);
    assert.equal(byDay.get("2026-08-25"), 2);
    assert.equal(byDay.get("2026-08-26"), 1);
    assert.equal(lifetimePageViewCount([
      "2026-08-25T01:00:00.000Z",
      "2026-08-25T23:59:00.000Z",
      "2026-08-26T00:00:00.000Z",
    ]), 3);
  });
});
