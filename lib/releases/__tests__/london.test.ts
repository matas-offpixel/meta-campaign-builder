import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { londonDayMonth, todayMark } from "../london.ts";

describe("london date text", () => {
  it("uses the same words for one instant", () => {
    const now = "2026-11-10T20:22:00.000Z";
    assert.equal(londonDayMonth(now), "10 Nov");
    assert.equal(todayMark(now), "Today · 10 Nov");
    assert.equal(londonDayMonth("2026-12-27"), "27 Dec");
  });
});
