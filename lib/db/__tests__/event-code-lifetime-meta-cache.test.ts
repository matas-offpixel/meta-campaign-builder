/**
 * lib/db/__tests__/event-code-lifetime-meta-cache.test.ts
 *
 * Round-trip tests for the migration 068 cache wrapper. Validates:
 *   1. The bulk loader returns rows in the shape the portal payload
 *      threads down to `<VenueStatsGrid>`.
 *   2. The single-row loader returns null when no row exists.
 *   3. The upsert builds an `onConflict: "client_id,event_code"` payload
 *      with `fetched_at` stamped on every call (idempotent re-write).
 *   4. The freshness guard returns true when the cached row is within
 *      the configured window AND false when the row is missing or
 *      stale — the cron leg's "skip subsequent siblings" logic
 *      depends on this exact contract.
 *
 * Run with: node --experimental-strip-types --test lib/db/__tests__
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  loadEventCodeLifetimeMetaCache,
  loadEventCodeLifetimeMetaCacheForClient,
  upsertEventCodeLifetimeMetaCache,
  isEventCodeLifetimeMetaCacheFresh,
} from "../event-code-lifetime-meta-cache.ts";

const FROZEN_NOW = "2026-05-13T12:00:00.000Z";

interface UpsertCall {
  table: string;
  payload: Record<string, unknown>;
  options: Record<string, unknown> | undefined;
}

interface SelectCall {
  table: string;
  columns: string;
  filters: Array<[string, string, unknown]>;
  mode: "maybeSingle" | "list";
}

/**
 * Chainable Supabase stub that records every select() and upsert()
 * invocation, returns the configured fixture data, and supports
 * arbitrary `.eq()` / `.gte()` chains. Tests assert against
 * `select_calls` / `upsert_calls` rather than peeking at internal
 * state.
 */
function makeStub(opts: {
  rowsByTable?: Record<string, unknown[] | null>;
  upsertResult?: { error: Error | null };
}) {
  const rowsByTable = opts.rowsByTable ?? {};
  const upsertResult = opts.upsertResult ?? { error: null };
  const upsertCalls: UpsertCall[] = [];
  const selectCalls: SelectCall[] = [];

  function makeChain(table: string, columns: string): unknown {
    const filters: Array<[string, string, unknown]> = [];
    const chain: Record<string, unknown> = {};
    const finalize = (mode: SelectCall["mode"]) => {
      selectCalls.push({ table, columns, filters: [...filters], mode });
      const data = rowsByTable[table] ?? [];
      if (mode === "maybeSingle") {
        return Promise.resolve({
          data: Array.isArray(data) && data.length > 0 ? data[0] : null,
          error: null,
        });
      }
      return Promise.resolve({ data, error: null });
    };
    chain.eq = (col: string, val: unknown) => {
      filters.push(["eq", col, val]);
      return chain;
    };
    chain.gte = (col: string, val: unknown) => {
      filters.push(["gte", col, val]);
      return chain;
    };
    chain.maybeSingle = () => finalize("maybeSingle");
    chain.then = (
      onFulfilled: (v: { data: unknown; error: null }) => unknown,
      onRejected?: (err: unknown) => unknown,
    ) => finalize("list").then(onFulfilled, onRejected);
    return chain;
  }

  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          return makeChain(table, columns);
        },
        upsert(payload: Record<string, unknown>, options: Record<string, unknown>) {
          upsertCalls.push({ table, payload, options });
          return Promise.resolve(upsertResult);
        },
      };
    },
  };

  return { client: client as unknown as SupabaseClient, upsertCalls, selectCalls };
}

