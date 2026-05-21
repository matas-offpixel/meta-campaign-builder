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
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  corroboratedDailyDeltas,
  shiftYmd,
} from "../venue-trend-points.ts";

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
