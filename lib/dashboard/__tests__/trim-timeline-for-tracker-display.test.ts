import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TimelineRow } from "../../db/event-daily-timeline.ts";

import { trimTimelineForTrackerDisplay } from "../trim-timeline-for-tracker-display.ts";

function live(
  date: string,
  overrides: Partial<TimelineRow> = {},
): TimelineRow {
  return {
    date,
    source: "live",
    ad_spend: null,
    link_clicks: null,
    meta_regs: null,
    tickets_sold: null,
    revenue: null,
    notes: null,
    freshness_at: null,
    ...overrides,
  };
}

describe("trimTimelineForTrackerDisplay", () => {
  it("drops leading zero-pad days before first spend", () => {
    const timeline: TimelineRow[] = [
      live("2026-04-07", { ad_spend: 0, link_clicks: 0, meta_regs: 0 }),
      live("2026-04-08", { ad_spend: 12.5, link_clicks: 0, meta_regs: 0 }),
      live("2026-04-09", { ad_spend: 0, link_clicks: 1, meta_regs: 0 }),
    ];
    const out = trimTimelineForTrackerDisplay(timeline, {
      generalSaleCutoff: null,
      otherSpendByDate: new Map(),
    });
    assert.equal(out.length, 2);
    assert.equal(out[0]?.date, "2026-04-08");
    assert.equal(out[1]?.date, "2026-04-09");
  });

  it("treats manual source as activity on that date", () => {
    const timeline: TimelineRow[] = [
      live("2026-04-07", { source: "manual", ad_spend: null }),
      live("2026-04-08", { ad_spend: 5 }),
    ];
    const out = trimTimelineForTrackerDisplay(timeline, {
      generalSaleCutoff: null,
      otherSpendByDate: new Map(),
    });
    assert.equal(out.length, 2);
    assert.equal(out[0]?.date, "2026-04-07");
  });

  it("uses additional spend map for first-activity detection", () => {
    const timeline: TimelineRow[] = [
      live("2026-04-07", { ad_spend: 0 }),
      live("2026-04-08", { ad_spend: 0 }),
    ];
    const out = trimTimelineForTrackerDisplay(timeline, {
      generalSaleCutoff: null,
      otherSpendByDate: new Map([["2026-04-08", 50]]),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0]?.date, "2026-04-08");
  });

  it("returns empty timeline when only zero-pad rows exist", () => {
    const timeline: TimelineRow[] = [
      live("2026-04-07", { ad_spend: 0, tickets_sold: 0 }),
    ];
    const out = trimTimelineForTrackerDisplay(timeline, {
      generalSaleCutoff: null,
      otherSpendByDate: new Map(),
    });
    assert.deepEqual(out, []);
  });

  it("only considers post-cutoff rows when presale is set", () => {
    const timeline: TimelineRow[] = [
      live("2026-04-05", { ad_spend: 100 }),
      live("2026-04-07", { ad_spend: 0 }),
      live("2026-04-08", { ad_spend: 3 }),
    ];
    const out = trimTimelineForTrackerDisplay(timeline, {
      generalSaleCutoff: "2026-04-07",
      otherSpendByDate: new Map(),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0]?.date, "2026-04-08");
    assert.ok(!out.some((r) => r.date === "2026-04-05"));
  });
});
