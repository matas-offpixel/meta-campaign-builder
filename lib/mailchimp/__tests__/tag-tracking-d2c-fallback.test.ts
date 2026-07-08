/**
 * Unit tests for lib/mailchimp/tag-tracking.ts#handleProfileUpdate's D2C
 * credential fallback (2026-07-08 fix).
 *
 * Root cause under test: D2C-only clients (Throwback, Hop on the Top, ...)
 * never get a `clients.mailchimp_account_id` — their Mailchimp credentials
 * live in `d2c_connections` instead. Before this fix, the profile-update
 * webhook bailed with `no_account_id` and neither logged tag events nor
 * signalled the autoresponder fire path.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

interface FakeEventRow {
  id: string;
  user_id: string;
  client_id: string | null;
  mailchimp_tag: string | null;
  mailchimp_audience_id: string | null;
  client: { mailchimp_account_id: string | null } | null;
}

interface FakeLogRow {
  event_id: string;
  user_id: string;
  client_id: string | null;
  mailchimp_audience_id: string;
  mailchimp_tag: string;
  member_email_hash: string;
  member_email_address: string;
  action: "added" | "removed";
  event_timestamp: string;
  raw_webhook_body: unknown;
}

interface FakeSnapshotRow {
  event_id: string;
  email_subscribers: number;
  snapshot_at: string;
  [key: string]: unknown;
}

interface FakeConnectionRow {
  id: string;
  client_id: string;
  provider: string;
  created_at: string;
}

/** Minimal in-memory Supabase-shaped fake covering exactly the query chains
 * handleProfileUpdate + recomputeDaySnapshot + the D2C credential fallback
 * exercise. Modelled on the MemorySupabase pattern used elsewhere (e.g.
 * lib/tiktok/__tests__/write-foundation.test.ts). */
class FakeDb {
  events: FakeEventRow[];
  tagEventLog: FakeLogRow[] = [];
  tagSnapshots: FakeSnapshotRow[] = [];
  d2cConnections: FakeConnectionRow[];
  d2cCreds: Record<string, Record<string, unknown>>;

  constructor(init: {
    events: FakeEventRow[];
    d2cConnections?: FakeConnectionRow[];
    d2cCreds?: Record<string, Record<string, unknown>>;
  }) {
    this.events = init.events;
    this.d2cConnections = init.d2cConnections ?? [];
    this.d2cCreds = init.d2cCreds ?? {};
  }

  from(table: string) {
    return new FakeBuilder(this, table);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async rpc(fn: string, args: Record<string, any>) {
    if (fn === "get_mailchimp_credentials") return { data: null, error: null };
    if (fn === "get_d2c_credentials") {
      return { data: this.d2cCreds[args.p_id as string] ?? null, error: null };
    }
    throw new Error(`unexpected rpc ${fn}`);
  }
}

class FakeBuilder {
  private eqs: Record<string, unknown> = {};
  private gteVal?: unknown;
  private lteVal?: unknown;
  private ltVal?: unknown;
  private db: FakeDb;
  private table: string;

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }

  select() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  not() {
    return this;
  }
  eq(col: string, val: unknown) {
    this.eqs[col] = val;
    return this;
  }
  gte(_col: string, val: unknown) {
    this.gteVal = val;
    return this;
  }
  lte(_col: string, val: unknown) {
    this.lteVal = val;
    return this;
  }
  lt(_col: string, val: unknown) {
    this.ltVal = val;
    return this;
  }

  upsert(payload: Record<string, unknown>) {
    if (this.table === "mailchimp_tag_event_log") {
      this.db.tagEventLog.push(payload as unknown as FakeLogRow);
    } else if (this.table === "mailchimp_tag_snapshots") {
      const idx = this.db.tagSnapshots.findIndex(
        (r) => r.event_id === payload.event_id && r.snapshot_at === payload.snapshot_at,
      );
      const row = payload as unknown as FakeSnapshotRow;
      if (idx >= 0) this.db.tagSnapshots[idx] = row;
      else this.db.tagSnapshots.push(row);
    } else {
      throw new Error(`unexpected upsert table ${this.table}`);
    }
    return Promise.resolve({ data: null, error: null });
  }

