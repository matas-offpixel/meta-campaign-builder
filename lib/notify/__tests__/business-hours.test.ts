import { test } from "node:test";
import assert from "node:assert/strict";

import { isBusinessHours } from "../business-hours.ts";

// GMT (winter) fixtures — Europe/London == UTC+0, Mon 2026-01-05.
test("GMT: 09:00 London (before hours) is not business hours", () => {
  assert.equal(isBusinessHours(new Date("2026-01-05T09:00:00Z")), false);
});

test("GMT: 10:00 London (opening instant) is business hours", () => {
  assert.equal(isBusinessHours(new Date("2026-01-05T10:00:00Z")), true);
});

test("GMT: 19:59 London (last minute) is business hours", () => {
  assert.equal(isBusinessHours(new Date("2026-01-05T19:59:00Z")), true);
});

test("GMT: 20:00 London (closing instant, exclusive) is not business hours", () => {
  assert.equal(isBusinessHours(new Date("2026-01-05T20:00:00Z")), false);
});

test("weekend (Saturday) is never business hours, even at midday", () => {
  assert.equal(isBusinessHours(new Date("2026-01-03T12:00:00Z")), false);
});

// BST (summer) fixtures — Europe/London == UTC+1, Mon 2026-07-06. Same UTC
// clock times as the GMT case above land one hour later in London, proving
// the DST offset is actually applied rather than a hard-coded +0.
test("BST: 08:00 UTC (09:00 London, before hours) is not business hours", () => {
  assert.equal(isBusinessHours(new Date("2026-07-06T08:00:00Z")), false);
});

test("BST: 09:00 UTC (10:00 London, opening instant) is business hours", () => {
  assert.equal(isBusinessHours(new Date("2026-07-06T09:00:00Z")), true);
});

test("BST: 19:00 UTC (20:00 London, closing instant) is not business hours", () => {
  assert.equal(isBusinessHours(new Date("2026-07-06T19:00:00Z")), false);
});

test("defaults to Europe/London when no timezone is passed", () => {
  assert.equal(isBusinessHours(new Date("2026-01-05T10:00:00Z")), true);
});

test("a different timezone shifts the window", () => {
  // 2026-01-05T10:00:00Z is 05:00 in America/New_York (winter, UTC-5) — before hours there.
  assert.equal(isBusinessHours(new Date("2026-01-05T10:00:00Z"), "America/New_York"), false);
  // 2026-01-05T15:00:00Z is 10:00 in America/New_York — opening instant there.
  assert.equal(isBusinessHours(new Date("2026-01-05T15:00:00Z"), "America/New_York"), true);
});
