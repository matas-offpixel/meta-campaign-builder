import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { collapseWeekly } from "../event-history-collapse.ts";

describe("collapseWeekly", () => {
  it("returns one row per week, ordered ascending", () => {
    const out = collapseWeekly([
      { snapshot_at: "2026-02-16T00:00:00Z", tickets_sold: 220, source: "eventbrite" },
      { snapshot_at: "2026-02-23T00:00:00Z", tickets_sold: 235, source: "eventbrite" },
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0].snapshot_at, "2026-02-16");
    assert.equal(out[1].snapshot_at, "2026-02-23");
  });

  it("prefers manual over xlsx_import over eventbrite for the same week", () => {
    const out = collapseWeekly([
      { snapshot_at: "2026-02-23", tickets_sold: 200, source: "eventbrite" },
      { snapshot_at: "2026-02-23", tickets_sold: 210, source: "xlsx_import" },
      { snapshot_at: "2026-02-23", tickets_sold: 220, source: "manual" },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].tickets_sold, 220);
    assert.equal(out[0].source, "manual");
  });

  it("normalizes unknown sources to eventbrite", () => {
    const out = collapseWeekly([
      { snapshot_at: "2026-02-23", tickets_sold: 100, source: "bogus" },
    ]);
    assert.equal(out[0].source, "eventbrite");
  });

  it("skips snapshots with unparseable dates", () => {
    const out = collapseWeekly([
      { snapshot_at: "not a date", tickets_sold: 100, source: "eventbrite" },
      { snapshot_at: "2026-02-23", tickets_sold: 200, source: "eventbrite" },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].snapshot_at, "2026-02-23");
  });
});
