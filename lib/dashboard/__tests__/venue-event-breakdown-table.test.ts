/**
 * lib/dashboard/__tests__/venue-event-breakdown-table.test.ts
 *
 * Tests for the capacity resolver used in VenueEventBreakdown rows.
 *
 * Bug #3 (Bristol 2026-05-12):
 *   The Event Breakdown table was reading tier-rollup allocation (e.g. 20 —
 *   a per-tier `quantity_available` slot count) instead of `events.capacity`
 *   (779–918 for Bristol).  This caused rows to show "236/20", "53/20", etc.
 *   and triggered false SOLD OUT badges for every Bristol WC26 fixture.
 *
 *   Fix: `resolveEventCapacity` prefers `events.capacity` when non-null > 0,
 *   falling back to tier allocation only when the event has no capacity yet.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveEventCapacity } from "../event-capacity-resolver.ts";

describe("resolveEventCapacity — Bristol SOLD OUT regression (Bug #3)", () => {
  it("prefers events.capacity over tier allocation when both are set", () => {
    // Bristol: events.capacity=779, tier allocation sum=20 → must return 779
    assert.equal(resolveEventCapacity(779, 20), 779);
    assert.equal(resolveEventCapacity(819, 20), 819);
    assert.equal(resolveEventCapacity(832, 20), 832);
    assert.equal(resolveEventCapacity(918, 20), 918);
  });

  it("% sold stays in 0-100 range with correct capacity (not 1180%)", () => {
    // Pre-fix: Bristol had 236 tickets sold / capacity=20 → soldPct = 1180%
    // Post-fix: Bristol has 236 tickets sold / capacity=779 → soldPct ≈ 30%
    const capacity = resolveEventCapacity(779, 20);
    assert.notEqual(capacity, null);
    const soldPct = (236 / capacity!) * 100;
    assert.ok(soldPct >= 0 && soldPct <= 100, `soldPct=${soldPct.toFixed(1)}% expected 0-100`);
  });

  it("falls back to tier allocation when events.capacity is null (first sync)", () => {
    assert.equal(resolveEventCapacity(null, 500), 500);
    assert.equal(resolveEventCapacity(undefined, 500), 500);
  });

  it("falls back to tier allocation when events.capacity is 0 (not yet set)", () => {
    // capacity=0 should not be used as a denominator — treat as absent
    assert.equal(resolveEventCapacity(0, 500), 500);
  });

  it("returns null when neither source is available", () => {
    assert.equal(resolveEventCapacity(null, null), null);
    assert.equal(resolveEventCapacity(undefined, undefined), null);
    assert.equal(resolveEventCapacity(0, 0), null);
  });

  it("returns null when tier allocation is 0 and event capacity is null", () => {
    assert.equal(resolveEventCapacity(null, 0), null);
  });
});
