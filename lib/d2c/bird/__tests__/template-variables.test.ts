import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractEventUrlSuffix,
  formatEventDate,
  formatPresaleDay,
  formatPresaleTime,
  resolveBirdTemplateVariables,
} from "../template-variables.ts";

/**
 * Fixture mirrors the Throwback Algarve row from the 2026-07-08 bug report:
 *   event_start_at: 2026-08-08 21:00:00+00 → Portugal WEST (UTC+1) → Sat 22:00 local
 *   presale_at:     2026-07-15 11:00:00+00 → UK BST (UTC+1) → Wed 12:00 local
 */
const EVENT = {
  name: "Throwback Algarve",
  event_start_at: "2026-08-08T21:00:00Z",
  presale_at: "2026-07-15T11:00:00Z",
  ticket_url: "https://ra.co/events/2123456",
};
const COPY = {
  artwork_url: "https://cdn.example.com/algarve.jpg",
  whatsapp_community_url: "https://chat.whatsapp.com/BEkbaKi9HUS3Tjl1ULBbe1",
};

describe("formatEventDate / formatPresaleDay", () => {
  it("renders weekday + ordinal day + month, timezone-aware (Portugal WEST, UTC+1)", () => {
    assert.equal(formatEventDate(EVENT.event_start_at, "Europe/Lisbon"), "Saturday 8th August");
  });

  it("renders weekday + ordinal day + month, timezone-aware (UK BST, UTC+1)", () => {
    assert.equal(formatPresaleDay(EVENT.presale_at, "Europe/London"), "Wednesday 15th July");
  });

  it("applies correct ordinal suffixes across the 1st/2nd/3rd/11th-13th/21st edge cases", () => {
    // Fixed UTC noon timestamps in a zero-offset zone to isolate day-of-month only.
    const day = (n: number) => `2026-01-${String(n).padStart(2, "0")}T12:00:00Z`;
    assert.match(formatEventDate(day(1), "UTC"), /^\w+ 1st January$/);
    assert.match(formatEventDate(day(2), "UTC"), /^\w+ 2nd January$/);
    assert.match(formatEventDate(day(3), "UTC"), /^\w+ 3rd January$/);
    assert.match(formatEventDate(day(4), "UTC"), /^\w+ 4th January$/);
    assert.match(formatEventDate(day(11), "UTC"), /^\w+ 11th January$/);
    assert.match(formatEventDate(day(12), "UTC"), /^\w+ 12th January$/);
    assert.match(formatEventDate(day(13), "UTC"), /^\w+ 13th January$/);
    assert.match(formatEventDate(day(21), "UTC"), /^\w+ 21st January$/);
    assert.match(formatEventDate(day(22), "UTC"), /^\w+ 22nd January$/);
    assert.match(formatEventDate(day(23), "UTC"), /^\w+ 23rd January$/);
    assert.match(formatEventDate(day(31), "UTC"), /^\w+ 31st January$/);
  });

  it("returns '' for a null or invalid iso timestamp", () => {
    assert.equal(formatEventDate(null, "Europe/London"), "");
    assert.equal(formatEventDate("not-a-date", "Europe/London"), "");
    assert.equal(formatPresaleDay(null, "Europe/London"), "");
  });
});

describe("formatPresaleTime", () => {
  it("renders 24-hour zero-padded HH:MM, timezone-aware", () => {
    assert.equal(formatPresaleTime(EVENT.presale_at, "Europe/London"), "12:00");
  });

  it("never renders AM/PM (24-hour only)", () => {
    const eveningIso = "2026-07-15T22:30:00Z"; // 23:30 in UK BST
    assert.equal(formatPresaleTime(eveningIso, "Europe/London"), "23:30");
  });

  it("returns '' for a null or invalid iso timestamp", () => {
    assert.equal(formatPresaleTime(null, "Europe/London"), "");
    assert.equal(formatPresaleTime("nope", "Europe/London"), "");
  });
});

describe("extractEventUrlSuffix", () => {
  it("extracts the last path segment from an RA.co /events/ URL", () => {
    assert.equal(extractEventUrlSuffix("https://ra.co/events/2123456"), "2123456");
  });

  it("extracts the last path segment when there is no /events/ prefix", () => {
    assert.equal(extractEventUrlSuffix("https://ra.co/2375157"), "2375157");
  });

  it("strips query string / fragment / trailing slash", () => {
    assert.equal(extractEventUrlSuffix("https://ra.co/events/2123456/?ref=ig#top"), "2123456");
    assert.equal(extractEventUrlSuffix("https://ra.co/events/2123456/"), "2123456");
  });

  it("returns '' for null/empty input", () => {
    assert.equal(extractEventUrlSuffix(null), "");
    assert.equal(extractEventUrlSuffix(""), "");
    assert.equal(extractEventUrlSuffix("   "), "");
  });
});

describe("resolveBirdTemplateVariables", () => {
  it("returns exactly the 7-variable union (6 from the ask + event_url_suffix) with correctly formatted values", () => {
    const result = resolveBirdTemplateVariables({
      event: EVENT,
      copy: COPY,
      timezone: "Europe/London",
    });
    assert.deepEqual(result, {
      event_name: "Throwback Algarve",
      event_date: "Saturday 8th August",
      presale_day: "Wednesday 15th July",
      presale_time: "12:00",
      event_artwork_url: "https://cdn.example.com/algarve.jpg",
      wa_community_invite: "BEkbaKi9HUS3Tjl1ULBbe1",
      event_url_suffix: "2123456",
    });
  });

  it("extracts the WhatsApp invite CODE, not the full community URL (button URL would double the domain otherwise)", () => {
    const result = resolveBirdTemplateVariables({
      event: EVENT,
      copy: COPY,
      timezone: "Europe/London",
    });
    assert.equal(result.wa_community_invite, "BEkbaKi9HUS3Tjl1ULBbe1");
    assert.doesNotMatch(result.wa_community_invite, /chat\.whatsapp\.com/);
  });

  it("falls back to '' for every field when event/copy data is entirely missing", () => {
    const result = resolveBirdTemplateVariables({
      event: { name: "", event_start_at: null, presale_at: null, ticket_url: null },
      copy: { artwork_url: null, whatsapp_community_url: null },
      timezone: "Europe/London",
    });
    assert.deepEqual(result, {
      event_name: "",
      event_date: "",
      presale_day: "",
      presale_time: "",
      event_artwork_url: "",
      wa_community_invite: "",
      event_url_suffix: "",
    });
  });

  it("is timezone-sensitive: the same UTC instant renders a different local day/time in a different zone", () => {
    const madridResult = resolveBirdTemplateVariables({
      event: EVENT,
      copy: COPY,
      timezone: "Europe/Madrid",
    });
    // Madrid (CEST, UTC+2) is one hour ahead of Lisbon (WEST, UTC+1) —
    // 21:00 UTC → 23:00 Madrid, same calendar day, so the date stays the
    // same but presale_time (11:00 UTC → 13:00 CEST) shifts.
    assert.equal(madridResult.presale_time, "13:00");
  });
});
