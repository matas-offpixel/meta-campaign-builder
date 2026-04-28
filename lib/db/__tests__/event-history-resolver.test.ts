import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  collapseWeekly,
  collapseWeeklyNormalizedPerEvent,
} from "../event-history-collapse.ts";

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

describe("collapseWeeklyNormalizedPerEvent", () => {
  // PR 2's Leeds regression fix: when an event has snapshots from
  // multiple sources across different weeks, pick the highest-
  // priority source and drop the others entirely. Mixing cumulative
  // totals across sources (xlsx_import 1,783 one week, eventbrite
  // 1,091 the next) produces phantom WoW regressions even though
  // the underlying counts never actually regressed.

  it("drops lower-priority sources when a higher-priority one exists", () => {
    const out = collapseWeeklyNormalizedPerEvent([
      { snapshot_at: "2026-02-16", tickets_sold: 100, source: "eventbrite" },
      { snapshot_at: "2026-02-23", tickets_sold: 210, source: "xlsx_import" },
      { snapshot_at: "2026-03-02", tickets_sold: 240, source: "eventbrite" },
    ]);
    // xlsx_import is higher priority than eventbrite (PR #122
    // contract). Only the one xlsx_import row survives.
    assert.equal(out.length, 1);
    assert.equal(out[0].source, "xlsx_import");
    assert.equal(out[0].tickets_sold, 210);
  });

  it("keeps every row when all snapshots come from the same source", () => {
    const out = collapseWeeklyNormalizedPerEvent([
      { snapshot_at: "2026-02-16", tickets_sold: 100, source: "eventbrite" },
      { snapshot_at: "2026-02-23", tickets_sold: 150, source: "eventbrite" },
      { snapshot_at: "2026-03-02", tickets_sold: 200, source: "eventbrite" },
    ]);
    assert.equal(out.length, 3);
  });

  it("picks manual over every other source when present", () => {
    const out = collapseWeeklyNormalizedPerEvent([
      { snapshot_at: "2026-02-16", tickets_sold: 100, source: "eventbrite" },
      { snapshot_at: "2026-02-23", tickets_sold: 210, source: "xlsx_import" },
      { snapshot_at: "2026-03-02", tickets_sold: 250, source: "manual" },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].source, "manual");
  });

  it("returns an empty array for empty input", () => {
    assert.deepEqual(collapseWeeklyNormalizedPerEvent([]), []);
  });

  it("applies the per-day tie-break before picking the dominant source", () => {
    const out = collapseWeeklyNormalizedPerEvent([
      // Same day, two sources — eventbrite 180 gets promoted to
      // xlsx_import 200 by the collapseWeekly tie-break first, then
      // only xlsx_import survives the source normalisation.
      { snapshot_at: "2026-02-23", tickets_sold: 180, source: "eventbrite" },
      { snapshot_at: "2026-02-23", tickets_sold: 200, source: "xlsx_import" },
      { snapshot_at: "2026-03-02", tickets_sold: 100, source: "eventbrite" },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].source, "xlsx_import");
    assert.equal(out[0].tickets_sold, 200);
  });
});
