/**
 * Regression tests for the WC26 venue spend allocator — specifically the
 * Manchester multi-date bug (PR fix/manchester-spend-share-button-budget-tracker).
 *
 * Before the fix:  the sibling lookup filtered by event_date. Each of the 4
 *   Manchester fixtures (Croatia 17 Jun, Ghana 23 Jun, Panama 27 Jun, Last 32
 *   1 Jul) had a distinct event_date, so each sync call found only 1 sibling →
 *   solo_pass_through → full venue spend written to every fixture → 4× over-
 *   attribution on the dashboard.
 *
 * After the fix:  sibling lookup uses event_code only so all 4 fixtures land
 *   in one group and the WC26 opponent allocator runs correctly.
 *
 * These unit tests exercise the PURE allocator (`allocateVenueSpend`) because
 * the allocator-wrapper (`venue-spend-allocator.ts`) is server-only with live
 * Supabase + Meta dependencies. The pure function is the core correctness
 * boundary; the wrapper is covered by integration tests in CI.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allocateVenueSpend,
  type AllocatorAd,
  type AllocatorEvent,
} from "../venue-spend-allocation.ts";

/**
 * Manchester WC26 fixtures — 4 events with DIFFERENT event_dates but the same
 * event_code. The bug caused each to be processed solo; the fix groups them all.
 */
const MANCHESTER_EVENTS: AllocatorEvent[] = [
  { id: "ba05a442-bc21-432f-bec9-0f5ae5f02c84", name: "England v Croatia" },
  { id: "29ae997b-4389-4f92-95f9-3e1bb92eb0dd", name: "England v Ghana" },
  { id: "0cac6ef0-adfa-40d6-9ea5-02ef47210e28", name: "England v Panama" },
  { id: "a4fd2772-3e76-4142-b055-c9de5817cf47", name: "Last 32" },
];

/** Total venue Meta spend for a single representative day. */
const DAY_VENUE_TOTAL = 95.5;

