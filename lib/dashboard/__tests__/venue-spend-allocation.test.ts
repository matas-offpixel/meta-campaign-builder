import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  allocateVenueSpend,
  integerAllocationsByEvent,
  type AllocatorAd,
  type AllocatorEvent,
} from "../venue-spend-allocation.ts";

/**
 * The worked example the PR brief hangs everything on: Brighton,
 * four games, £3,328.02 total — of which £1,081.62 was Croatia-
 * specific and the rest generic. Expected result matches the
 * client-facing breakdown in the brief.
 */
const BRIGHTON_EVENTS: AllocatorEvent[] = [
  { id: "brighton-croatia", name: "England v Croatia" },
  { id: "brighton-ghana", name: "England v Ghana" },
  { id: "brighton-panama", name: "England v Panama" },
  { id: "brighton-last-32", name: "Last 32" },
];

describe("allocateVenueSpend — brief's worked example (Brighton)", () => {
  it("distributes Croatia-specific spend to Croatia + splits the rest evenly", () => {
    const ads: AllocatorAd[] = [
      { id: "a1", name: "WC26 Croatia Static 01", spend: 500 },
      { id: "a2", name: "WC26 Croatia Video 01", spend: 581.62 },
      { id: "a3", name: "WC26 Generic On-sale Hero", spend: 1200 },
      { id: "a4", name: "WC26 Brighton Fan Park Trailer", spend: 1046.4 },
    ];
    const result = allocateVenueSpend(BRIGHTON_EVENTS, ads);

    assert.equal(result.venueTotalSpend.toFixed(2), "3328.02");
    assert.equal(result.genericPool.toFixed(2), "2246.40");
    assert.equal(result.genericSharePerEvent.toFixed(2), "561.60");

    const byId = new Map(result.perEvent.map((r) => [r.eventId, r]));
    assert.equal(byId.get("brighton-croatia")!.specific.toFixed(2), "1081.62");
    assert.equal(byId.get("brighton-croatia")!.allocated.toFixed(2), "1643.22");
    assert.equal(byId.get("brighton-ghana")!.allocated.toFixed(2), "561.60");
    assert.equal(byId.get("brighton-panama")!.allocated.toFixed(2), "561.60");
    assert.equal(
      byId.get("brighton-last-32")!.allocated.toFixed(2),
      "561.60",
    );

    // Per-event allocations reconcile exactly to the venue total —
    // the reconcileRoundingDrift absorbs any float residual onto the
    // last event so the Total row on the card never drifts.
    const sum = result.perEvent.reduce((a, r) => a + r.allocated, 0);
    assert.ok(Math.abs(sum - result.venueTotalSpend) < 1e-9);
  });
});

