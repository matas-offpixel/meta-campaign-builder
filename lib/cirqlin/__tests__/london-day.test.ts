import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { londonCalendarDay } from "../london-day.ts";

describe("londonCalendarDay", () => {
  it("uses Europe/London, not UTC, around midnight BST", () => {
    assert.equal(
      londonCalendarDay(new Date("2026-09-15T22:30:00Z")),
      "2026-09-15",
    );
    assert.equal(
      londonCalendarDay(new Date("2026-09-15T23:30:00Z")),
      "2026-09-16",
    );
  });
});