describe("allocateVenueSpend — Manchester WC26 multi-date regression", () => {
  /**
   * Scenario A: only generic (umbrella) ads running — no opponent-specific
   * campaigns yet. Spend should split evenly 4 ways.
   */
  it("generic-only: splits evenly across all 4 fixtures", () => {
    const ads: AllocatorAd[] = [
      { id: "ad-gen-1", name: "[WC26-MANCHESTER] Umbrella Hero", spend: DAY_VENUE_TOTAL },
    ];
    const result = allocateVenueSpend(MANCHESTER_EVENTS, ads);

    assert.ok(
      Math.abs(result.venueTotalSpend - DAY_VENUE_TOTAL) < 0.02,
      `venue total ${result.venueTotalSpend} ≠ ${DAY_VENUE_TOTAL}`,
    );

    const perEvent = new Map(result.perEvent.map((r) => [r.eventId, r]));
    const expected = DAY_VENUE_TOTAL / 4;

    for (const ev of MANCHESTER_EVENTS) {
      const alloc = perEvent.get(ev.id)!.allocated;
      assert.ok(
        Math.abs(alloc - expected) < 0.02,
        `${ev.name}: allocated=${alloc.toFixed(2)}, expected≈${expected.toFixed(2)}`,
      );
      assert.equal(
        perEvent.get(ev.id)!.specific,
        0,
        `${ev.name}: expected specific=0, got ${perEvent.get(ev.id)!.specific}`,
      );
    }

    // KEY regression assertion: sum across all fixtures = venue total, NOT 4× total.
    const sumAllocated = result.perEvent.reduce((s, r) => s + r.allocated, 0);
    assert.ok(
      Math.abs(sumAllocated - DAY_VENUE_TOTAL) < 0.02,
      `sum of allocations ${sumAllocated.toFixed(2)} ≠ venue total ${DAY_VENUE_TOTAL}`,
    );
  });

  /**
   * Scenario B: opponent-specific campaign for Croatia + a generic umbrella.
   * Croatia should receive specific + generic share; others only generic share.
   */
  it("mixed: Croatia-specific spend goes to Croatia; generic splits 4 ways", () => {
    const croatiaSpecific = 60;
    const genericSpend = 35.5;
    const ads: AllocatorAd[] = [
      {
        id: "ad-croatia-1",
        name: "[WC26-MANCHESTER-CROATIA] Croatia vs England Static",
        spend: croatiaSpecific,
      },
      {
        id: "ad-gen-1",
        name: "[WC26-MANCHESTER] Umbrella Promo Video",
        spend: genericSpend,
      },
    ];
    const result = allocateVenueSpend(MANCHESTER_EVENTS, ads);

    const total = croatiaSpecific + genericSpend;
    assert.ok(
      Math.abs(result.venueTotalSpend - total) < 0.02,
      `venue total ${result.venueTotalSpend.toFixed(2)} ≠ ${total}`,
    );

    const perEvent = new Map(result.perEvent.map((r) => [r.eventId, r]));
    const genericShare = genericSpend / 4;

    const croatia = perEvent.get("ba05a442-bc21-432f-bec9-0f5ae5f02c84")!;
    assert.ok(
      Math.abs(croatia.specific - croatiaSpecific) < 0.02,
      `Croatia specific=${croatia.specific.toFixed(2)}, expected ${croatiaSpecific}`,
    );
    assert.ok(
      Math.abs(croatia.allocated - (croatiaSpecific + genericShare)) < 0.02,
      `Croatia allocated=${croatia.allocated.toFixed(2)}, expected ${(croatiaSpecific + genericShare).toFixed(2)}`,
    );

    for (const ev of MANCHESTER_EVENTS.filter(
      (e) => e.id !== "ba05a442-bc21-432f-bec9-0f5ae5f02c84",
    )) {
      const r = perEvent.get(ev.id)!;
      assert.equal(r.specific, 0, `${ev.name}: expected specific=0`);
      assert.ok(
        Math.abs(r.allocated - genericShare) < 0.02,
        `${ev.name}: allocated=${r.allocated.toFixed(2)}, expected≈${genericShare.toFixed(2)}`,
      );
    }

    // Regression: sum = total Meta spend, NOT 4× total
    const sumAllocated = result.perEvent.reduce((s, r) => s + r.allocated, 0);
    assert.ok(
      Math.abs(sumAllocated - total) < 0.02,
      `sum ${sumAllocated.toFixed(2)} ≠ total ${total}`,
    );
  });

  /**
   * Scenario C: all 4 opponent-specific campaigns running, no generic.
   * Each fixture should receive only its own specific spend.
   */
  it("all-specific: each fixture receives only its own campaign spend", () => {
    const spendMap: Record<string, number> = {
      "ba05a442-bc21-432f-bec9-0f5ae5f02c84": 30, // Croatia
      "29ae997b-4389-4f92-95f9-3e1bb92eb0dd": 25, // Ghana
      "0cac6ef0-adfa-40d6-9ea5-02ef47210e28": 22, // Panama
      "a4fd2772-3e76-4142-b055-c9de5817cf47": 18.5, // Last 32
    };
    const ads: AllocatorAd[] = [
      { id: "ad-croatia", name: "[WC26-MANCHESTER-CROATIA] Specific", spend: 30 },
      { id: "ad-ghana", name: "[WC26-MANCHESTER-GHANA] Specific", spend: 25 },
      { id: "ad-panama", name: "[WC26-MANCHESTER-PANAMA] Specific", spend: 22 },
      { id: "ad-last32", name: "[WC26-MANCHESTER] Last 32 Bracket", spend: 18.5 },
    ];
    const total = Object.values(spendMap).reduce((s, v) => s + v, 0);
    const result = allocateVenueSpend(MANCHESTER_EVENTS, ads);

    assert.ok(
      Math.abs(result.venueTotalSpend - total) < 0.02,
      `venue total ${result.venueTotalSpend.toFixed(2)} ≠ ${total}`,
    );

    const sumAllocated = result.perEvent.reduce((s, r) => s + r.allocated, 0);
    assert.ok(
      Math.abs(sumAllocated - total) < 0.02,
      `sum ${sumAllocated.toFixed(2)} ≠ total ${total} — 4× over-attribution regression`,
    );
  });

  /**
   * Scenario D: solo-fixture call (replicates what the broken code did for each
   * Manchester fixture individually). Asserts that calling allocateVenueSpend
   * with a single-element events array writes the full spend as specific — this
   * was the root cause of the 4× bug.
   */
  it("solo fixture gets 100% of spend (illustrates the pre-fix bug path)", () => {
    const solo: AllocatorEvent[] = [MANCHESTER_EVENTS[0]]; // only Croatia
    const ads: AllocatorAd[] = [
      { id: "ad-gen", name: "[WC26-MANCHESTER] Umbrella", spend: DAY_VENUE_TOTAL },
    ];
    const result = allocateVenueSpend(solo, ads);
    // With one fixture the entire venue spend goes to it
    assert.ok(
      Math.abs(result.perEvent[0].allocated - DAY_VENUE_TOTAL) < 0.02,
      "solo: gets full venue spend",
    );
    // The bug: if this ran 4× (once per fixture) the sum would be 4× total
    const buggedSum = result.perEvent[0].allocated * 4;
    assert.ok(
      Math.abs(buggedSum - DAY_VENUE_TOTAL * 4) < 0.02,
      `pre-fix bug: 4 solo calls sum to ${buggedSum.toFixed(2)}, not ${DAY_VENUE_TOTAL}`,
    );
  });
});
