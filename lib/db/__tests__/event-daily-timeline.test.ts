// ─────────────────────────────────────────────────────────────────────────────
// sumTicketsInWindow (pure) tests (PR #56 #3).
//
// Validates the windowing math used by `sumTicketsSoldInWindow` to
// derive the timeframe-aware "Tickets sold" stat that drives a
// non-frozen CPT in `EventReportView`. Tests exercise only the pure
// helper so we don't have to stub `server-only` or supabase-js.
// ─────────────────────────────────────────────────────────────────────────────

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { sumTicketsInWindow } from "../event-daily-timeline-window.ts";

describe("sumTicketsInWindow", () => {
  it("returns null when no rollups exist", () => {
    assert.equal(sumTicketsInWindow([], null), null);
    assert.equal(sumTicketsInWindow([], ["2026-04-22"]), null);
  });

  it("sums every row when windowDays === null (lifetime / unranged custom)", () => {
    const out = sumTicketsInWindow(
      [
        { date: "2026-04-01", tickets_sold: 10 },
        { date: "2026-04-15", tickets_sold: 5 },
        { date: "2026-04-22", tickets_sold: 7 },
      ],
      null,
    );
    assert.equal(out, 22);
  });

  it("ignores null tickets_sold rows", () => {
    const out = sumTicketsInWindow(
      [
        { date: "2026-04-01", tickets_sold: null },
        { date: "2026-04-02", tickets_sold: 4 },
      ],
      null,
    );
    assert.equal(out, 4);
  });

  it("filters to the supplied window inclusive on both ends", () => {
    const out = sumTicketsInWindow(
      [
        { date: "2026-04-01", tickets_sold: 100 }, // outside (before)
        { date: "2026-04-10", tickets_sold: 10 },
        { date: "2026-04-15", tickets_sold: 20 },
        { date: "2026-04-20", tickets_sold: 30 },
        { date: "2026-04-25", tickets_sold: 999 }, // outside (after)
      ],
      ["2026-04-10", "2026-04-15", "2026-04-20"],
    );
    assert.equal(out, 60);
  });

  it("returns 0 (not null) when rollups exist but none fall in window", () => {
    const out = sumTicketsInWindow(
      [
        { date: "2026-04-01", tickets_sold: 10 },
        { date: "2026-04-02", tickets_sold: 5 },
      ],
      ["2026-04-15", "2026-04-16"],
    );
    assert.equal(out, 0);
  });
});
