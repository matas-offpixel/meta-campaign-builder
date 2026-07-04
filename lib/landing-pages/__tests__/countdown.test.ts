import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeCountdown, padCountdownValue } from "../countdown.ts";

/**
 * Countdown math (PR 6) — the logic seam behind countdown-block.tsx. The
 * component only ticks setInterval and renders; everything assertable
 * lives here (node:test runs with the react-server condition, so client
 * components are exercised at this seam, not via DOM render).
 */

const NOW = Date.parse("2026-07-04T12:00:00Z");

describe("computeCountdown", () => {
  it("future target → exact day/hour/min/sec split", () => {
    // +2d 3h 4m 5s
    const target = new Date(
      NOW + ((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000,
    ).toISOString();
    assert.deepEqual(computeCountdown(target, NOW), {
      days: 2,
      hours: 3,
      mins: 4,
      secs: 5,
    });
  });

  it("ticks down second by second", () => {
    const target = new Date(NOW + 61_000).toISOString();
    assert.deepEqual(computeCountdown(target, NOW), {
      days: 0,
      hours: 0,
      mins: 1,
      secs: 1,
    });
    assert.deepEqual(computeCountdown(target, NOW + 1_000), {
      days: 0,
      hours: 0,
      mins: 1,
      secs: 0,
    });
    assert.deepEqual(computeCountdown(target, NOW + 60_000), {
      days: 0,
      hours: 0,
      mins: 0,
      secs: 1,
    });
  });

  it("past or exactly-now target → null (the component's hide signal)", () => {
    const past = new Date(NOW - 1_000).toISOString();
    assert.equal(computeCountdown(past, NOW), null);
    const exact = new Date(NOW).toISOString();
    assert.equal(computeCountdown(exact, NOW), null);
  });

  it("unparseable target → null, never NaN cells", () => {
    assert.equal(computeCountdown("not-a-date", NOW), null);
    assert.equal(computeCountdown("", NOW), null);
  });

  it("long countdowns keep days unbounded (no 99 cap)", () => {
    const target = new Date(NOW + 400 * 24 * 3600 * 1000).toISOString();
    assert.equal(computeCountdown(target, NOW)?.days, 400);
  });
});

describe("padCountdownValue", () => {
  it("zero-pads to 2 digits; 3-digit day counts pass through", () => {
    assert.equal(padCountdownValue(0), "00");
    assert.equal(padCountdownValue(7), "07");
    assert.equal(padCountdownValue(59), "59");
    assert.equal(padCountdownValue(400), "400");
  });
});