describe("event_code_lifetime_meta_cache wrapper", () => {
  it("upsert sets fetched_at to now() and forwards onConflict", async () => {
    const { client, upsertCalls } = makeStub({});
    const result = await upsertEventCodeLifetimeMetaCache(client, {
      clientId: "c-1",
      eventCode: "WC26-MANCHESTER",
      meta_reach: 781_346,
      meta_impressions: 1_500_000,
      meta_link_clicks: 12_500,
      meta_regs: 311,
      meta_video_plays_3s: 95_000,
      meta_video_plays_15s: 14_000,
      meta_video_plays_p100: 4_200,
      meta_engagements: 23_000,
      campaign_names: ["[WC26-MANCHESTER] BOFU", "[WC26-MANCHESTER] TOFU"],
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(upsertCalls.length, 1);
    const call = upsertCalls[0]!;
    assert.equal(call.table, "event_code_lifetime_meta_cache");
    assert.deepEqual(call.options, {
      onConflict: "client_id,event_code",
    });
    assert.equal(call.payload.client_id, "c-1");
    assert.equal(call.payload.event_code, "WC26-MANCHESTER");
    assert.equal(call.payload.meta_reach, 781_346);
    assert.deepEqual(call.payload.campaign_names, [
      "[WC26-MANCHESTER] BOFU",
      "[WC26-MANCHESTER] TOFU",
    ]);
    // fetched_at is an ISO-8601 timestamp produced by the wrapper —
    // assert presence + parseability rather than equality (every test
    // run produces a different timestamp).
    assert.equal(typeof call.payload.fetched_at, "string");
    assert.ok(
      Number.isFinite(Date.parse(call.payload.fetched_at as string)),
      "fetched_at must be a parseable ISO timestamp",
    );
  });

  it("upsert returns the supabase error on failure", async () => {
    const { client } = makeStub({
      upsertResult: { error: new Error("permission denied") as never },
    });
    const result = await upsertEventCodeLifetimeMetaCache(client, {
      clientId: "c-1",
      eventCode: "WC26-MANCHESTER",
      meta_reach: 100,
      meta_impressions: 200,
      meta_link_clicks: 0,
      meta_regs: 0,
      meta_video_plays_3s: 0,
      meta_video_plays_15s: 0,
      meta_video_plays_p100: 0,
      meta_engagements: 0,
      campaign_names: [],
    });
    assert.deepEqual(result, { ok: false, error: "permission denied" });
  });

  it("loadEventCodeLifetimeMetaCache returns null when row is absent", async () => {
    const { client } = makeStub({
      rowsByTable: { event_code_lifetime_meta_cache: [] },
    });
    const result = await loadEventCodeLifetimeMetaCache(client, {
      clientId: "c-1",
      eventCode: "WC26-NOWHERE",
    });
    assert.equal(result, null);
  });

  it("loadEventCodeLifetimeMetaCacheForClient returns the full list", async () => {
    const { client, selectCalls } = makeStub({
      rowsByTable: {
        event_code_lifetime_meta_cache: [
          {
            client_id: "c-1",
            event_code: "WC26-MANCHESTER",
            meta_reach: 781_346,
            meta_impressions: 1_500_000,
            meta_link_clicks: 12_500,
            meta_regs: 311,
            meta_video_plays_3s: 95_000,
            meta_video_plays_15s: 14_000,
            meta_video_plays_p100: 4_200,
            meta_engagements: 23_000,
            campaign_names: ["[WC26-MANCHESTER] BOFU"],
            fetched_at: FROZEN_NOW,
            created_at: FROZEN_NOW,
            updated_at: FROZEN_NOW,
          },
          {
            client_id: "c-1",
            event_code: "WC26-LONDON-SHEPHERDS",
            meta_reach: 175_330,
            meta_impressions: 250_000,
            meta_link_clicks: 12_199,
            meta_regs: 120,
            meta_video_plays_3s: 60_000,
            meta_video_plays_15s: 8_000,
            meta_video_plays_p100: 1_900,
            meta_engagements: 9_000,
            campaign_names: ["[WC26-LONDON-SHEPHERDS] BOFU"],
            fetched_at: FROZEN_NOW,
            created_at: FROZEN_NOW,
            updated_at: FROZEN_NOW,
          },
        ],
      },
    });
    const result = await loadEventCodeLifetimeMetaCacheForClient(client, "c-1");
    assert.equal(result.length, 2);
    const manchester = result.find((r) => r.event_code === "WC26-MANCHESTER")!;
    assert.equal(manchester.meta_reach, 781_346);
    assert.deepEqual(manchester.campaign_names, ["[WC26-MANCHESTER] BOFU"]);
    // The bulk loader must filter by client_id and not pre-narrow by
    // event_code — every venue's row needs to flow through the portal
    // payload at once.
    assert.equal(selectCalls.length, 1);
    assert.deepEqual(selectCalls[0]!.filters, [["eq", "client_id", "c-1"]]);
  });

  it("isEventCodeLifetimeMetaCacheFresh returns true when row exists within freshness window", async () => {
    const { client, selectCalls } = makeStub({
      rowsByTable: {
        event_code_lifetime_meta_cache: [
          { fetched_at: FROZEN_NOW },
        ],
      },
    });
    const fresh = await isEventCodeLifetimeMetaCacheFresh(client, {
      clientId: "c-1",
      eventCode: "WC26-MANCHESTER",
      freshnessSeconds: 30 * 60,
    });
    assert.equal(fresh, true);
    // Must apply the gte filter on fetched_at to deliver the
    // freshness guarantee — without it, a stale row from days ago
    // would falsely return fresh and the cron leg would skip the
    // venue forever.
    const last = selectCalls.at(-1)!;
    assert.ok(
      last.filters.some(([op, col]) => op === "gte" && col === "fetched_at"),
      "freshness check must apply a gte filter on fetched_at",
    );
  });

  it("isEventCodeLifetimeMetaCacheFresh returns false when row is missing", async () => {
    const { client } = makeStub({
      rowsByTable: { event_code_lifetime_meta_cache: [] },
    });
    const fresh = await isEventCodeLifetimeMetaCacheFresh(client, {
      clientId: "c-1",
      eventCode: "WC26-MANCHESTER",
    });
    assert.equal(fresh, false);
  });
});
