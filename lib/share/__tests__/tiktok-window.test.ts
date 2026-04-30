import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveCanonicalTikTokWindow } from "../tiktok-window.ts";

function makeClient(config: {
  oldestSnapshot?: string | null;
  rollupRows?: Array<{ source_tiktok_at: string | null }>;
  manual?: {
    date_range_start: string | null;
    date_range_end: string | null;
    imported_at: string | null;
  } | null;
}) {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      calls.push(table);
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        gte() {
          return builder;
        },
        lte() {
          return builder;
        },
        gt() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle() {
          if (table === "tiktok_active_creatives_snapshots") {
            return Promise.resolve({
              data: config.oldestSnapshot
                ? { window_since: config.oldestSnapshot }
                : null,
              error: null,
            });
          }
          if (table === "tiktok_manual_reports") {
            return Promise.resolve({ data: config.manual ?? null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (value: unknown) => unknown) {
          if (table === "event_daily_rollups") {
            return Promise.resolve(
              resolve({ data: config.rollupRows ?? [], error: null }),
            );
          }
          return Promise.resolve(resolve({ data: [], error: null }));
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("resolveCanonicalTikTokWindow", () => {
  const now = new Date("2026-04-30T12:00:00Z");

  it("computes dated event windows from event date minus 60 days to plus 7 days", async () => {
    const { client } = makeClient({
      rollupRows: [{ source_tiktok_at: "2026-04-29T10:00:00Z" }],
    });
    const window = await resolveCanonicalTikTokWindow(
      client,
      {
        id: "event-1",
        kind: "event",
        event_date: "2026-05-10",
        event_start_at: null,
        campaign_end_at: null,
      },
      now,
    );
    assert.deepEqual(window, {
      since: "2026-03-11",
      until: "2026-04-30",
      source: "computed",
      lastSyncAt: "2026-04-29T10:00:00Z",
      importedAt: null,
    });
  });

  it("uses brand campaign start and end capped at today", async () => {
    const { client } = makeClient({
      rollupRows: [{ source_tiktok_at: "2026-04-28T10:00:00Z" }],
    });
    const window = await resolveCanonicalTikTokWindow(
      client,
      {
        id: "event-1",
        kind: "brand_campaign",
        event_date: null,
        event_start_at: "2026-04-01",
        campaign_end_at: "2026-05-31",
      },
      now,
    );
    assert.equal(window.since, "2026-04-01");
    assert.equal(window.until, "2026-04-30");
    assert.equal(window.source, "computed");
  });

  it("falls back to manual imports when computed windows have no rollup data", async () => {
    const { client } = makeClient({
      rollupRows: [],
      manual: {
        date_range_start: "2026-04-01",
        date_range_end: "2026-04-15",
        imported_at: "2026-04-16T10:00:00Z",
      },
    });
    const window = await resolveCanonicalTikTokWindow(
      client,
      {
        id: "event-1",
        kind: "event",
        event_date: "2026-05-10",
        event_start_at: null,
        campaign_end_at: null,
      },
      now,
    );
    assert.deepEqual(window, {
      since: "2026-04-01",
      until: "2026-04-15",
      source: "manual_fallback",
      lastSyncAt: null,
      importedAt: "2026-04-16T10:00:00Z",
    });
  });

  it("returns empty when computed and manual windows have no data", async () => {
    const { client } = makeClient({ rollupRows: [], manual: null });
    const window = await resolveCanonicalTikTokWindow(
      client,
      {
        id: "event-1",
        kind: "event",
        event_date: "2026-05-10",
        event_start_at: null,
        campaign_end_at: null,
      },
      now,
    );
    assert.equal(window.source, "empty");
    assert.equal(window.since, "2026-03-11");
    assert.equal(window.until, "2026-04-30");
  });
});
