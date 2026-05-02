import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  currentSnapshotDailyDelta,
  currentSnapshotMoneyDelta,
} from "../current-snapshot-delta.ts";

describe("currentSnapshotDailyDelta", () => {
  it("writes the current total on the first provider snapshot", () => {
    assert.equal(
      currentSnapshotDailyDelta({ currentTotal: 1731, previousTotal: null }),
      1731,
    );
  });

  it("writes only the growth since the previous snapshot", () => {
    assert.equal(
      currentSnapshotDailyDelta({ currentTotal: 1731, previousTotal: 1648 }),
      83,
    );
  });

  it("does not emit negative sales when the provider total decreases", () => {
    assert.equal(
      currentSnapshotDailyDelta({ currentTotal: 1640, previousTotal: 1648 }),
      0,
    );
  });
});

describe("currentSnapshotMoneyDelta", () => {
  it("writes the current revenue on the first provider snapshot", () => {
    assert.equal(
      currentSnapshotMoneyDelta({ currentTotal: 8530, previousTotal: null }),
      8530,
    );
  });

  it("writes only revenue growth since the previous snapshot", () => {
    assert.equal(
      currentSnapshotMoneyDelta({ currentTotal: 8530, previousTotal: 8125.5 }),
      404.5,
    );
  });

  it("returns null when the provider does not expose revenue", () => {
    assert.equal(
      currentSnapshotMoneyDelta({ currentTotal: null, previousTotal: 8125.5 }),
      null,
    );
  });
});
