/**
 * lib/dashboard/__tests__/corroborated-daily-deltas.test.ts
 *
 * Guards the Daily Tracker phantom-attribution fix (cc/fix-venue-tracker-
 * corroborate-attribution). The prior delta path
 * (`ticketDeltasFromCumulativeTimeline`, Math.max(0, cumulative − prev))
 * converted non-sale cumulative jumps in tier_channel_sales_daily_history
 * (manual Supabase reconciliations on 18 & 20 May) into phantom daily sales.
 *
 * These are pure-pipeline tests on the per-day delta map that the tracker
 * actually renders — node --test has no DOM/jsdom, so the faithful coverage
 * is the complete attribution output (suppress / preserve / re-base + the
 * snapshot_date→true-sale-day shift), not a sub-step in isolation.
 *
 * Fixtures use the real shapes verified in Supabase 2026-05-21:
 *   - Manchester: +634/+579 reconciliation jumps, rollup flat-0 → suppress.
 *   - Brighton:   hist deltas 8/42/38/18/19/20/21/8, rollup non-zero → keep.
 *   - Last-32:    82→43 down-step → re-base, no corruption.
 *   - BB26-KAYODE: brand_campaign, no ticket source → empty.
 *   - J2 Melodic:  manual_backfill, no rollup activity → bypass, deltas surface.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  buildCorroboratedDailyDeltas,
  buildEventCumulativeTicketTimeline,
  corroboratedDailyDeltas,
  shiftYmd,
} from "../venue-trend-points.ts";
import type { WeeklyTicketSnapshotRow } from "../../db/client-portal-server.ts";
import type { TierChannelDailyHistoryRow } from "../../db/tier-channel-daily-history.ts";

const repoRoot = path.resolve(import.meta.dirname ?? __dirname, "../../..");

describe("shiftYmd", () => {
  it("adds/subtracts days across month boundaries (UTC)", () => {
    assert.equal(shiftYmd("2026-05-15", -1), "2026-05-14");
    assert.equal(shiftYmd("2026-06-01", -1), "2026-05-31");
    assert.equal(shiftYmd("2026-05-31", 1), "2026-06-01");
  });
});

describe("corroboratedDailyDeltas — Manchester phantom jump suppressed", () => {
  // Reconciliation writes bumped the venue cumulative on the 18th (+634) and
  // 20th (+579). Rollup had ZERO real sales those days → no corroboration.
  const timeline = [
    { date: "2026-05-17", cumulative: 82 },
    { date: "2026-05-18", cumulative: 716 }, // +634 reconciliation
    { date: "2026-05-19", cumulative: 716 },
    { date: "2026-05-20", cumulative: 1295 }, // +579 reconciliation
    { date: "2026-05-21", cumulative: 1295 },
  ];

  it("emits NO daily sales when the rollup is flat-zero across the window", () => {
    const deltas = corroboratedDailyDeltas(timeline, new Set()); // no rollup activity
    assert.equal(deltas.size, 0, "reconciliation jumps must not surface as sales");
  });

  it("re-bases so a later real sale is the delta from the true cumulative, not the jumps", () => {
    // A genuine +10 sale on 21 May (snapshot 22 May), rollup confirms 21 May.
    const withRealSale = [
      ...timeline,
      { date: "2026-05-22", cumulative: 1305 },
    ];
    const deltas = corroboratedDailyDeltas(
      withRealSale,
      new Set(["2026-05-21"]),
    );
    assert.equal(deltas.size, 1);
    assert.equal(
      deltas.get("2026-05-21"),
      10,
      "must be 10 (1305−1295), proving the suppressed jumps were re-based not accumulated",
    );
  });
});

describe("corroboratedDailyDeltas — Brighton real sales preserved on the true day", () => {
  // snapshot_date cumulative series (verified). Each delta corroborated by a
  // rollup sale one day earlier (snapshot leads sale day by 1).
  const timeline = [
    { date: "2026-05-13", cumulative: 2146 },
    { date: "2026-05-14", cumulative: 2154 },
    { date: "2026-05-15", cumulative: 2196 },
    { date: "2026-05-16", cumulative: 2234 },
    { date: "2026-05-17", cumulative: 2252 },
    { date: "2026-05-18", cumulative: 2271 },
    { date: "2026-05-19", cumulative: 2291 },
    { date: "2026-05-20", cumulative: 2312 },
    { date: "2026-05-21", cumulative: 2320 },
  ];
  // Rollup had real sales every day 13–20 May (NOT 12 May → day-0 baseline
  // of 2146 must NOT surface as a one-day sale).
  const activity = new Set([
    "2026-05-13",
    "2026-05-14",
    "2026-05-15",
    "2026-05-16",
    "2026-05-17",
    "2026-05-18",
    "2026-05-19",
    "2026-05-20",
  ]);

  it("preserves real sales on the true sale day (snapshot_date − 1)", () => {
    const deltas = corroboratedDailyDeltas(timeline, activity);
    // hist deltas 8/42/38/18/19/20/21/8 land on 13..20 May (each D−1).
    assert.deepEqual(
      [...deltas.entries()].sort(),
      [
        ["2026-05-13", 8],
        ["2026-05-14", 42],
        ["2026-05-15", 38],
        ["2026-05-16", 18],
        ["2026-05-17", 19],
        ["2026-05-18", 20],
        ["2026-05-19", 21],
        ["2026-05-20", 8],
      ],
    );
  });

  it("suppresses the day-0 pre-window cumulative (2146) — not a one-day sale", () => {
    const deltas = corroboratedDailyDeltas(timeline, activity);
    assert.equal(deltas.has("2026-05-12"), false);
    assert.ok(![...deltas.values()].includes(2146));
  });

  it("displays the history delta as magnitude, NOT the rollup count (presence-not-magnitude)", () => {
    // 15 May: history delta is 38; the rollup that day was 34 — they differ
    // (intra-day cut). The displayed number must be the history delta (38).
    const deltas = corroboratedDailyDeltas(timeline, activity);
    assert.equal(
      deltas.get("2026-05-15"),
      38,
      "must be the history delta 38, never the rollup magnitude 34",
    );
  });
});

describe("corroboratedDailyDeltas — Last-32 down-correction re-based", () => {
  it("re-bases a down-step without corrupting a subsequent real sale", () => {
    // 82 → 43 (down-correction) → 50 (real +7 sale).
    const timeline = [
      { date: "2026-05-18", cumulative: 82 },
      { date: "2026-05-19", cumulative: 43 },
      { date: "2026-05-20", cumulative: 50 },
    ];
    const deltas = corroboratedDailyDeltas(timeline, new Set(["2026-05-19"]));
    assert.equal(deltas.size, 1);
    assert.equal(
      deltas.get("2026-05-19"),
      7,
      "the +7 must be 50−43 (re-based to the corrected 43), not 50−82",
    );
  });
});

describe("buildCorroboratedDailyDeltas — canonical builder, Utilita (Eventbrite) fixture", () => {
  // Utilita event 64d8f22a, verified in Supabase. daily_history cumulative
  // (snapshot_date) vs the rollup writer's mis-attributed per-day rows.
  const cumulativeTickets = [
    { date: "2026-05-13", cumulative: 4384 },
    { date: "2026-05-14", cumulative: 4603 },
    { date: "2026-05-15", cumulative: 4580 }, // −23 down-correction
    { date: "2026-05-16", cumulative: 6806 }, // +2226 real on-sale
    { date: "2026-05-17", cumulative: 7309 },
  ];
  const cumulativeRevenue = [
    { date: "2026-05-13", cumulative: 68599.5 },
    { date: "2026-05-14", cumulative: 74168.5 },
    { date: "2026-05-15", cumulative: 73766.5 },
    { date: "2026-05-16", cumulative: 150291.5 },
    { date: "2026-05-17", cumulative: 167929.5 },
  ];
  // Rollup writer lumped Eventbrite catch-up onto 05-15 (bogus 2458/£80,334).
  const rollups = [
    { date: "2026-05-13", tickets_sold: 102, revenue: 2550 },
    { date: "2026-05-14", tickets_sold: 0, revenue: 0 },
    { date: "2026-05-15", tickets_sold: 2458, revenue: 80334 },
    { date: "2026-05-16", tickets_sold: 465, revenue: 16140 },
    { date: "2026-05-17", tickets_sold: 218, revenue: 7565 },
  ];

  it("preserves the real on-sale (+2226) on the true sale day, NOT the bogus rollup 2458", () => {
    const { tickets } = buildCorroboratedDailyDeltas({
      cumulativeTickets,
      cumulativeRevenue,
      rollups,
    });
    // +2226 (snapshot 05-16) lands on the true sale day 05-15 (snapshot −1).
    assert.equal(tickets.get("2026-05-15"), 2226);
    // The bogus rollup lump magnitude (2458) must never appear.
    assert.ok(
      ![...tickets.values()].includes(2458),
      "rollup lump 2458 must not be displayed (presence-not-magnitude)",
    );
  });

  it("emits the smooth daily-history deltas, suppresses the day-0 baseline + down-correction", () => {
    const { tickets } = buildCorroboratedDailyDeltas({
      cumulativeTickets,
      cumulativeRevenue,
      rollups,
    });
    assert.deepEqual(
      [...tickets.entries()].sort(),
      [
        ["2026-05-13", 219], // +219 (snapshot 05-14) → true day 05-13
        ["2026-05-15", 2226], // +2226 (snapshot 05-16) → true day 05-15
        ["2026-05-16", 503], // +503 (snapshot 05-17) → true day 05-16
      ],
      "day-0 baseline (4384) suppressed; 05-14→05-15 −23 down-correction re-based",
    );
  });

  it("revenue rides the SAME grid as tickets (no Eventbrite row-split), history magnitude not rollup", () => {
    const { revenue } = buildCorroboratedDailyDeltas({
      cumulativeTickets,
      cumulativeRevenue,
      rollups,
    });
    // £76,525 history delta on 05-15 — NOT the bogus rollup £80,334.
    assert.equal(revenue.get("2026-05-15"), 76525);
    assert.ok(![...revenue.values()].includes(80334));
    // Same grid as tickets: both populate 05-13, 05-15, 05-16.
    assert.deepEqual([...revenue.keys()].sort(), [
      "2026-05-13",
      "2026-05-15",
      "2026-05-16",
    ]);
  });

  it("returns empty maps for an event with no daily_history (rollup-direct fall-through)", () => {
    const { tickets, revenue } = buildCorroboratedDailyDeltas({
      cumulativeTickets: [],
      cumulativeRevenue: [],
      rollups,
    });
    assert.equal(tickets.size, 0);
    assert.equal(revenue.size, 0);
  });
});

describe("corroboratedDailyDeltas — brand_campaign (BB26-KAYODE)", () => {
  it("returns no deltas for a ticketless timeline", () => {
    // Brand campaigns have no tier_channel_sales → empty cumulative timeline.
    assert.equal(
      corroboratedDailyDeltas([], new Set(["2026-05-15"])).size,
      0,
    );
  });

  it("preserves the render-layer brand_campaign gate (no ticket columns)", () => {
    // The gate that hides ticket/revenue columns for brand campaigns lives in
    // the renderer, not the delta builder. This change must not remove it.
    const src = fs.readFileSync(
      path.join(repoRoot, "components/dashboard/events/daily-tracker.tsx"),
      "utf8",
    );
    assert.ok(
      src.includes('kind === "brand_campaign"'),
      "daily-tracker.tsx must keep the brand_campaign render gate",
    );
  });
});

describe("buildEventCumulativeTicketTimeline — no all-channel anchor leap on a single-channel line", () => {
  const snap = (date: string, tickets: number): WeeklyTicketSnapshotRow =>
    ({
      event_id: "e",
      snapshot_at: date,
      tickets_sold: tickets,
    }) as unknown as WeeklyTicketSnapshotRow;

  it("does NOT leap to the all-channel SUM when the event has NO daily_history (4TF-only envelope)", () => {
    // 4TF snapshots cap at 2163; live all-channel tcs SUM = 2342 (+179 CP).
    const rows = [snap("2026-05-20", 2100), snap("2026-05-21", 2163)];
    const steps = buildEventCumulativeTicketTimeline(
      rows,
      { tickets: 2342, revenue: 23590 },
      "2026-05-22",
      undefined, // no daily_history → must not anchor
    );
    const maxCum = Math.max(...steps.map((s) => s.cumulative));
    assert.equal(maxCum, 2163, "4TF line stays at 2163 — no +179 leap to 2342");
    assert.ok(
      !steps.some((s) => s.cumulative === 2342),
      "a single-channel line must never be anchored up to the all-channel SUM",
    );
  });

  it("uses all-channel daily_history and lets the anchor reconcile today by a small delta", () => {
    const rows = [snap("2026-05-21", 2163)]; // 4TF envelope (lower)
    const hist: TierChannelDailyHistoryRow[] = [
      { id: "h1", event_id: "e", snapshot_date: "2026-05-21", tickets_sold_total: 2320, revenue_total: 23000, source_kind: "cron", captured_at: "2026-05-20T23:55:00Z" },
      { id: "h2", event_id: "e", snapshot_date: "2026-05-22", tickets_sold_total: 2340, revenue_total: 23579, source_kind: "cron", captured_at: "2026-05-21T23:55:00Z" },
    ];
    const steps = buildEventCumulativeTicketTimeline(
      rows,
      { tickets: 2342, revenue: 23590 },
      "2026-05-22",
      hist,
    );
    assert.ok(
      steps.some((s) => s.cumulative === 2320),
      "line runs on all-channel daily_history (2320), not the 2163 4TF envelope",
    );
    const last = steps[steps.length - 1]!;
    assert.equal(last.date, "2026-05-22");
    assert.equal(
      last.cumulative,
      2342,
      "anchor reconciles today to live SUM by a small delta (2340→2342), not a leap",
    );
  });
});

describe("listDailyHistoryForEvents — paginated (no silent 1000-row truncation)", () => {
  it("range-pages the select so large clients aren't truncated", () => {
    const src = fs.readFileSync(
      path.join(repoRoot, "lib/db/tier-channel-daily-history.ts"),
      "utf8",
    );
    const fn = src.slice(src.indexOf("export async function listDailyHistoryForEvents("));
    assert.ok(fn.includes(".range("), "must paginate via .range() (PostgREST caps unbounded selects at 1000 rows)");
    assert.ok(/page\.length < PAGE/.test(fn), "must loop until a short page (full delivery)");
  });
});

// ---------------------------------------------------------------------------
// J2 Melodic — manual_backfill bypass (cursor/creator/manual-backfill-
// corroboration-bypass). Verified against real J2 Melodic data:
//   event 42b5673a-aef4-402d-8855-9ca5339046a7, 16 weekly history rows
//   211 → 1681 cumulative, all source_kind='manual_backfill', rollup
//   tickets_sold=null on every row. Before the fix: chart empty.
// ---------------------------------------------------------------------------

function makeHistRow(
  snapshotDate: string,
  ticketsTotal: number,
  sourceKind: TierChannelDailyHistoryRow["source_kind"],
): TierChannelDailyHistoryRow {
  return {
    id: snapshotDate,
    event_id: "j2-melodic",
    snapshot_date: snapshotDate,
    tickets_sold_total: ticketsTotal,
    revenue_total: ticketsTotal * 30,
    source_kind: sourceKind,
    captured_at: snapshotDate + "T12:00:00Z",
  };
}

describe("buildCorroboratedDailyDeltas — manual_backfill bypasses rollup gate (J2 Melodic)", () => {
  // Simplified 4-row slice of J2 Melodic weekly history:
  //   211 → 340 → 520 → 750 (weekly cumulative snapshots, no rollup activity).
  const historyRows: TierChannelDailyHistoryRow[] = [
    makeHistRow("2026-02-09", 211, "manual_backfill"),
    makeHistRow("2026-02-16", 340, "manual_backfill"),
    makeHistRow("2026-02-23", 520, "manual_backfill"),
    makeHistRow("2026-03-02", 750, "manual_backfill"),
  ];
  const cumulativeTickets = historyRows.map((r) => ({
    date: r.snapshot_date,
    cumulative: r.tickets_sold_total,
  }));
  const cumulativeRevenue = historyRows.map((r) => ({
    date: r.snapshot_date,
    cumulative: r.revenue_total,
  }));
  // All rollup rows have null tickets_sold (manual-only client).
  const rollups = [
    { date: "2026-02-09", tickets_sold: null, revenue: null },
    { date: "2026-02-16", tickets_sold: null, revenue: null },
    { date: "2026-02-23", tickets_sold: null, revenue: null },
    { date: "2026-03-02", tickets_sold: null, revenue: null },
  ];

  it("emits clean weekly deltas despite zero rollup activity", () => {
    const { tickets } = buildCorroboratedDailyDeltas({
      cumulativeTickets,
      cumulativeRevenue,
      rollups,
      historyRows,
    });
    // Day-0 (211) is baseline — suppressed. Deltas from rows 2–4, keyed to
    // true sale day (snapshot_date − 1).
    assert.deepEqual(
      [...tickets.entries()].sort(),
      [
        ["2026-02-15", 129], // 340 − 211 = 129 on true day 2026-02-16 − 1
        ["2026-02-22", 180], // 520 − 340 = 180
        ["2026-03-01", 230], // 750 − 520 = 230
      ],
    );
  });

  it("revenue is derived from the same bypass path as tickets", () => {
    const { revenue } = buildCorroboratedDailyDeltas({
      cumulativeTickets,
      cumulativeRevenue,
      rollups,
      historyRows,
    });
    assert.deepEqual(
      [...revenue.entries()].sort(),
      [
        ["2026-02-15", 129 * 30],
        ["2026-02-22", 180 * 30],
        ["2026-03-01", 230 * 30],
      ],
    );
  });

  it("WITHOUT historyRows the same sequence produces zero deltas (regression guard)", () => {
    // Confirms the fix is additive: omitting historyRows restores the
    // old (broken) behaviour — no deltas surface when rollup is silent.
    const { tickets } = buildCorroboratedDailyDeltas({
      cumulativeTickets,
      cumulativeRevenue,
      rollups,
      // historyRows intentionally omitted
    });
    assert.equal(
      tickets.size,
      0,
      "without bypass, zero rollup activity means zero deltas (old broken path)",
    );
  });
});

describe("buildCorroboratedDailyDeltas — cron source_kind still requires rollup corroboration (4thefans regression)", () => {
  // Dates are spread ≥ 3 days apart so the ±1 corroboration window for the
  // phantom jump date (2026-05-15 → true day 05-14) does NOT contain the
  // rollup activity that confirms the earlier real sale (05-03).
  const historyRows: TierChannelDailyHistoryRow[] = [
    makeHistRow("2026-05-01", 2146, "cron"),  // baseline
    makeHistRow("2026-05-04", 2154, "cron"),  // +8 real sale (true day 2026-05-03)
    makeHistRow("2026-05-15", 2788, "cron"),  // +634 reconciliation (true day 2026-05-14)
  ];
  const cumulativeTickets = historyRows.map((r) => ({
    date: r.snapshot_date,
    cumulative: r.tickets_sold_total,
  }));
  const cumulativeRevenue = historyRows.map((r) => ({
    date: r.snapshot_date,
    cumulative: r.revenue_total,
  }));

  it("suppresses a reconciliation jump (no rollup activity) even with historyRows present", () => {
    const rollups = [
      { date: "2026-05-03", tickets_sold: 8, revenue: 240 }, // confirms +8 on true day 05-03
      { date: "2026-05-14", tickets_sold: 0, revenue: 0 },   // flat — no real sale on 05-14
      // 2026-05-13 and 2026-05-15 are absent from activity → ±1 window of 05-14 is silent
    ];
    const { tickets } = buildCorroboratedDailyDeltas({
      cumulativeTickets,
      cumulativeRevenue,
      rollups,
      historyRows,
    });
    // +8 delta (snapshot 05-04) → true day 05-03, corroborated ✓
    assert.equal(tickets.get("2026-05-03"), 8);
    // +634 delta (snapshot 05-15) → true day 05-14, ±1 window silent → suppressed ✓
    assert.equal(tickets.has("2026-05-14"), false, "+634 reconciliation jump must be suppressed for cron source");
  });

  it("emits the real sale when rollup confirms it (no regression from bypass logic)", () => {
    const rollups = [
      { date: "2026-05-03", tickets_sold: 5, revenue: 150 },
    ];
    const { tickets } = buildCorroboratedDailyDeltas({
      cumulativeTickets,
      cumulativeRevenue,
      rollups,
      historyRows,
    });
    assert.equal(tickets.get("2026-05-03"), 8, "real +8 sale must still surface");
  });
});

describe("buildCorroboratedDailyDeltas — mixed source_kinds (cron + manual_backfill)", () => {
  // Event migrates from manual_backfill → cron mid-series.
  // Each row is evaluated against its own source_kind.
  // Cron dates are spaced ≥ 3 days apart from each other so the ±1
  // window for the phantom date (snapshot 2026-03-20 → true day 03-19)
  // does NOT contain the real-sale activity date (2026-03-09).
  const historyRows: TierChannelDailyHistoryRow[] = [
    makeHistRow("2026-02-16", 211, "manual_backfill"),  // baseline
    makeHistRow("2026-02-23", 340, "manual_backfill"),  // +129 manual delta
    makeHistRow("2026-03-10", 360, "cron"),              // +20 cron, rollup confirms
    makeHistRow("2026-03-20", 380, "cron"),              // +20 cron, rollup flat → suppress
  ];
  const cumulativeTickets = historyRows.map((r) => ({
    date: r.snapshot_date,
    cumulative: r.tickets_sold_total,
  }));
  const cumulativeRevenue = historyRows.map((r) => ({
    date: r.snapshot_date,
    cumulative: r.revenue_total,
  }));
  const rollups = [
    // No rollup for the manual rows (manual-only client pre-migration)
    { date: "2026-02-16", tickets_sold: null, revenue: null },
    { date: "2026-02-23", tickets_sold: null, revenue: null },
    // Cron row: rollup confirms +20 on true day 2026-03-09 (snapshot 03-10 − 1)
    { date: "2026-03-09", tickets_sold: 20, revenue: 600 },
    // Cron row: rollup flat on true day 2026-03-19 (snapshot 03-20 − 1) → suppress
    // 2026-03-18 and 2026-03-20 are also absent from activity → ±1 window silent
    { date: "2026-03-19", tickets_sold: 0, revenue: 0 },
  ];

  it("manual_backfill rows bypass; cron rows keep corroboration gate", () => {
    const { tickets } = buildCorroboratedDailyDeltas({
      cumulativeTickets,
      cumulativeRevenue,
      rollups,
      historyRows,
    });
    // manual_backfill: 340 − 211 = 129, true day 2026-02-22 (no rollup needed) ✓
    assert.equal(tickets.get("2026-02-22"), 129, "manual delta must surface without rollup");
    // cron + rollup confirmed: 360 − 340 = 20, true day 2026-03-09 ✓
    assert.equal(tickets.get("2026-03-09"), 20, "cron delta must surface when rollup confirms");
    // cron + rollup flat: 380 − 360 = 20, true day 2026-03-19 → suppressed ✓
    assert.equal(tickets.has("2026-03-19"), false, "cron delta without rollup must be suppressed");
  });
});
