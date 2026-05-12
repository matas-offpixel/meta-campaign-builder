import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  filterCodeMatchEligibleIds,
  mergeActiveCreativesEligibilityIds,
} from "../../../lib/dashboard/cron-eligibility.ts";

/**
 * Unit tests for cron eligibility helpers.
 *
 * Regression guard for two bugs:
 *  1. "upcoming" events excluded from code-match eligibility — Villa
 *     FanPark and Palace Steel Yard had active Meta campaigns but
 *     CODE_MATCH_STATUSES didn't include "upcoming", so the cron
 *     never warmed their snapshots.
 *  2. Merge logic — the union of linkedAndDated + codeMatch must not
 *     duplicate IDs when an event qualifies via both paths.
 */

const NOW = new Date("2026-05-12T12:00:00Z");
const RECENT_DATE = "2026-05-20"; // within 180-day lookback
const OLD_DATE = "2025-09-01"; // exactly 253 days before NOW — beyond 180-day cutoff

describe("filterCodeMatchEligibleIds", () => {
  it("includes on_sale events with event_code and recent event_date", () => {
    const ids = filterCodeMatchEligibleIds(
      [{ id: "evt-1", event_code: "WC26-MANCHESTER", status: "on_sale", event_date: RECENT_DATE }],
      NOW,
    );
    assert.deepEqual(ids, ["evt-1"]);
  });

  it("includes live events", () => {
    const ids = filterCodeMatchEligibleIds(
      [{ id: "evt-2", event_code: "WC26-LONDON", status: "live", event_date: RECENT_DATE }],
      NOW,
    );
    assert.deepEqual(ids, ["evt-2"]);
  });

  it("includes upcoming events with event_code and recent event_date", () => {
    // Regression: Villa FanPark (status=upcoming) was previously excluded.
    const ids = filterCodeMatchEligibleIds(
      [
        { id: "villa-fanpark", event_code: "4TF26-VILLA-FINAL", status: "upcoming", event_date: "2026-05-20" },
        { id: "palace-steelyard", event_code: "4TF26-PALACE-FINAL", status: "upcoming", event_date: "2026-05-27" },
      ],
      NOW,
    );
    assert.deepEqual(ids.sort(), ["palace-steelyard", "villa-fanpark"]);
  });

  it("includes upcoming events with null event_date", () => {
    // Placeholder events (e.g. Margate) with no event_date pass the
    // IS NULL clause and are included. If their event_code has no
    // active campaigns the cron gets kind='skip' — harmless.
    const ids = filterCodeMatchEligibleIds(
      [{ id: "placeholder", event_code: "WC26-MARGATE", status: "upcoming", event_date: null }],
      NOW,
    );
    assert.deepEqual(ids, ["placeholder"]);
  });

  it("excludes events with no event_code", () => {
    const ids = filterCodeMatchEligibleIds(
      [{ id: "evt-no-code", event_code: null, status: "on_sale", event_date: RECENT_DATE }],
      NOW,
    );
    assert.deepEqual(ids, []);
  });

  it("excludes events with empty event_code", () => {
    const ids = filterCodeMatchEligibleIds(
      [{ id: "evt-empty-code", event_code: "", status: "on_sale", event_date: RECENT_DATE }],
      NOW,
    );
    assert.deepEqual(ids, []);
  });

  it("excludes cancelled events", () => {
    const ids = filterCodeMatchEligibleIds(
      [{ id: "evt-cancelled", event_code: "4TF26-ARSENAL-CL-SF", status: "cancelled", event_date: RECENT_DATE }],
      NOW,
    );
    assert.deepEqual(ids, []);
  });

  it("excludes completed events", () => {
    const ids = filterCodeMatchEligibleIds(
      [{ id: "evt-completed", event_code: "4TF26-ARSENAL-CL-QF", status: "completed", event_date: RECENT_DATE }],
      NOW,
    );
    assert.deepEqual(ids, []);
  });

  it("excludes events whose event_date is beyond the 180-day lookback", () => {
    const ids = filterCodeMatchEligibleIds(
      [{ id: "evt-old", event_code: "WC26-OLD", status: "on_sale", event_date: OLD_DATE }],
      NOW,
    );
    assert.deepEqual(ids, []);
  });

  it("deduplicates repeated ids", () => {
    const ids = filterCodeMatchEligibleIds(
      [
        { id: "evt-dup", event_code: "CODE", status: "on_sale", event_date: RECENT_DATE },
        { id: "evt-dup", event_code: "CODE", status: "live", event_date: RECENT_DATE },
      ],
      NOW,
    );
    assert.deepEqual(ids, ["evt-dup"]);
  });
});

describe("mergeActiveCreativesEligibilityIds", () => {
  it("eligible = union(linkedAndDated, codeMatch) with no duplicates", () => {
    // evt-a: ticketing + sale date → linkedAndDated only
    // evt-b: code match only
    // evt-c: both paths (would appear in both sets without dedup)
    const ids = mergeActiveCreativesEligibilityIds({
      ticketingIds: ["evt-a", "evt-c"],
      saleDateIds: ["evt-a", "evt-c"],
      codeMatchIds: ["evt-b", "evt-c"],
    });
    assert.deepEqual(ids.sort(), ["evt-a", "evt-b", "evt-c"]);
  });

  it("returns empty when all sets are empty", () => {
    const ids = mergeActiveCreativesEligibilityIds({
      ticketingIds: [],
      saleDateIds: [],
      codeMatchIds: [],
    });
    assert.deepEqual(ids, []);
  });

  it("codeMatch events qualify even without ticketing link", () => {
    const ids = mergeActiveCreativesEligibilityIds({
      ticketingIds: [],
      saleDateIds: [],
      codeMatchIds: ["evt-code-only"],
    });
    assert.deepEqual(ids, ["evt-code-only"]);
  });

  it("ticketing-only events (no sale date) are NOT eligible via linkedAndDated", () => {
    // Events with ticketing but outside the ±60-day sale window
    // must still qualify via codeMatch to be eligible.
    const ids = mergeActiveCreativesEligibilityIds({
      ticketingIds: ["evt-ticketing-only"],
      saleDateIds: [],
      codeMatchIds: [],
    });
    assert.deepEqual(ids, []);
  });
});