  maybeSingle() {
    if (this.table === "events") {
      const row = this.db.events.find((e) => e.id === this.eqs.id);
      return Promise.resolve({ data: row ?? null, error: null });
    }
    if (this.table === "mailchimp_tag_event_log") {
      const rows = this.db.tagEventLog
        .filter(
          (r) => r.event_id === this.eqs.event_id && r.member_email_hash === this.eqs.member_email_hash,
        )
        .sort((a, b) => b.event_timestamp.localeCompare(a.event_timestamp));
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    }
    if (this.table === "mailchimp_tag_snapshots") {
      let rows = this.db.tagSnapshots.filter((r) => r.event_id === this.eqs.event_id);
      if (this.ltVal) rows = rows.filter((r) => r.snapshot_at < (this.ltVal as string));
      rows = rows.sort((a, b) => b.snapshot_at.localeCompare(a.snapshot_at));
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }

  then(resolve: (v: { data: unknown; error: null }) => void) {
    if (this.table === "events") {
      let rows = this.db.events;
      if (this.eqs.client_id != null) rows = rows.filter((e) => e.client_id === this.eqs.client_id);
      if (this.eqs.mailchimp_audience_id != null) {
        rows = rows.filter((e) => e.mailchimp_audience_id === this.eqs.mailchimp_audience_id);
      }
      resolve({ data: rows, error: null });
      return;
    }
    if (this.table === "mailchimp_tag_event_log") {
      let rows = this.db.tagEventLog.filter((r) => r.event_id === this.eqs.event_id);
      if (this.gteVal) rows = rows.filter((r) => r.event_timestamp >= (this.gteVal as string));
      if (this.lteVal) rows = rows.filter((r) => r.event_timestamp <= (this.lteVal as string));
      resolve({ data: rows, error: null });
      return;
    }
    if (this.table === "d2c_connections") {
      let rows = this.db.d2cConnections;
      if (this.eqs.client_id != null) rows = rows.filter((r) => r.client_id === this.eqs.client_id);
      resolve({ data: rows, error: null });
      return;
    }
    resolve({ data: [], error: null });
  }
}

let origFetch: typeof fetch;
let origD2CTokenKey: string | undefined;
let origMailchimpTokenKey: string | undefined;
let origEnvFallbackKey: string | undefined;

beforeEach(() => {
  origFetch = globalThis.fetch;
  origD2CTokenKey = process.env.D2C_TOKEN_KEY;
  process.env.D2C_TOKEN_KEY = "test-d2c-token-key-0000";
  origMailchimpTokenKey = process.env.MAILCHIMP_TOKEN_KEY;
  process.env.MAILCHIMP_TOKEN_KEY = "test-mailchimp-token-key-0000";
  // resolveMailchimpCredentials' local-dev env fallback — clear so tests
  // never accidentally pick up a real dev key from this shell.
  origEnvFallbackKey = process.env.JACKIES_MAILCHIMP_API_KEY;
  delete process.env.JACKIES_MAILCHIMP_API_KEY;
});

afterEach(() => {
  globalThis.fetch = origFetch;
  if (origD2CTokenKey === undefined) delete process.env.D2C_TOKEN_KEY;
  else process.env.D2C_TOKEN_KEY = origD2CTokenKey;
  if (origMailchimpTokenKey === undefined) delete process.env.MAILCHIMP_TOKEN_KEY;
  else process.env.MAILCHIMP_TOKEN_KEY = origMailchimpTokenKey;
  if (origEnvFallbackKey === undefined) delete process.env.JACKIES_MAILCHIMP_API_KEY;
  else process.env.JACKIES_MAILCHIMP_API_KEY = origEnvFallbackKey;
});

describe("handleProfileUpdate — D2C credential fallback", () => {
  it("falls back to d2c_connections creds, reconciles a fresh tag-add, and reports addedEventIds", async () => {
    mock.method(globalThis, "fetch", async (url: string) => {
      assert.ok(url.includes("/lists/c2b4d77acb/members/"), `unexpected URL: ${url}`);
      assert.ok(url.includes("/tags"));
      return {
        ok: true,
        json: async () => ({
          tags: [{ id: 1, name: "T26-ALGARVE", date_added: "2026-07-08T10:00:00Z" }],
        }),
      } as Response;
    });

    const db = new FakeDb({
      events: [
        {
          id: "event-algarve",
          user_id: "user-1",
          client_id: "client-throwback",
          mailchimp_tag: "T26-ALGARVE",
          mailchimp_audience_id: "c2b4d77acb",
          client: { mailchimp_account_id: null },
        },
      ],
      d2cConnections: [
        { id: "conn-1", client_id: "client-throwback", provider: "mailchimp", created_at: "2026-01-01" },
      ],
      d2cCreds: { "conn-1": { api_key: "testkey-us7", server_prefix: "us7" } },
    });

    const { handleProfileUpdate } = await import("../tag-tracking.ts");
    const result = await handleProfileUpdate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any,
      "client-throwback",
      "c2b4d77acb",
      "hello+webhookprove@offpixel.co.uk",
    );

    assert.deepEqual(result, { ok: true, reconciled: 1, addedEventIds: ["event-algarve"] });
    assert.equal(db.tagEventLog.length, 1);
    assert.equal(db.tagEventLog[0]!.action, "added");
    assert.equal(db.tagEventLog[0]!.mailchimp_tag, "T26-ALGARVE");
    // recomputeDaySnapshot ran through to completion using the fallback creds.
    assert.equal(db.tagSnapshots.length, 1);
    assert.equal(db.tagSnapshots[0]!.email_subscribers, 1);
  });

  it("returns no_credentials (and never calls the Mailchimp API) when neither the legacy account nor a d2c_connections row resolve", async () => {
    let fetchCalled = false;
    mock.method(globalThis, "fetch", async () => {
      fetchCalled = true;
      throw new Error("should not call Mailchimp API without credentials");
    });

    const db = new FakeDb({
      events: [
        {
          id: "event-orphan",
          user_id: "user-1",
          client_id: "client-no-creds",
          mailchimp_tag: "SOME-TAG",
          mailchimp_audience_id: "aud-1",
          client: { mailchimp_account_id: null },
        },
      ],
      d2cConnections: [],
    });

    const { handleProfileUpdate } = await import("../tag-tracking.ts");
    const result = await handleProfileUpdate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any,
      "client-no-creds",
      "aud-1",
      "someone@example.com",
    );

    assert.deepEqual(result, { ok: false, reconciled: 0, addedEventIds: [], error: "no_credentials" });
    assert.equal(fetchCalled, false);
  });

