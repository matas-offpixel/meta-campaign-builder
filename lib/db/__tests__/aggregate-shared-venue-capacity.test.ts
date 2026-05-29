/**
 * lib/db/__tests__/aggregate-shared-venue-capacity.test.ts
 *
 * Workstream A of the WC26 dashboard reconciliation (migration 100).
 *
 * `aggregateSharedVenueCapacity` prefers the venue-total strategic
 * target `events.target_capacity` (MAX across the replicated siblings)
 * and falls back to SUM(events.capacity) when no sibling has a target.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  aggregateSharedVenueCapacity,
  type AggregatableEvent,
} from "../client-dashboard-aggregations.ts";

function ev(
  overrides: Partial<AggregatableEvent> & { id: string },
): AggregatableEvent {
  return {
    event_code: null,
    event_date: null,
    capacity: null,
    prereg_spend: null,
    tickets_sold: null,
    latest_snapshot: null,
    ...overrides,
  };
}

describe("aggregateSharedVenueCapacity", () => {
  it("returns null when no event has target or capacity", () => {
    assert.equal(
      aggregateSharedVenueCapacity([ev({ id: "a", event_code: "X" })]),
      null,
    );
  });

  it("falls back to SUM(capacity) when no target set (preserves prior behaviour)", () => {
    // KOC-* / non-WC26 pattern: per-fixture capacity, no target.
    const rows = [
      ev({ id: "a", event_code: "WC26-GLASGOW-O2", capacity: 693 }),
      ev({ id: "b", event_code: "WC26-GLASGOW-O2", capacity: 529 }),
      ev({ id: "c", event_code: "WC26-GLASGOW-O2", capacity: 450 }),
    ];
    assert.equal(aggregateSharedVenueCapacity(rows), 693 + 529 + 450);
  });

  it("prefers MAX(target_capacity) when set, ignoring per-fixture SUM", () => {
    // Glasgow O2: per-fixture SUM=1,672 but venue target=6,750.
    const rows = [
      ev({
        id: "a",
        event_code: "WC26-GLASGOW-O2",
        capacity: 693,
        target_capacity: 6750,
      }),
      ev({
        id: "b",
        event_code: "WC26-GLASGOW-O2",
        capacity: 529,
        target_capacity: 6750,
      }),
      ev({
        id: "c",
        event_code: "WC26-GLASGOW-O2",
        capacity: 450,
        target_capacity: 6750,
      }),
    ];
    assert.equal(aggregateSharedVenueCapacity(rows), 6750);
  });

  it("Edinburgh: target 5,478 replaces SUM 5,474", () => {
    const rows = [
      ev({ id: "a", event_code: "WC26-EDINBURGH", capacity: 2140, target_capacity: 5478 }),
      ev({ id: "b", event_code: "WC26-EDINBURGH", capacity: 2115, target_capacity: 5478 }),
      ev({ id: "c", event_code: "WC26-EDINBURGH", capacity: 1219, target_capacity: 5478 }),
    ];
    assert.equal(aggregateSharedVenueCapacity(rows), 5478);
  });

  it("Manchester: target 8,200 corrects an over-counted SUM of 13,538", () => {
    const rows = [
      ev({ id: "a", event_code: "WC26-MANCHESTER", capacity: 5052, target_capacity: 8200 }),
      ev({ id: "b", event_code: "WC26-MANCHESTER", capacity: 3246, target_capacity: 8200 }),
      ev({ id: "c", event_code: "WC26-MANCHESTER", capacity: 2770, target_capacity: 8200 }),
      ev({ id: "d", event_code: "WC26-MANCHESTER", capacity: 2470, target_capacity: 8200 }),
    ];
    const sum = 5052 + 3246 + 2770 + 2470;
    assert.equal(sum, 13538);
    assert.equal(aggregateSharedVenueCapacity(rows), 8200);
  });

  it("handles a partial target (one sibling missing target_capacity)", () => {
    // Defensive: MAX over the non-null targets still recovers the venue
    // total even if one fixture row wasn't updated.
    const rows = [
      ev({ id: "a", event_code: "WC26-BRISTOL", capacity: 818, target_capacity: 2706 }),
      ev({ id: "b", event_code: "WC26-BRISTOL", capacity: 778, target_capacity: null }),
    ];
    assert.equal(aggregateSharedVenueCapacity(rows), 2706);
  });

  it("sums independently across multiple venues, each picking target-or-fallback", () => {
    const rows = [
      // venue 1 has a target
      ev({ id: "a", event_code: "WC26-MANCHESTER", capacity: 5052, target_capacity: 8200 }),
      ev({ id: "b", event_code: "WC26-MANCHESTER", capacity: 3246, target_capacity: 8200 }),
      // venue 2 has no target → SUM
      ev({ id: "c", event_code: "WC26-KOC-SOHO", capacity: 1300 }),
      ev({ id: "d", event_code: "WC26-KOC-SOHO", capacity: 1300 }),
    ];
    assert.equal(aggregateSharedVenueCapacity(rows), 8200 + 1300 + 1300);
  });

  it("solo/no-code events fall back to their own id as the venue key", () => {
    const rows = [
      ev({ id: "solo1", event_code: null, capacity: 500 }),
      ev({ id: "solo2", event_code: null, capacity: 300 }),
    ];
    // Two distinct venues (keyed by id) → 500 + 300.
    assert.equal(aggregateSharedVenueCapacity(rows), 800);
  });

  it("a venue with target but null per-fixture capacities still returns target", () => {
    const rows = [
      ev({ id: "a", event_code: "WC26-LEEDS", capacity: null, target_capacity: 3957 }),
    ];
    assert.equal(aggregateSharedVenueCapacity(rows), 3957);
  });
});