describe("allocateVenueSpend — edge cases", () => {
  it("handles an empty event list", () => {
    const result = allocateVenueSpend([], [
      { id: "a1", name: "whatever", spend: 100 },
    ]);
    assert.deepEqual(result.perEvent, []);
    assert.equal(result.venueTotalSpend, 100);
    assert.equal(result.genericPool, 100);
    assert.equal(result.genericSharePerEvent, 0);
  });

  it("handles an empty ad list (events get zero allocations)", () => {
    const result = allocateVenueSpend(BRIGHTON_EVENTS, []);
    assert.equal(result.perEvent.length, 4);
    for (const r of result.perEvent) {
      assert.equal(r.specific, 0);
      assert.equal(r.genericShare, 0);
      assert.equal(r.allocated, 0);
    }
    assert.equal(result.venueTotalSpend, 0);
    assert.equal(result.genericPool, 0);
  });

  it("splits a single generic ad evenly across all events", () => {
    const result = allocateVenueSpend(BRIGHTON_EVENTS, [
      { id: "a1", name: "WC26 Brighton Hero", spend: 400 },
    ]);
    for (const r of result.perEvent) {
      assert.equal(r.specific, 0);
      assert.equal(r.genericShare, 100);
      assert.equal(r.allocated, 100);
    }
  });

  it("treats negative / NaN / undefined spend as zero", () => {
    const result = allocateVenueSpend(BRIGHTON_EVENTS, [
      { id: "a1", name: "WC26 Croatia", spend: Number.NaN },
      { id: "a2", name: "WC26 Generic", spend: -50 },
      { id: "a3", name: "WC26 Ghana", spend: 200 },
    ]);
    assert.equal(result.venueTotalSpend, 200);
    const ghana = result.perEvent.find((r) => r.eventId === "brighton-ghana")!;
    assert.equal(ghana.specific, 200);
    assert.equal(ghana.allocated, 200);
  });

  it("returns zero specific spend for knockouts even when ad mentions 'final'", () => {
    const result = allocateVenueSpend(BRIGHTON_EVENTS, [
      // Ad name incidentally mentions "final" — knockouts have no
      // opponent so they never pull specific spend, they only share
      // the generic pool.
      { id: "a1", name: "WC26 Generic Final Push", spend: 400 },
    ]);
    const knockout = result.perEvent.find(
      (r) => r.eventId === "brighton-last-32",
    )!;
    assert.equal(knockout.specific, 0);
    assert.equal(knockout.allocated, 100);
  });

  it("attributes correctly when two ads match two different opponents", () => {
    const result = allocateVenueSpend(BRIGHTON_EVENTS, [
      { id: "a1", name: "WC26 Croatia Static", spend: 300 },
      { id: "a2", name: "WC26 Ghana Static", spend: 500 },
      { id: "a3", name: "WC26 Panama Video", spend: 200 },
      { id: "a4", name: "WC26 Generic Hero", spend: 400 },
    ]);
    const byId = new Map(result.perEvent.map((r) => [r.eventId, r]));
    assert.equal(byId.get("brighton-croatia")!.specific, 300);
    assert.equal(byId.get("brighton-ghana")!.specific, 500);
    assert.equal(byId.get("brighton-panama")!.specific, 200);
    assert.equal(byId.get("brighton-last-32")!.specific, 0);
    // Each event picks up 100 from the £400 generic pool split 4 ways.
    for (const r of result.perEvent) {
      assert.equal(r.genericShare, 100);
    }
  });

  it("reconciles per-event allocations to the venue total exactly", () => {
    // 3 events, 10.00 generic pool → 3.333… share each. Absent
    // reconciliation, the sum of rounded allocations would drift
    // below 10.00. The allocator puts the residual on the last
    // event so Σ allocated === venue total.
    const events: AllocatorEvent[] = [
      { id: "e1", name: "England v A" },
      { id: "e2", name: "England v B" },
      { id: "e3", name: "England v C" },
    ];
    const ads: AllocatorAd[] = [
      { id: "a1", name: "WC26 Generic", spend: 10 },
    ];
    const result = allocateVenueSpend(events, ads);
    const sum = result.perEvent.reduce((a, r) => a + r.allocated, 0);
    assert.ok(Math.abs(sum - 10) < 1e-9, `sum=${sum}`);
  });
});

describe("integerAllocationsByEvent", () => {
  it("rounds allocated click shares while preserving the venue total", () => {
    const events: AllocatorEvent[] = [
      { id: "e1", name: "England v A" },
      { id: "e2", name: "England v B" },
      { id: "e3", name: "England v C" },
      { id: "e4", name: "Last 32" },
    ];
    const allocations = integerAllocationsByEvent(
      events,
      events.map((event) => ({ eventId: event.id, value: 0.75 })),
      3,
    );

    assert.equal([...allocations.values()].reduce((sum, n) => sum + n, 0), 3);
    assert.equal(allocations.get("e4"), 0);
  });

  it("assigns tiny generic click pools instead of dropping them", () => {
    const events: AllocatorEvent[] = [
      { id: "e1", name: "England v A" },
      { id: "e2", name: "England v B" },
      { id: "e3", name: "England v C" },
      { id: "e4", name: "Last 32" },
    ];
    const allocations = integerAllocationsByEvent(
      events,
      events.map((event) => ({ eventId: event.id, value: 0.25 })),
      1,
    );

    assert.equal([...allocations.values()].reduce((sum, n) => sum + n, 0), 1);
    assert.equal(allocations.get("e4"), 1);
  });
});
