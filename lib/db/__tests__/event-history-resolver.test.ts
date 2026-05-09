import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  collapseWeekly,
  collapseWeeklyNormalizedPerEvent,
  collapseTrendPerEventStitched,
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

  it("prefers xlsx_import over fourthefans over eventbrite for the same week", () => {
    const out = collapseWeekly([
      { snapshot_at: "2026-02-23", tickets_sold: 200, source: "eventbrite" },
      { snapshot_at: "2026-02-23", tickets_sold: 205, source: "fourthefans" },
      { snapshot_at: "2026-02-23", tickets_sold: 210, source: "xlsx_import" },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].tickets_sold, 210);
    assert.equal(out[0].source, "xlsx_import");
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

// ─── collapseTrendPerEventStitched ───────────────────────────────────────────
//
// Manchester WC26 regression (fix/venue-trend-cumulative-source-stitch):
// Croatia/Ghana/Panama have xlsx_import rows through Apr 28 + fourthefans
// rows continuing to today. collapseWeeklyNormalizedPerEvent keeps only
// xlsx_import (dominant) → tracker dark after Apr 28.
// collapseTrendPerEventStitched keeps ALL days, per-day priority resolution
// → continuous trend line using best available source per date.

describe("collapseTrendPerEventStitched", () => {
  it("Manchester WC26: keeps both xlsx_import and fourthefans days (source-stitch)", () => {
    const rows = [
      // xlsx_import rows: Feb – Apr 28
      { snapshot_at: "2026-02-28", tickets_sold: 120, source: "xlsx_import" },
      { snapshot_at: "2026-03-28", tickets_sold: 240, source: "xlsx_import" },
      { snapshot_at: "2026-04-28", tickets_sold: 246, source: "xlsx_import" },
      // fourthefans rows: Apr 28 (same day — xlsx_import wins) + later days
      { snapshot_at: "2026-04-28", tickets_sold: 250, source: "fourthefans" },
      { snapshot_at: "2026-05-01", tickets_sold: 280, source: "fourthefans" },
      { snapshot_at: "2026-05-09", tickets_sold: 310, source: "fourthefans" },
    ];
    const out = collapseTrendPerEventStitched(rows);

    // 5 distinct dates: Feb 28, Mar 28, Apr 28 (merged), May 1, May 9.
    assert.equal(out.length, 5);
    const dates = out.map((r) => r.snapshot_at);
    assert.ok(dates.includes("2026-02-28"), "Feb 28 xlsx_import row");
    assert.ok(dates.includes("2026-05-09"), "May 9 fourthefans row (continues after xlsx_import ended)");
  });

  it("keeps all distinct dates — not just dominant-source dates", () => {
    const rows = [
      { snapshot_at: "2026-02-28", tickets_sold: 120, source: "xlsx_import" },
      { snapshot_at: "2026-03-28", tickets_sold: 240, source: "xlsx_import" },
      { snapshot_at: "2026-04-28", tickets_sold: 246, source: "xlsx_import" },
      { snapshot_at: "2026-05-01", tickets_sold: 280, source: "fourthefans" },
      { snapshot_at: "2026-05-09", tickets_sold: 310, source: "fourthefans" },
    ];
    const out = collapseTrendPerEventStitched(rows);
    // Should keep ALL 5 dates (no dominant-source filter).
    assert.equal(out.length, 5);
    const dates = out.map((r) => r.snapshot_at);
    assert.ok(dates.includes("2026-02-28"), "Feb 28 (xlsx_import) should be present");
    assert.ok(dates.includes("2026-05-09"), "May 9 (fourthefans) should be present");
  });

  it("Apr 28: same day xlsx_import beats fourthefans", () => {
    const rows = [
      { snapshot_at: "2026-04-28", tickets_sold: 246, source: "xlsx_import" },
      { snapshot_at: "2026-04-28", tickets_sold: 250, source: "fourthefans" },
    ];
    const out = collapseTrendPerEventStitched(rows);
    assert.equal(out.length, 1);
    assert.equal(out[0].source, "xlsx_import");
    assert.equal(out[0].tickets_sold, 246);
  });

  it("post-import dates: fourthefans used as-is (only available source)", () => {
    const rows = [
      { snapshot_at: "2026-04-28", tickets_sold: 246, source: "xlsx_import" },
      { snapshot_at: "2026-05-01", tickets_sold: 280, source: "fourthefans" },
    ];
    const out = collapseTrendPerEventStitched(rows);
    assert.equal(out.length, 2);
    const may1 = out.find((r) => r.snapshot_at === "2026-05-01");
    assert.ok(may1, "May 1 fourthefans row should be present");
    assert.equal(may1.source, "fourthefans");
    assert.equal(may1.tickets_sold, 280);
  });

  it("collapseWeeklyNormalizedPerEvent WoW isolation: only Apr 28 xlsx row survives", () => {
    // Confirm the WoW path still filters to dominant source (xlsx_import = 1 row).
    const rows = [
      { snapshot_at: "2026-04-28", tickets_sold: 246, source: "xlsx_import" },
      { snapshot_at: "2026-05-01", tickets_sold: 280, source: "fourthefans" },
    ];
    const wow = collapseWeeklyNormalizedPerEvent(rows);
    assert.equal(wow.length, 1, "WoW collapse should keep only xlsx_import (dominant)");
    assert.equal(wow[0].source, "xlsx_import");

    // But the trend collapse keeps both.
    const trend = collapseTrendPerEventStitched(rows);
    assert.equal(trend.length, 2, "trend collapse should keep both dates");
  });

  it("single source event: no regression — all rows preserved", () => {
    const rows = [
      { snapshot_at: "2026-02-01", tickets_sold: 100, source: "fourthefans" },
      { snapshot_at: "2026-03-01", tickets_sold: 200, source: "fourthefans" },
      { snapshot_at: "2026-04-01", tickets_sold: 300, source: "fourthefans" },
    ];
    const out = collapseTrendPerEventStitched(rows);
    assert.equal(out.length, 3);
  });

  it("returns empty array for empty input", () => {
    assert.deepEqual(collapseTrendPerEventStitched([]), []);
  });
});
