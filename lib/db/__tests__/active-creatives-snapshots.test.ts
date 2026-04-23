// ─────────────────────────────────────────────────────────────────────────────
// active-creatives-snapshots cache tests.
//
// Run with:  node --experimental-strip-types --test lib/db/__tests__
// (Node 22.6+ strips TS at runtime; matches the lib/pricing test harness.)
//
// Same approach as `share-snapshots.test.ts` — every test stubs the
// chained query builder with a tiny recorder so we can assert on
// the columns and filters the helper actually applies. We never
// construct a real Supabase client.
// ─────────────────────────────────────────────────────────────────────────────

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  readActiveCreativesSnapshot,
  writeActiveCreativesSnapshot,
  markSnapshotStale,
  isSnapshotFresh,
  ACS_DEFAULT_TTL_MS,
  ACS_TIGHT_TTL_MS,
  type ActiveCreativesSnapshotRecord,
} from "../active-creatives-snapshots.ts";
import type { ShareActiveCreativesResult } from "../../reporting/share-active-creatives.ts";

// ── tiny mock helpers ──────────────────────────────────────────────────────

interface ReadRecorder {
  table: string | null;
  selects: string[];
  eqs: Array<{ col: string; val: unknown }>;
  isCalls: Array<{ col: string; val: unknown }>;
  order: { col: string; opts: Record<string, unknown> } | null;
  limit: number | null;
  result: { data: unknown; error: unknown };
}

interface WriteRecorder {
  table: string | null;
  upserts: unknown[];
  upsertOpts: Record<string, unknown> | null;
  result: { data: unknown; error: unknown };
}

interface UpdateRecorder {
  table: string | null;
  updates: unknown[];
  eqs: Array<{ col: string; val: unknown }>;
  isCalls: Array<{ col: string; val: unknown }>;
  result: { data: unknown; error: unknown };
}

