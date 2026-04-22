// ─────────────────────────────────────────────────────────────────────────────
// share-snapshots cache tests.
//
// Run with:  node --experimental-strip-types --test lib/db/__tests__
// (Node 22.6+ strips TS at runtime; matches the lib/pricing test harness.)
//
// We don't import a real Supabase client — every test stubs the
// chained query builder with a tiny recorder so we can assert on
// the columns and filters the helper actually applies.
// ─────────────────────────────────────────────────────────────────────────────

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  readShareSnapshot,
  writeShareSnapshot,
  SHARE_SNAPSHOT_TTL_MS,
  type ShareSnapshotPayload,
} from "../share-snapshots.ts";

// ── tiny mock helpers ──────────────────────────────────────────────────────

interface ReadRecorder {
  table: string | null;
  selects: string[];
  eqs: Array<{ col: string; val: unknown }>;
  order: { col: string; opts: Record<string, unknown> } | null;
  limit: number | null;
  /** What `.maybeSingle()` resolves with. */
  result: { data: unknown; error: unknown };
}

interface WriteRecorder {
  table: string | null;
  upserts: unknown[];
  upsertOpts: Record<string, unknown> | null;
  /** What the awaited upsert returns. */
  result: { data: unknown; error: unknown };
}

/**
 * Build a `SupabaseClient`-shaped object exposing a single
 * `.from(table)` whose chained methods record their args. Only the
 * methods the cache helper actually uses are populated; anything
 * else throws so a future change that broadens the surface fails
 * loudly instead of silently no-oping.
 */
