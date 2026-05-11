import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PAST_THRESHOLD_DAYS,
  isPastEvent,
  isPastVenueGroup,
  londonTodayIso,
} from "../event-recency.ts";

// ─── helpers ──────────────────────────────────────────────────────────────

/** Offset a YYYY-MM-DD string by N days (positive = future). */
function offsetDate(dateIso: string, days: number): string {
  const ms = Date.parse(`${dateIso}T00:00:00Z`);
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/** Build a fake Date that represents a fixed London date.
 *
 * Europe/London is UTC+0 in winter / UTC+1 in BST. Rather than
 * fighting timezone offsets in tests, we construct a UTC date whose
 * ISO string matches the desired London date when formatted in
 * Europe/London.  For dates in BST (May–Oct), 01:00 UTC = 02:00 London
 * which is still "the same day".  For dates in GMT (Nov–Mar), UTC
 * midnight = London midnight.  Using T12:00:00Z (noon UTC) is always
 * safe for both hemispheres.
 */
function ukNoon(londonDateIso: string): Date {
  return new Date(`${londonDateIso}T12:00:00Z`);
}

// ─── londonTodayIso ────────────────────────────────────────────────────────

describe("londonTodayIso", () => {
  it("returns the date in YYYY-MM-DD format", () => {
    const now = ukNoon("2026-05-11");
    const result = londonTodayIso(now);
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns the London date for a UTC noon anchor", () => {
    // 2026-05-11 12:00 UTC = 2026-05-11 13:00 BST → still 2026-05-11
    const now = ukNoon("2026-05-11");
    assert.equal(londonTodayIso(now), "2026-05-11");
  });
});

// ─── isPastEvent ───────────────────────────────────────────────────────────

describe("isPastEvent", () => {
  const TODAY_LONDON = "2026-05-11";
  const now = ukNoon(TODAY_LONDON);

  const yesterday = offsetDate(TODAY_LONDON, -1); // 2026-05-10
  const twoDaysAgo = offsetDate(TODAY_LONDON, -2); // 2026-05-09
  const tomorrow = offsetDate(TODAY_LONDON, +1);   // 2026-05-12

  it("today's event is NOT past", () => {
    assert.equal(isPastEvent(TODAY_LONDON, now), false);
  });

  it("yesterday's event is NOT past (within the 1-day grace period)", () => {
    // PAST_THRESHOLD_DAYS = 1: threshold = today - 1 = yesterday
    // yesterday < yesterday → false
    assert.equal(isPastEvent(yesterday, now), false);
  });

  it(`2-day-old event IS past (older than ${PAST_THRESHOLD_DAYS}-day threshold)`, () => {
    // 2026-05-09 < 2026-05-10 → true
    assert.equal(isPastEvent(twoDaysAgo, now), true);
  });

  it("future event is NOT past", () => {
    assert.equal(isPastEvent(tomorrow, now), false);
  });

  it("null event_date is NOT past", () => {
    assert.equal(isPastEvent(null, now), false);
    assert.equal(isPastEvent(undefined, now), false);
    assert.equal(isPastEvent("", now), false);
  });

  it("event_date with time component is handled correctly", () => {
    // event_date may come from the DB with a time offset; strip it.
    assert.equal(isPastEvent(`${twoDaysAgo}T19:00:00`, now), true);
    assert.equal(isPastEvent(`${yesterday}T19:00:00`, now), false);
  });

  it("PAST_THRESHOLD_DAYS constant is 1", () => {
    assert.equal(PAST_THRESHOLD_DAYS, 1);
  });
});

// ─── isPastVenueGroup ──────────────────────────────────────────────────────

describe("isPastVenueGroup", () => {
  const TODAY_LONDON = "2026-05-11";
  const now = ukNoon(TODAY_LONDON);

  const pastDate = offsetDate(TODAY_LONDON, -2);   // 2 days ago = past
  const recentDate = offsetDate(TODAY_LONDON, -1); // yesterday = not past
  const futureDate = offsetDate(TODAY_LONDON, +7); // future = not past

  function ev(date: string | null) {
    return { event_date: date };
  }

  it("empty group is NOT past", () => {
    assert.equal(isPastVenueGroup([], now), false);
  });

  it("[past, past, future] group is NOT past (future fixture still upcoming)", () => {
    assert.equal(
      isPastVenueGroup([ev(pastDate), ev(pastDate), ev(futureDate)], now),
      false,
    );
  });

  it("[past, past, past] group IS past (all fixtures done)", () => {
    assert.equal(
      isPastVenueGroup([ev(pastDate), ev(pastDate), ev(pastDate)], now),
      true,
    );
  });

  it("[past, today, future] group is NOT past", () => {
    assert.equal(
      isPastVenueGroup([ev(pastDate), ev(TODAY_LONDON), ev(futureDate)], now),
      false,
    );
  });

  it("[past, yesterday] group is NOT past (yesterday is within grace period)", () => {
    assert.equal(
      isPastVenueGroup([ev(pastDate), ev(recentDate)], now),
      false,
    );
  });

  it("single-event group with past date IS past", () => {
    assert.equal(isPastVenueGroup([ev(pastDate)], now), true);
  });

  it("single-event group with null date is NOT past", () => {
    assert.equal(isPastVenueGroup([ev(null)], now), false);
  });

  // Arsenal Title Run In scenario (3 fixtures: Man City past, Burnley + Palace upcoming)
  it("Arsenal Title Run In stays ACTIVE when 1 of 3 fixtures is past", () => {
    const manCity = ev(pastDate);    // already played
    const burnley = ev(futureDate);  // upcoming
    const palace = ev(futureDate);   // upcoming
    assert.equal(isPastVenueGroup([manCity, burnley, palace], now), false);
  });

  // Manchester WC26 scenario — all fixtures future until the Last 32 passes
  it("Manchester WC26 stays ACTIVE when Last 32 fixture is still upcoming (July 1)", () => {
    const july1 = "2026-07-01";
    const now_june30 = ukNoon("2026-06-30"); // day before last fixture
    const fixtures = [
      ev("2026-06-17"), // Last 16 — already past relative to Jun 30? No, let's use the right dates
      ev("2026-06-20"), // QF
      ev("2026-06-25"), // SF
      ev(july1),        // Last 32 (final fixture)
    ];
    // Before July 1: July 1 fixture is not past (yesterday of Jun 30 = Jun 29;
    // July 1 > Jun 29 → not past). But Jun 17, 20, 25 are past.
    // Group stays active because July 1 fixture is not past.
    assert.equal(isPastVenueGroup(fixtures, now_june30), false);
  });

  it("Manchester WC26 moves to PAST after all fixtures have passed", () => {
    const july3 = ukNoon("2026-07-03"); // 2 days after last fixture
    const fixtures = [
      ev("2026-06-17"),
      ev("2026-06-20"),
      ev("2026-06-25"),
      ev("2026-07-01"),
    ];
    // threshold = July 3 - 1 = July 2; July 1 < July 2 → past
    assert.equal(isPastVenueGroup(fixtures, july3), true);
  });
});