function makeReadStub(
  result: { data: unknown; error: unknown },
): { client: SupabaseClient; rec: ReadRecorder } {
  const rec: ReadRecorder = {
    table: null,
    selects: [],
    eqs: [],
    isCalls: [],
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
    is(col: string, val: unknown) {
      rec.isCalls.push({ col, val });
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

function makeUpdateStub(
  result: { data: unknown; error: unknown },
): { client: SupabaseClient; rec: UpdateRecorder } {
  const rec: UpdateRecorder = {
    table: null,
    updates: [],
    eqs: [],
    isCalls: [],
    result,
  };
  // `update(...).eq(...).is(...)` returns a thenable on the last
  // call. Easier to model: a builder where `update` records the
  // patch, every `eq`/`is` chains, and the builder itself is a
  // thenable that resolves to `rec.result` when awaited at the end
  // of the chain.
  const builder: Record<string, unknown> = {
    update(patch: unknown) {
      rec.updates.push(patch);
      return builder;
    },
    eq(col: string, val: unknown) {
      rec.eqs.push({ col, val });
      return builder;
    },
    is(col: string, val: unknown) {
      rec.isCalls.push({ col, val });
      return builder;
    },
    then(onFulfilled?: (v: unknown) => unknown) {
      const v = onFulfilled ? onFulfilled(rec.result) : rec.result;
      return Promise.resolve(v);
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

const EVENT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";

const OK_PAYLOAD: ShareActiveCreativesResult = {
  kind: "ok",
  groups: [],
  ad_account_id: "act_1",
  event_code: "EVT-1",
  fetched_at: "2026-04-22T12:00:00Z",
  meta: {
    campaigns_total: 1,
    campaigns_failed: 0,
    ads_fetched: 0,
    dropped_no_creative: 0,
    truncated: false,
    unattributed: {
      ads_count: 0,
      spend: 0,
      impressions: 0,
      clicks: 0,
      inline_link_clicks: 0,
      landingPageViews: 0,
      registrations: 0,
      purchases: 0,
    },
  },
};

const SKIP_PAYLOAD: ShareActiveCreativesResult = {
  kind: "skip",
  reason: "no_event_code",
};

const ERROR_PAYLOAD: ShareActiveCreativesResult = {
  kind: "error",
  reason: "meta_failed",
  message: "boom",
};

// ── readActiveCreativesSnapshot ────────────────────────────────────────────

describe("readActiveCreativesSnapshot", () => {
  it("returns null when Supabase reports an error", async () => {
    const { client } = makeReadStub({
      data: null,
      error: { message: "boom" },
    });
    const out = await readActiveCreativesSnapshot(client, {
      eventId: EVENT_ID,
      datePreset: "last_7d",
    });
    assert.equal(out, null);
  });

  it("returns null when no row exists", async () => {
    const { client, rec } = makeReadStub({ data: null, error: null });
    const out = await readActiveCreativesSnapshot(client, {
      eventId: EVENT_ID,
      datePreset: "last_7d",
    });
    assert.equal(out, null);
    assert.equal(rec.table, "active_creatives_snapshots");
    // event_id + preset go through .eq.
    assert.deepEqual(rec.eqs, [
      { col: "event_id", val: EVENT_ID },
      { col: "date_preset", val: "last_7d" },
    ]);
    // Custom range nulls MUST go through .is(col, null) — same
    // PostgREST `eq.null` vs `is.null` distinction the share-snapshots
    // helper hit (and that migration 037 documents).
    assert.deepEqual(rec.isCalls, [
      { col: "custom_since", val: null },
      { col: "custom_until", val: null },
    ]);
  });

  it("returns the row even when expires_at is in the past (stale read)", async () => {
    // The active-creatives helper deliberately does NOT gate the
    // read on expires_at — the share page wants the row so it can
    // serve last-good with a stale banner. This is the fundamental
    // behavioural delta from share-snapshots.
    const past = new Date(Date.now() - 60 * 60_000).toISOString();
    const { client } = makeReadStub({
      data: {
        payload: OK_PAYLOAD,
        fetched_at: past,
        expires_at: past,
        is_stale: false,
      },
      error: null,
    });
    const out = await readActiveCreativesSnapshot(client, {
      eventId: EVENT_ID,
      datePreset: "last_7d",
    });
    assert.ok(out, "expected a stale row, not null");
    assert.deepEqual(out!.payload, OK_PAYLOAD);
    assert.equal(out!.isStale, false);
  });

  it("forwards a custom range via .eq when provided", async () => {
    const { client, rec } = makeReadStub({ data: null, error: null });
    await readActiveCreativesSnapshot(client, {
      eventId: EVENT_ID,
      datePreset: "custom",
      customRange: { since: "2026-04-01", until: "2026-04-15" },
    });
    assert.deepEqual(rec.eqs, [
      { col: "event_id", val: EVENT_ID },
      { col: "date_preset", val: "custom" },
      { col: "custom_since", val: "2026-04-01" },
      { col: "custom_until", val: "2026-04-15" },
    ]);
    assert.deepEqual(rec.isCalls, []);
  });
});

// ── writeActiveCreativesSnapshot ───────────────────────────────────────────

describe("writeActiveCreativesSnapshot", () => {
  it("upserts an ok payload with expires_at = now + ttl", async () => {
    const { client, rec } = makeWriteStub({ data: null, error: null });
    const before = Date.now();
    await writeActiveCreativesSnapshot(
      client,
      {
        eventId: EVENT_ID,
        userId: USER_ID,
        datePreset: "last_7d",
      },
      OK_PAYLOAD,
      ACS_DEFAULT_TTL_MS,
    );
    const after = Date.now();

    assert.equal(rec.table, "active_creatives_snapshots");
    assert.equal(rec.upserts.length, 1);
    const row = rec.upserts[0] as Record<string, unknown>;
    assert.equal(row.event_id, EVENT_ID);
    assert.equal(row.user_id, USER_ID);
    assert.equal(row.date_preset, "last_7d");
    assert.equal(row.custom_since, null);
    assert.equal(row.custom_until, null);
    assert.equal(row.is_stale, false);
    assert.equal(row.last_refresh_error, null);
    assert.deepEqual(row.payload, OK_PAYLOAD);

    const expiresAt = new Date(row.expires_at as string).getTime();
    assert.ok(
      expiresAt >= before + ACS_DEFAULT_TTL_MS &&
        expiresAt <= after + ACS_DEFAULT_TTL_MS,
      `expires_at out of bracket: ${row.expires_at}`,
    );

    assert.deepEqual(rec.upsertOpts, {
      onConflict: "event_id,date_preset,custom_since,custom_until",
    });
  });

  it("does NOT write when payload.kind === 'skip'", async () => {
    // Hard requirement from the research doc: skip/error responses
    // must never overwrite a good snapshot. Last-good > unavailable.
    const { client, rec } = makeWriteStub({ data: null, error: null });
    await writeActiveCreativesSnapshot(
      client,
      { eventId: EVENT_ID, userId: USER_ID, datePreset: "last_7d" },
      SKIP_PAYLOAD,
      ACS_DEFAULT_TTL_MS,
    );
    assert.equal(rec.upserts.length, 0, "should refuse the write");
    assert.equal(rec.table, null);
  });

  it("does NOT write when payload.kind === 'error'", async () => {
    const { client, rec } = makeWriteStub({ data: null, error: null });
    await writeActiveCreativesSnapshot(
      client,
      { eventId: EVENT_ID, userId: USER_ID, datePreset: "last_7d" },
      ERROR_PAYLOAD,
      ACS_DEFAULT_TTL_MS,
    );
    assert.equal(rec.upserts.length, 0, "should refuse the write");
    assert.equal(rec.table, null);
  });

  it("forwards a custom range when provided", async () => {
    const { client, rec } = makeWriteStub({ data: null, error: null });
    await writeActiveCreativesSnapshot(
      client,
      {
        eventId: EVENT_ID,
        userId: USER_ID,
        datePreset: "custom",
        customRange: { since: "2026-04-01", until: "2026-04-15" },
      },
      OK_PAYLOAD,
      ACS_TIGHT_TTL_MS,
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
    await writeActiveCreativesSnapshot(
      client,
      { eventId: EVENT_ID, userId: USER_ID, datePreset: "last_7d" },
      OK_PAYLOAD,
      ACS_DEFAULT_TTL_MS,
    );
  });
});

// ── markSnapshotStale ──────────────────────────────────────────────────────

describe("markSnapshotStale", () => {
  it("updates is_stale=true with the right key filters", async () => {
    const { client, rec } = makeUpdateStub({ data: null, error: null });
    await markSnapshotStale(client, {
      eventId: EVENT_ID,
      datePreset: "last_7d",
    });
    assert.equal(rec.table, "active_creatives_snapshots");
    assert.deepEqual(rec.updates, [{ is_stale: true }]);
    assert.deepEqual(rec.eqs, [
      { col: "event_id", val: EVENT_ID },
      { col: "date_preset", val: "last_7d" },
    ]);
    assert.deepEqual(rec.isCalls, [
      { col: "custom_since", val: null },
      { col: "custom_until", val: null },
    ]);
  });
});

// ── isSnapshotFresh ────────────────────────────────────────────────────────

describe("isSnapshotFresh", () => {
  function rec(
    expiresAt: Date,
    isStale: boolean,
  ): ActiveCreativesSnapshotRecord {
    return {
      payload: OK_PAYLOAD,
      fetchedAt: new Date(expiresAt.getTime() - ACS_DEFAULT_TTL_MS),
      expiresAt,
      isStale,
      ageMs: 0,
    };
  }

  it("returns true when expires_at is in the future and not stale", () => {
    const now = 1_000_000_000;
    const future = new Date(now + 60_000);
    assert.equal(isSnapshotFresh(rec(future, false), now), true);
  });

  it("returns false when isStale=true even if expires_at is in the future", () => {
    const now = 1_000_000_000;
    const future = new Date(now + 60_000);
    assert.equal(isSnapshotFresh(rec(future, true), now), false);
  });

  it("returns false when expires_at is in the past (TTL boundary)", () => {
    const now = 1_000_000_000;
    const past = new Date(now - 1);
    assert.equal(isSnapshotFresh(rec(past, false), now), false);
  });

  it("returns false at the exact TTL boundary (<=, not <)", () => {
    const now = 1_000_000_000;
    // expires_at === now should NOT be fresh — strict-greater
    // semantics so we don't keep serving a row in the same
    // millisecond it expires.
    assert.equal(isSnapshotFresh(rec(new Date(now), false), now), false);
  });
});