function makeReadStub(
  result: { data: unknown; error: unknown },
): { client: SupabaseClient; rec: ReadRecorder } {
  const rec: ReadRecorder = {
    table: null,
    selects: [],
    eqs: [],
    order: null,
    limit: null,
    result,
  };
  const builder = {
    select(cols: string) {
      rec.selects.push(cols);
      return builder;
    },
    eq(col: string, val: unknown) {
      rec.eqs.push({ col, val });
      return builder;
    },
    order(col: string, opts: Record<string, unknown>) {
      rec.order = { col, opts };
      return builder;
    },
    limit(n: number) {
      rec.limit = n;
      return builder;
    },
    maybeSingle() {
      return Promise.resolve(rec.result);
    },
  };
  const client = {
    from(table: string) {
      rec.table = table;
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, rec };
}

function makeWriteStub(
  result: { data: unknown; error: unknown },
): { client: SupabaseClient; rec: WriteRecorder } {
  const rec: WriteRecorder = {
    table: null,
    upserts: [],
    upsertOpts: null,
    result,
  };
  const builder = {
    upsert(payload: unknown, opts: Record<string, unknown>) {
      rec.upserts.push(payload);
      rec.upsertOpts = opts;
      return Promise.resolve(rec.result);
    },
  };
  const client = {
    from(table: string) {
      rec.table = table;
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, rec };
}

const TOKEN = "tkn_smoke_001";

const FRESH_PAYLOAD: ShareSnapshotPayload = {
  metaPayload: null,
  metaErrorReason: null,
  activeCreatives: { kind: "skip", reason: "no_event_code" },
};

// ── readShareSnapshot ──────────────────────────────────────────────────────

describe("readShareSnapshot", () => {
  it("returns null when Supabase reports an error", async () => {
    const { client } = makeReadStub({
      data: null,
      error: { message: "boom" },
    });
    const out = await readShareSnapshot(client, {
      shareToken: TOKEN,
      datePreset: "last_7d",
    });
    assert.equal(out, null);
  });

  it("returns null when no row exists (404 / maybeSingle null)", async () => {
    const { client, rec } = makeReadStub({ data: null, error: null });
    const out = await readShareSnapshot(client, {
      shareToken: TOKEN,
      datePreset: "last_7d",
    });
    assert.equal(out, null);
    // Verify we filter on the cache key columns including null
    // sentinels for the custom range. Without these explicit nulls
    // we'd match any custom_range row for the same preset and
    // serve stale data across windows.
    assert.deepEqual(rec.eqs, [
      { col: "share_token", val: TOKEN },
      { col: "date_preset", val: "last_7d" },
      { col: "custom_since", val: null },
      { col: "custom_until", val: null },
    ]);
    assert.equal(rec.table, "share_insight_snapshots");
  });

  it("returns null when the row has expired", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const { client } = makeReadStub({
      data: {
        payload: FRESH_PAYLOAD,
        expires_at: past,
        fetched_at: past,
      },
      error: null,
    });
    const out = await readShareSnapshot(client, {
      shareToken: TOKEN,
      datePreset: "last_7d",
    });
    assert.equal(out, null);
  });

  it("returns the payload when the row is fresh", async () => {
    const fetchedAt = new Date(Date.now() - 30_000).toISOString();
    const expiresAt = new Date(Date.now() + 4 * 60_000).toISOString();
    const { client } = makeReadStub({
      data: {
        payload: FRESH_PAYLOAD,
        expires_at: expiresAt,
        fetched_at: fetchedAt,
      },
      error: null,
    });
    const out = await readShareSnapshot(client, {
      shareToken: TOKEN,
      datePreset: "last_7d",
    });
    assert.ok(out, "expected a hit");
    assert.deepEqual(out!.payload, FRESH_PAYLOAD);
    // ageMs should be roughly 30s — allow a generous bracket so a
    // slow CI runner doesn't flap.
    assert.ok(
      out!.ageMs >= 25_000 && out!.ageMs <= 60_000,
      `ageMs out of bracket: ${out!.ageMs}`,
    );
  });

  it("forwards the custom range when one is provided", async () => {
    const { client, rec } = makeReadStub({ data: null, error: null });
    await readShareSnapshot(client, {
      shareToken: TOKEN,
      datePreset: "custom",
      customRange: { since: "2026-04-01", until: "2026-04-15" },
    });
    assert.deepEqual(rec.eqs, [
      { col: "share_token", val: TOKEN },
      { col: "date_preset", val: "custom" },
      { col: "custom_since", val: "2026-04-01" },
      { col: "custom_until", val: "2026-04-15" },
    ]);
  });
});

// ── writeShareSnapshot ─────────────────────────────────────────────────────

describe("writeShareSnapshot", () => {
  it("upserts with expires_at = now + TTL", async () => {
    const { client, rec } = makeWriteStub({ data: null, error: null });
    const before = Date.now();
    await writeShareSnapshot(
      client,
      { shareToken: TOKEN, datePreset: "last_7d" },
      FRESH_PAYLOAD,
    );
    const after = Date.now();

    assert.equal(rec.table, "share_insight_snapshots");
    assert.equal(rec.upserts.length, 1);
    const row = rec.upserts[0] as Record<string, unknown>;
    assert.equal(row.share_token, TOKEN);
    assert.equal(row.date_preset, "last_7d");
    assert.equal(row.custom_since, null);
    assert.equal(row.custom_until, null);
    assert.deepEqual(row.payload, FRESH_PAYLOAD);

    const expiresAt = new Date(row.expires_at as string).getTime();
    // Expires_at must land within the TTL window measured against
    // the call's wall clock — wide enough to absorb scheduler
    // jitter, tight enough to catch a regressed TTL constant.
    assert.ok(
      expiresAt >= before + SHARE_SNAPSHOT_TTL_MS &&
        expiresAt <= after + SHARE_SNAPSHOT_TTL_MS,
      `expires_at out of bracket: ${row.expires_at}`,
    );

    assert.deepEqual(rec.upsertOpts, {
      onConflict: "share_token,date_preset,custom_since,custom_until",
    });
  });

  it("writes null custom_since / custom_until for non-custom presets", async () => {
    const { client, rec } = makeWriteStub({ data: null, error: null });
    await writeShareSnapshot(
      client,
      { shareToken: TOKEN, datePreset: "maximum" },
      FRESH_PAYLOAD,
    );
    const row = rec.upserts[0] as Record<string, unknown>;
    assert.equal(row.custom_since, null);
    assert.equal(row.custom_until, null);
  });

  it("forwards a custom range when one is provided", async () => {
    const { client, rec } = makeWriteStub({ data: null, error: null });
    await writeShareSnapshot(
      client,
      {
        shareToken: TOKEN,
        datePreset: "custom",
        customRange: { since: "2026-04-01", until: "2026-04-15" },
      },
      FRESH_PAYLOAD,
    );
    const row = rec.upserts[0] as Record<string, unknown>;
    assert.equal(row.custom_since, "2026-04-01");
    assert.equal(row.custom_until, "2026-04-15");
  });

  it("swallows write failures (never throws)", async () => {
    const { client } = makeWriteStub({
      data: null,
      error: { message: "RLS violated" },
    });
    // Should not throw, even though Supabase reported an error.
    // Cache writes are best-effort; the user-facing render must
    // never 500 because a snapshot couldn't be persisted.
    await writeShareSnapshot(
      client,
      { shareToken: TOKEN, datePreset: "last_7d" },
      FRESH_PAYLOAD,
    );
  });
});
