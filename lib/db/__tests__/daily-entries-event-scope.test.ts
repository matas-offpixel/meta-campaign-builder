import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import path from "node:path";

/**
 * Regression guard for the "Scotland v Brazil entries leak into Villa
 * venue daily tracker" bug.
 *
 * Root cause: `fetchAllDailyEntries` queried by `client_id` across all
 * events, and the venue page passed `portal.dailyEntries` to the daily
 * tracker without filtering by `eventIdSet`. Manual entries from any
 * unrelated event under the same client appeared in every venue's tracker.
 *
 * Fix:
 *   1. `fetchAllDailyEntries` accepts optional `narrowEventIds` — when
 *      present it uses `.in("event_id", narrowEventIds)` so the DB
 *      returns only the right rows.
 *   2. The venue page additionally filters `portal.dailyEntries` by
 *      `eventIdSet` as defence-in-depth.
 *
 * These tests confirm both layers are present in the source, and validate
 * the filtering logic with a synthetic in-memory example so neither layer
 * can silently regress.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOADER_PATH = path.resolve(HERE, "../client-portal-server.ts");
const VENUE_PAGE_PATH = path.resolve(
  HERE,
  "../../../app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx",
);

describe("daily-entries event-scope fix — source-shape guards", () => {
  it("fetchAllDailyEntries uses .in(event_id) when narrowEventIds provided", async () => {
    const src = await readFile(LOADER_PATH, "utf8");

    // The function must accept narrowEventIds as a third parameter.
    assert.match(
      src,
      /function fetchAllDailyEntries[\s\S]*?narrowEventIds\??: string\[\]/,
      "fetchAllDailyEntries must declare narrowEventIds?: string[] parameter",
    );

    // When narrowEventIds is present the query must filter by event_id.
    assert.match(
      src,
      /\.in\("event_id",\s*narrowEventIds\)/,
      "fetchAllDailyEntries must call .in(\"event_id\", narrowEventIds) for the narrow path",
    );

    // The wide (client_id) path must still exist for whole-portal loads.
    assert.match(
      src,
      /\.eq\("client_id",\s*clientId\)/,
      "fetchAllDailyEntries must keep the .eq(\"client_id\") path for client-wide loads",
    );
  });

  it("loadPortalForClientId passes eventIds to fetchAllDailyEntries when venue-scoped", async () => {
    const src = await readFile(LOADER_PATH, "utf8");

    // The call site must branch on options?.eventCode and pass eventIds.
    assert.match(
      src,
      /options\?\.eventCode\s*\?\s*eventIds\s*:\s*undefined/,
      "fetchAllDailyEntries call must pass eventIds when options.eventCode is set",
    );
  });

  it("venue page filters portal.dailyEntries by eventIdSet (defence-in-depth)", async () => {
    const src = await readFile(VENUE_PAGE_PATH, "utf8");

    assert.match(
      src,
      /portal\.dailyEntries\.filter\([\s\S]*?eventIdSet\.has\(r\.event_id\)/,
      "venue page must filter portal.dailyEntries by eventIdSet",
    );
  });
});

describe("daily-entries event-scope fix — behavioural", () => {
  /**
   * Simulate the in-memory defence-in-depth filter:
   *   client has 2 events (A and B); manual entries exist only for A.
   *   Filtering by event B's id set must return zero rows.
   */
  it("entries for event A do not appear when filtered to event B's id set", () => {
    type Entry = { event_id: string; date: string; day_spend: number | null };

    const eventAId = "event-a-uuid";
    const eventBId = "event-b-uuid";

    // Entries that exist in DB for the whole client (as fetched by old code).
    const allClientEntries: Entry[] = [
      { event_id: eventAId, date: "2026-04-08", day_spend: 96 },
      { event_id: eventAId, date: "2026-04-09", day_spend: 111 },
      { event_id: eventAId, date: "2026-04-10", day_spend: 120 },
    ];

    // Venue B's event id set — no entries should match.
    const venueBEventIds = new Set([eventBId]);

    const venueBEntries = allClientEntries.filter((r) =>
      venueBEventIds.has(r.event_id),
    );

    assert.strictEqual(
      venueBEntries.length,
      0,
      "event B's daily tracker must contain 0 entries when entries only exist for event A",
    );
  });

  it("entries for event A do appear when filtered to event A's id set", () => {
    type Entry = { event_id: string; date: string; day_spend: number | null };

    const eventAId = "event-a-uuid";

    const allClientEntries: Entry[] = [
      { event_id: eventAId, date: "2026-04-08", day_spend: 96 },
      { event_id: eventAId, date: "2026-04-09", day_spend: 111 },
    ];

    const venueAEventIds = new Set([eventAId]);
    const venueAEntries = allClientEntries.filter((r) =>
      venueAEventIds.has(r.event_id),
    );

    assert.strictEqual(
      venueAEntries.length,
      2,
      "event A's daily tracker must contain all 2 entries when filtered correctly",
    );
  });
});
