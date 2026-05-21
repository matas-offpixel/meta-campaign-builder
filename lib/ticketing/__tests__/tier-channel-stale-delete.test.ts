/**
 * lib/ticketing/__tests__/tier-channel-stale-delete.test.ts
 *
 * Behavioral guards for computeStaleTierChannelDeletions — the pure planner
 * that retires renamed-out tier_channel_sales rows during fourthefans sync.
 *
 * Root-cause fix for the Aston Villa over-count (18,911 on a 7,344-cap venue)
 * that was manually cleaned in Supabase on 2026-05-21: the sync upserted
 * renamed tiers but never retired the old-name rows.
 *
 * Pure-function tests — no Next.js / Supabase. The two cases that lose data or
 * wipe a channel if wrong (channel-safety and empty-response guard) are the
 * load-bearing assertions in this file.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeStaleTierChannelDeletions,
  rowHasMaterialChange,
} from "../tier-channel-stale-delete.ts";

const FTF = "4tf-channel-id";
const VENUE = "venue-channel-id";

describe("computeStaleTierChannelDeletions — rename retirement (the Villa bug)", () => {
  it("retires a tier renamed out of the API response", () => {
    // 4TF has [A, B, C]; API now returns [A, B, D] (C renamed to D).
    const existing = [
      { tier_name: "A", channel_id: FTF },
      { tier_name: "B", channel_id: FTF },
      { tier_name: "C", channel_id: FTF },
    ];
    const stale = computeStaleTierChannelDeletions(existing, ["A", "B", "D"], FTF);
    assert.deepEqual(
      stale.map((r) => r.tier_name),
      ["C"],
      "only the dropped-out tier C should be retired; A/B survive, D is new",
    );
  });

  it("returns [] when every existing tier is still present (no-op sync)", () => {
    const existing = [
      { tier_name: "A", channel_id: FTF },
      { tier_name: "B", channel_id: FTF },
    ];
    assert.deepEqual(
      computeStaleTierChannelDeletions(existing, ["A", "B"], FTF),
      [],
    );
  });

  it("does not retire anything when the API adds a new tier", () => {
    const existing = [{ tier_name: "A", channel_id: FTF }];
    assert.deepEqual(
      computeStaleTierChannelDeletions(existing, ["A", "B"], FTF),
      [],
    );
  });
});

describe("computeStaleTierChannelDeletions — channel safety (operator data must survive)", () => {
  it("never retires operator-channel rows even when their tier name is absent from the API", () => {
    // Venue channel holds a manually-imported "GA" sale the API never returns.
    // 4TF has [A, B]; API returns [A] only. Expect ONLY 4TF "B" retired.
    const existing = [
      { tier_name: "GA", channel_id: VENUE }, // operator — must survive
      { tier_name: "A", channel_id: FTF },
      { tier_name: "B", channel_id: FTF },
    ];
    const stale = computeStaleTierChannelDeletions(existing, ["A"], FTF);
    assert.deepEqual(
      stale.map((r) => `${r.channel_id}:${r.tier_name}`),
      [`${FTF}:B`],
      "Venue GA must NOT be retired; only the 4TF row that dropped out (B)",
    );
    assert.ok(
      !stale.some((r) => r.channel_id === VENUE),
      "no operator-channel row may ever appear in the deletion set",
    );
  });

  it("re-filters defensively if the caller over-reads other channels", () => {
    // Same-name tier on two channels: only the 4TF one is eligible.
    const existing = [
      { tier_name: "GA", channel_id: VENUE },
      { tier_name: "GA", channel_id: FTF },
    ];
    // API returns [] would trip the empty-guard, so give a non-empty
    // unrelated set to isolate the channel filter.
    const stale = computeStaleTierChannelDeletions(existing, ["Other"], FTF);
    assert.deepEqual(
      stale.map((r) => `${r.channel_id}:${r.tier_name}`),
      [`${FTF}:GA`],
      "only the 4TF 'GA' is stale; the Venue 'GA' is untouchable",
    );
  });
});

describe("computeStaleTierChannelDeletions — empty-response guard (the channel-wipe preventer)", () => {
  it("returns [] when the API returns zero tiers — never wipes the channel", () => {
    // THE single most important assertion: a flaky/empty API response must
    // not be read as "all tiers retired".
    const existing = [
      { tier_name: "A", channel_id: FTF },
      { tier_name: "B", channel_id: FTF },
    ];
    assert.deepEqual(
      computeStaleTierChannelDeletions(existing, [], FTF),
      [],
      "empty currentTierNames must yield zero deletions — channel preserved",
    );
  });

  it("returns [] for empty current names even with mixed-channel existing rows", () => {
    const existing = [
      { tier_name: "A", channel_id: FTF },
      { tier_name: "GA", channel_id: VENUE },
    ];
    assert.deepEqual(computeStaleTierChannelDeletions(existing, [], FTF), []);
  });
});

describe("rowHasMaterialChange — WAL/write-hygiene no-op guard", () => {
  it("skips an unchanged row (same tickets + revenue) → false", () => {
    assert.equal(
      rowHasMaterialChange(
        { tickets_sold: 50, revenue_amount: 450 },
        { tickets_sold: 50, revenue_amount: 450 },
      ),
      false,
    );
  });

  it("writes when tickets_sold changed → true", () => {
    assert.equal(
      rowHasMaterialChange(
        { tickets_sold: 50, revenue_amount: 450 },
        { tickets_sold: 51, revenue_amount: 450 },
      ),
      true,
    );
  });

  it("writes when revenue changed but tickets did not → true", () => {
    assert.equal(
      rowHasMaterialChange(
        { tickets_sold: 50, revenue_amount: 450 },
        { tickets_sold: 50, revenue_amount: 465 },
      ),
      true,
    );
  });

  it("writes a genuinely new row (no existing) → true", () => {
    assert.equal(
      rowHasMaterialChange(undefined, { tickets_sold: 0, revenue_amount: 0 }),
      true,
    );
  });

  it("ignores sub-cent revenue float jitter → false (no churn)", () => {
    assert.equal(
      rowHasMaterialChange(
        { tickets_sold: 50, revenue_amount: 450.0 },
        { tickets_sold: 50, revenue_amount: 450.0001 },
      ),
      false,
    );
  });
});
