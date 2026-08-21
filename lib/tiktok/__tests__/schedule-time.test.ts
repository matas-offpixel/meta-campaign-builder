import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatWallClockForTikTok,
  resolveScheduleInstant,
} from "../write/schedule-time.ts";

describe("formatWallClockForTikTok", () => {
  it("converts an instant into America/New_York, not UTC or London", () => {
    const ny = formatWallClockForTikTok(
      "2026-01-15T17:00:00.000Z",
      "America/New_York",
    );
    assert.equal(ny, "2026-01-15 12:00:00");
    const utc = formatWallClockForTikTok(
      "2026-01-15T17:00:00.000Z",
      "UTC",
    );
    assert.equal(utc, "2026-01-15 17:00:00");
    const london = formatWallClockForTikTok(
      "2026-01-15T17:00:00.000Z",
      "Europe/London",
    );
    assert.equal(london, "2026-01-15 17:00:00");
    assert.notEqual(ny, utc);
    assert.notEqual(ny, london);
  });

  it("keeps a naive datetime-local as the advertiser wall clock", () => {
    assert.equal(
      formatWallClockForTikTok("2026-08-21T12:50", "America/New_York"),
      "2026-08-21 12:50:00",
    );
    assert.equal(
      formatWallClockForTikTok("2026-08-28T18:00", "America/New_York"),
      "2026-08-28 18:00:00",
    );
  });
});

describe("resolveScheduleInstant", () => {
  it("reads a naive America/New_York wall clock as that zone, not UTC", () => {
    const instant = resolveScheduleInstant(
      "2026-08-21T12:00",
      "America/New_York",
    );
    assert.ok(instant);
    assert.equal(instant.toISOString(), "2026-08-21T16:00:00.000Z");
  });
});
