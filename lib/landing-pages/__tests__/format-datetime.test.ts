import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatEventDateShort,
  formatPresaleHeaderLabel,
  formatPresaleNotifyDate,
} from "../format-datetime.ts";

/**
 * PR 7 (extended PR 8): copy-sensitive date formatters extracted from the
 * component tree specifically so the exact strings Matas specified are
 * pinned here rather than eyeballed in JSX. All three are always
 * Europe/London.
 */

describe("formatPresaleHeaderLabel", () => {
  it('"Presale: HH:mm EEE d MMMM" in BST (summer, +1h vs UTC)', () => {
    // 2026-07-08 10:00 UTC → 11:00 BST, Wednesday — the Jackies Mallorca
    // seed data's real presale_at/countdown_target_at value.
    assert.equal(
      formatPresaleHeaderLabel("2026-07-08T10:00:00Z"),
      "Presale: 11:00 Wed 8 July",
    );
  });

  it("in GMT (winter, no offset)", () => {
    assert.equal(
      formatPresaleHeaderLabel("2026-01-10T12:00:00Z"),
      "Presale: 12:00 Sat 10 January",
    );
  });
});

describe("formatPresaleNotifyDate", () => {
  it('"d MMM at HH:mm" — the post-signup confirmation fragment', () => {
    assert.equal(
      formatPresaleNotifyDate("2026-07-08T10:00:00Z"),
      "8 Jul at 11:00",
    );
  });

  it("single-digit day has no leading zero (numeric, not 2-digit)", () => {
    assert.equal(
      formatPresaleNotifyDate("2026-07-01T09:00:00Z"),
      "1 Jul at 10:00",
    );
  });
});

describe("formatEventDateShort", () => {
  it('"EEE d MMM" — the header meta row date, no year/time', () => {
    // 2026-08-16T16:00:00Z → 17:00 BST on the date, but only the date
    // parts matter here — the Jackies Mallorca seed's real event_start_at.
    assert.equal(formatEventDateShort("2026-08-16T16:00:00Z"), "Sun 16 Aug");
  });

  it("single-digit day has no leading zero", () => {
    assert.equal(formatEventDateShort("2026-07-01T09:00:00Z"), "Wed 1 Jul");
  });

  it("a UTC-midnight timestamp near a DST boundary still lands on the correct London date", () => {
    // 2026-01-10T00:30:00Z is GMT (no offset) — still 10 January locally.
    assert.equal(formatEventDateShort("2026-01-10T00:30:00Z"), "Sat 10 Jan");
  });
});
