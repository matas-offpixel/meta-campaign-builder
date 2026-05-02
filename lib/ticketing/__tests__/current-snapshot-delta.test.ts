import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { currentSnapshotDailyDelta } from "../current-snapshot-delta.ts";

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
