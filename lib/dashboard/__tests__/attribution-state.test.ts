/**
 * Tests for the pure four-state attribution classifier
 * (`computeAttributionState`). The bands and state cutoffs are
 * surfaced verbatim by the tile, the events-table column, and the
 * campaigns-tab badge — pinning them here keeps the three consumers
 * in sync.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  attributionSortKey,
  computeAttributionState,
  worstAttributionState,
} from "../attribution-state.ts";

describe("computeAttributionState — four states", () => {
  it("no_data when both sides are zero", () => {
    const c = computeAttributionState({ metaRegs: 0, ticketsTrue: 0 });
    assert.equal(c.state, "no_data");
    assert.equal(c.rate, null);
    assert.equal(c.band, null);
  });

  it("no_data when both sides are null", () => {
    const c = computeAttributionState({ metaRegs: null, ticketsTrue: null });
    assert.equal(c.state, "no_data");
  });

  it("capi_missing when tickets > 0 and metaRegs == 0 (WC26-LONDON-SHEPHERDS)", () => {
    // Headline demo case. Tickets sold but Meta CAPI fired zero
    // events — the surface flags this as "tracking is broken on
    // this event_code".
    const c = computeAttributionState({ metaRegs: 0, ticketsTrue: 61 });
    assert.equal(c.state, "capi_missing");
    assert.equal(c.rate, null);
  });

  it("capi_missing when tickets > 0 and metaRegs is null", () => {
    const c = computeAttributionState({ metaRegs: null, ticketsTrue: 192 });
    assert.equal(c.state, "capi_missing");
  });

  it("over_attributed when metaRegs > tickets (WC26-BRIGHTON: 14,696 vs 1,709)", () => {
    const c = computeAttributionState({
      metaRegs: 14_696,
      ticketsTrue: 1_709,
    });
    assert.equal(c.state, "over_attributed");
    assert.equal(c.rate, null);
    assert.equal(c.band, null);
  });

  it("tracked-green when ratio >= 80%", () => {
    const c = computeAttributionState({ metaRegs: 850, ticketsTrue: 1_000 });
    assert.equal(c.state, "tracked");
    assert.equal(c.band, "green");
    assert(c.rate != null);
    assert(c.rate >= 0.8);
  });

  it("tracked-amber for ratios in [40%, 80%)", () => {
    const c = computeAttributionState({ metaRegs: 600, ticketsTrue: 1_000 });
    assert.equal(c.state, "tracked");
    assert.equal(c.band, "amber");
  });

  it("tracked-red for ratios < 40%", () => {
    // WC26-EDINBURGH: 54 / 1,648 ≈ 3% → tracked-red.
    const c = computeAttributionState({ metaRegs: 54, ticketsTrue: 1_648 });
    assert.equal(c.state, "tracked");
    assert.equal(c.band, "red");
    assert(c.rate != null);
    assert(c.rate < 0.4);
  });

  it("tracked-red on Glasgow SWG3 11% case", () => {
    const c = computeAttributionState({ metaRegs: 54, ticketsTrue: 487 });
    assert.equal(c.state, "tracked");
    assert.equal(c.band, "red");
  });

  it("tracked-green on equal counts", () => {
    const c = computeAttributionState({ metaRegs: 100, ticketsTrue: 100 });
    assert.equal(c.state, "tracked");
    assert.equal(c.band, "green");
    assert.equal(c.rate, 1);
  });

  it("treats Infinity / NaN as zero", () => {
    const c = computeAttributionState({
      metaRegs: Number.NaN,
      ticketsTrue: Number.POSITIVE_INFINITY,
    });
    assert.equal(c.state, "no_data");
  });
});

describe("attributionSortKey — broken-first ordering", () => {
  const cases = [
    [{ state: "over_attributed", rate: null, band: null }, 0],
    [{ state: "capi_missing", rate: null, band: null }, 1],
    [{ state: "tracked", rate: 0.1, band: "red" }, 2],
    [{ state: "tracked", rate: 0.5, band: "amber" }, 3],
    [{ state: "tracked", rate: 0.9, band: "green" }, 4],
    [{ state: "no_data", rate: null, band: null }, 6],
  ] as const;

  for (const [c, expected] of cases) {
    it(`sorts ${c.state}${c.band ? `-${c.band}` : ""} as ${expected}`, () => {
      assert.equal(attributionSortKey(c), expected);
    });
  }
});

describe("worstAttributionState — campaign badge inheritance", () => {
  it("returns no_data for an empty list", () => {
    const w = worstAttributionState([]);
    assert.equal(w.state, "no_data");
  });

  it("picks over_attributed over tracked-green and capi_missing", () => {
    const w = worstAttributionState([
      computeAttributionState({ metaRegs: 800, ticketsTrue: 1_000 }), // tracked-green
      computeAttributionState({ metaRegs: 0, ticketsTrue: 100 }), // capi_missing
      computeAttributionState({ metaRegs: 5_000, ticketsTrue: 100 }), // over_attributed
    ]);
    assert.equal(w.state, "over_attributed");
  });

  it("ignores no_data children", () => {
    const w = worstAttributionState([
      computeAttributionState({ metaRegs: 0, ticketsTrue: 0 }), // no_data
      computeAttributionState({ metaRegs: 800, ticketsTrue: 1_000 }), // tracked-green
    ]);
    assert.equal(w.state, "tracked");
    assert.equal(w.band, "green");
  });

  it("picks tracked-red over tracked-amber over tracked-green", () => {
    const w = worstAttributionState([
      computeAttributionState({ metaRegs: 800, ticketsTrue: 1_000 }), // green
      computeAttributionState({ metaRegs: 500, ticketsTrue: 1_000 }), // amber
      computeAttributionState({ metaRegs: 100, ticketsTrue: 1_000 }), // red
    ]);
    assert.equal(w.state, "tracked");
    assert.equal(w.band, "red");
  });
});