  it("still prefers the legacy clients.mailchimp_account_id path when present (D2C fallback never queried)", async () => {
    mock.method(globalThis, "fetch", async () => {
      return {
        ok: true,
        json: async () => ({ tags: [{ id: 1, name: "LEGACY-TAG", date_added: "2026-07-08T10:00:00Z" }] }),
      } as Response;
    });

    const db = new FakeDb({
      events: [
        {
          id: "event-legacy",
          user_id: "user-1",
          client_id: "client-legacy",
          mailchimp_tag: "LEGACY-TAG",
          mailchimp_audience_id: "aud-legacy",
          client: { mailchimp_account_id: "acct-1" },
        },
      ],
      // A d2c_connections row exists too, but should never be reached.
      d2cConnections: [
        { id: "conn-should-not-be-used", client_id: "client-legacy", provider: "mailchimp", created_at: "2026-01-01" },
      ],
    });
    // Legacy path: getMailchimpCredentials calls get_mailchimp_credentials
    // RPC, which returns a JSON *string* payload (parsed by
    // parseMailchimpCredentials).
    const originalRpc = db.rpc.bind(db);
    let d2cRpcCalled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db.rpc = async (fn: string, args: Record<string, any>) => {
      if (fn === "get_mailchimp_credentials") {
        return { data: JSON.stringify({ apiKey: "legacykey-us6", dc: "us6" }), error: null };
      }
      if (fn === "get_d2c_credentials") d2cRpcCalled = true;
      return originalRpc(fn, args);
    };

    const { handleProfileUpdate } = await import("../tag-tracking.ts");
    const result = await handleProfileUpdate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any,
      "client-legacy",
      "aud-legacy",
      "legacy@example.com",
    );

    assert.deepEqual(result, { ok: true, reconciled: 1, addedEventIds: ["event-legacy"] });
    assert.equal(d2cRpcCalled, false, "d2c credential fallback must not be queried when legacy creds resolve");
  });
});
