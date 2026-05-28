/**
 * lib/dashboard/__tests__/funnel-projection.test.ts
 *
 * Unit tests for the interactive Funnel Pacing projection helper
 * (PR-D of issue #467). Pins the Edinburgh shape and the modelling
 * invariants:
 *
 *   - Required & Suggested ticket trajectories both land exactly on
 *     capacity at event date.
 *   - Required & Suggested differ only in £/day (and cumulative spend).
 *   - Current pace projects from the actual daily spend at live CPT.
 *   - Sellout crossing fires only when Current pace reaches capacity
 *     within the window.
 *   - Edge cases: event passed, sold out, pre-launch (benchmark only).
 *
 * Edinburgh anchor (2026-05-28, from PR #478 verification):
 *   capacity 5,475 / sold 3,812 / remaining 1,663
 *   spent £6,985.72 / spentPerDay £55.01 / liveCPT £1.83
 *   daysToEvent 16 / benchmark CPT £4.80
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildFunnelProjection } from "../funnel-projection.ts";

const TODAY = new Date("2026-05-28T12:00:00Z");

function edinburghInput() {
  return {
    capacity: 5_475,
    ticketsSold: 3_812,
    spent: 6_985.72,
    allocated: 9_915,
    spentPerDay: 55.01,
    liveCostPerTicket: 6_985.72 / 3_812, // ≈ 1.832
    benchmarkCostPerTicket: 4.8,
    daysToEvent: 16,
    daysSinceFirstSpend: 127,
    eventDate: "2026-06-13",
    warning: "additional_needed" as const,
    warningAmount: 118,
    today: TODAY,
  };
}

describe("buildFunnelProjection — Edinburgh shape", () => {
  it("is available and live with all three lines", () => {
    const p = buildFunnelProjection(edinburghInput());
    assert.equal(p.available, true);
    assert.equal(p.campaignLive, true);
    assert.equal(p.lines.length, 3);
    assert.deepEqual(
      p.lines.map((l) => l.key),
      ["current", "required", "suggested"],
    );
  });

  it("Required pace lands exactly on capacity at event date", () => {
    const p = buildFunnelProjection(edinburghInput());
    const required = p.lines.find((l) => l.key === "required")!;
    assert.ok(
      Math.abs(required.endpointTickets - p.capacity) < 1e-6,
      `required endpoint expected ${p.capacity}, got ${required.endpointTickets}`,
    );
    assert.equal(required.reachesCapacity, true);
  });

  it("Suggested pace also lands exactly on capacity at event date", () => {
    const p = buildFunnelProjection(edinburghInput());
    const suggested = p.lines.find((l) => l.key === "suggested")!;
    assert.ok(
      Math.abs(suggested.endpointTickets - p.capacity) < 1e-6,
      `suggested endpoint expected ${p.capacity}, got ${suggested.endpointTickets}`,
    );
  });

  it("Required vs Suggested differ only in £/day; benchmark > live ⇒ suggested spends more", () => {
    const p = buildFunnelProjection(edinburghInput());
    // liveCPT (£1.83) < benchmark (£4.80) → Edinburgh is more efficient
    // than benchmark, so the benchmark-implied daily spend is HIGHER.
    assert.ok(p.requiredPerDay != null && p.suggestedDaily != null);
    assert.ok(
      p.suggestedDaily! > p.requiredPerDay!,
      `expected suggested ${p.suggestedDaily} > required ${p.requiredPerDay}`,
    );
    // Required/day ≈ 1663 × 1.832 / 16 ≈ £190
    assert.ok(
      Math.abs(p.requiredPerDay! - 190.4) < 1,
      `requiredPerDay expected ~190, got ${p.requiredPerDay}`,
    );
    // Suggested/day = 1663 × 4.8 / 16 = £498.9
    assert.ok(
      Math.abs(p.suggestedDaily! - 498.9) < 0.1,
      `suggestedDaily expected ~498.9, got ${p.suggestedDaily}`,
    );
  });

  it("Required and Suggested share the same ticket trajectory on the time axis", () => {
    const p = buildFunnelProjection(edinburghInput());
    const required = p.lines.find((l) => l.key === "required")!;
    const suggested = p.lines.find((l) => l.key === "suggested")!;
    for (let i = 0; i < required.points.length; i++) {
      assert.ok(
        Math.abs(required.points[i]!.tickets - suggested.points[i]!.tickets) < 1e-6,
        `ticket trajectories diverge at sample ${i}`,
      );
    }
    // …but their cumulative spend diverges (different £/day).
    assert.ok(
      Math.abs(required.endpointSpend - suggested.endpointSpend) > 1,
      "spend endpoints should differ",
    );
  });

  it("Current pace falls short of capacity (spentPerDay too low)", () => {
    const p = buildFunnelProjection(edinburghInput());
    const current = p.lines.find((l) => l.key === "current")!;
    // current endpoint = 3812 + 55.01×16/1.832 ≈ 4292 < 5475
    assert.ok(
      current.endpointTickets < p.capacity,
      `current endpoint ${current.endpointTickets} should be < capacity`,
    );
    assert.equal(current.reachesCapacity, false);
    // …so no sellout crossing within the window.
    assert.equal(p.sellout.day, null);
  });

  it("requiredTotalSpend = spent + remaining × liveCPT (spend-axis event marker)", () => {
    const p = buildFunnelProjection(edinburghInput());
    const expected = 6_985.72 + 1_663 * (6_985.72 / 3_812);
    assert.ok(
      p.requiredTotalSpend != null &&
        Math.abs(p.requiredTotalSpend - expected) < 0.01,
      `requiredTotalSpend expected ${expected}, got ${p.requiredTotalSpend}`,
    );
  });

  it("passes the canonical warning + amount straight through", () => {
    const p = buildFunnelProjection(edinburghInput());
    assert.equal(p.warning, "additional_needed");
    assert.equal(p.warningAmount, 118);
  });

  it("first sample point sits at (today, spent, ticketsSold) for every line", () => {
    const p = buildFunnelProjection(edinburghInput());
    for (const line of p.lines) {
      assert.equal(line.points[0]!.day, 0);
      assert.ok(Math.abs(line.points[0]!.spend - p.spent) < 1e-6);
      assert.ok(Math.abs(line.points[0]!.tickets - p.ticketsSold) < 1e-6);
    }
  });
});

describe("buildFunnelProjection — sellout crossing", () => {
  it("fires when Current pace reaches capacity within the window", () => {
    // Bump spentPerDay so current pace sells out before event date.
    const p = buildFunnelProjection({
      ...edinburghInput(),
      spentPerDay: 400, // 1663 × 1.832 / 400 ≈ 7.6 days < 16
    });
    const current = p.lines.find((l) => l.key === "current")!;
    assert.equal(current.reachesCapacity, true);
    assert.ok(p.sellout.day != null && p.sellout.day < p.daysToEvent);
    assert.ok(p.sellout.spend != null);
    assert.equal(typeof p.sellout.date, "string");
  });
});

describe("buildFunnelProjection — edge cases", () => {
  it("event passed (daysToEvent ≤ 0) → unavailable, no lines", () => {
    const p = buildFunnelProjection({ ...edinburghInput(), daysToEvent: -3 });
    assert.equal(p.available, false);
    assert.equal(p.lines.length, 0);
  });

  it("null daysToEvent → unavailable", () => {
    const p = buildFunnelProjection({ ...edinburghInput(), daysToEvent: null });
    assert.equal(p.available, false);
  });

  it("sold out (remaining ≤ 0) → unavailable", () => {
    const p = buildFunnelProjection({
      ...edinburghInput(),
      ticketsSold: 5_475,
    });
    assert.equal(p.available, false);
    assert.equal(p.ticketsRemaining, 0);
  });

  it("pre-launch (no spend / no live CPT) → benchmark line only, not live", () => {
    const p = buildFunnelProjection({
      ...edinburghInput(),
      ticketsSold: 0,
      spent: 0,
      spentPerDay: null,
      liveCostPerTicket: null,
      daysSinceFirstSpend: 0,
    });
    assert.equal(p.available, true);
    assert.equal(p.campaignLive, false);
    // No current (no spend), no required (no live CPT) → suggested only.
    assert.deepEqual(
      p.lines.map((l) => l.key),
      ["suggested"],
    );
    assert.equal(p.requiredPerDay, null);
    assert.ok(p.suggestedDaily != null);
    // Spend-axis event marker falls back to benchmark.
    assert.ok(
      p.requiredTotalSpend != null &&
        Math.abs(p.requiredTotalSpend - 5_475 * 4.8) < 0.01,
    );
  });

  it("null allocated budget is passed through untouched", () => {
    const p = buildFunnelProjection({ ...edinburghInput(), allocated: null });
    assert.equal(p.allocated, null);
  });
});
