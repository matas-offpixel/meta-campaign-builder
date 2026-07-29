/**
 * Bird broadcast schedule formatting.
 *
 * The offset in `startsAt` must match the IANA zone ON THAT DATE — Bird
 * rejects a mismatch, and Lisbon is +01:00 (WEST) in summer but +00:00 (WET)
 * in winter, so a hardcoded offset silently sends an hour wrong half the year.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FIXED_TZ_MISSING_TIMEZONE_BEHAVIOR,
  FIXED_TZ_TIME_IN_PAST_BEHAVIOR,
  scheduledBroadcastSchedule,
  tzOffsetMinutes,
  zonedWallClockToOffsetISO,
} from "../schedule.ts";

test("Lisbon summer time is +01:00 (WEST)", () => {
  assert.equal(
    zonedWallClockToOffsetISO(2026, 8, 4, 16, 45, "Europe/Lisbon"),
    "2026-08-04T16:45:00+01:00",
  );
});

test("Lisbon winter time is +00:00 (WET) — same zone, different offset", () => {
  assert.equal(
    zonedWallClockToOffsetISO(2026, 1, 14, 16, 45, "Europe/Lisbon"),
    "2026-01-14T16:45:00+00:00",
  );
});

test("a zone east of UTC formats correctly", () => {
  assert.equal(
    zonedWallClockToOffsetISO(2026, 8, 4, 9, 5, "Europe/Madrid"),
    "2026-08-04T09:05:00+02:00",
  );
});

test("a zone west of UTC gets a negative offset", () => {
  const iso = zonedWallClockToOffsetISO(2026, 8, 4, 9, 5, "America/New_York");
  assert.equal(iso, "2026-08-04T09:05:00-04:00");
});

test("midnight and single-digit fields are zero-padded", () => {
  assert.equal(
    zonedWallClockToOffsetISO(2026, 3, 9, 0, 0, "Europe/Lisbon"),
    "2026-03-09T00:00:00+00:00",
  );
});

test("the emitted instant round-trips to the intended wall clock", () => {
  // 16:45 Lisbon on 4 Aug is 15:45Z; parsing the offset string must agree.
  const iso = zonedWallClockToOffsetISO(2026, 8, 4, 16, 45, "Europe/Lisbon");
  assert.equal(new Date(iso).toISOString(), "2026-08-04T15:45:00.000Z");
});

test("tzOffsetMinutes tracks the DST boundary", () => {
  // Lisbon switches to WEST on the last Sunday of March 2026 (29 Mar).
  assert.equal(tzOffsetMinutes(new Date("2026-03-28T12:00:00Z"), "Europe/Lisbon"), 0);
  assert.equal(tzOffsetMinutes(new Date("2026-03-30T12:00:00Z"), "Europe/Lisbon"), 60);
});

test("scheduledBroadcastSchedule pins the only fixed-timezone-legal behaviours", () => {
  const s = scheduledBroadcastSchedule({
    year: 2026, month: 8, day: 5, hour: 12, minute: 0, timezone: "Europe/Lisbon",
  });
  assert.deepEqual(s, {
    startsAt: "2026-08-05T12:00:00+01:00",
    timezone: "Europe/Lisbon",
    timeInPastBehavior: "send-immediately",
    missingTimeZoneBehavior: "send-immediately",
  });
  // Guard the constants themselves: Bird rejects every other combination for a
  // fixed zone, so a "safer-looking" edit here would 422 at send-config time.
  assert.equal(FIXED_TZ_TIME_IN_PAST_BEHAVIOR, "send-immediately");
  assert.equal(FIXED_TZ_MISSING_TIMEZONE_BEHAVIOR, "send-immediately");
});
