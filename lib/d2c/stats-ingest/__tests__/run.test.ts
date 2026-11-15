import { test } from "node:test";
import assert from "node:assert/strict";

import { isNightlyStatsSlot, isStatsIngestEnabled, runD2CStatsIngest } from "../run.ts";
import { StatsReadError, type StatsReader } from "../reader.ts";
import type { D2CStatsSource } from "../types.ts";

type Row = Record<string, unknown>;

/** Just enough PostgREST for the ingest's reads, plus a recorded upsert. */
function fakeDb(tables: Record<string, Row[]>) {
  const upserts: Row[][] = [];
  function query(table: string) {
    const preds: Array<(r: Row) => boolean> = [];
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), q),
      neq: (c: string, v: unknown) => (preds.push((r) => r[c] !== v), q),
      in: (c: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[c])), q),
      is: (c: string, v: unknown) => (preds.push((r) => (r[c] ?? null) === v), q),
      not: (c: string, _op: string, v: unknown) => (preds.push((r) => (r[c] ?? null) !== v), q),
      gt: () => q,
      gte: () => q,
      lte: () => q,
      or: (f: string) => {
        const cols = f.split(",").map((p) => p.split(".")[0]!);
        preds.push((r) => cols.some((c) => r[c] != null));
        return q;
      },
      order: () => q,
      rows: () => (tables[table] ?? []).filter((r) => preds.every((p) => p(r))),
      range: async (from: number, to: number) => ({ data: q.rows().slice(from, to + 1), error: null }),
      maybeSingle: async () => ({ data: q.rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: q.rows(), error: null }),
      upsert: async (rows: Row[]) => (upserts.push(rows), { error: null }),
    };
    return q;
  }
  return { db: { from: query, rpc: async () => ({ data: null, error: { message: "not in tests" } }) }, upserts };
}

function reader(routes: Array<[RegExp, (path: string) => unknown]>): StatsReader {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async get<T>(path: string): Promise<T> {
      calls += 1;
      for (const [re, fn] of routes) if (re.test(path)) return fn(path) as T;
      throw new StatsReadError(404, path);
    },
  };
}

const CLIENT = "client-harbour";
const tables = {
  clients: [
    { id: CLIENT, status: "active", mailchimp_audience_id: null },
    { id: "client-gone", status: "archived", mailchimp_audience_id: null },
  ],
  events: [
    { id: "ev-moonlit", client_id: CLIENT, mailchimp_tag: "CQ-moonlit-harbour", cirqlin_page_slug: "moonlit-harbour", mailchimp_audience_id: "list-a" },
    { id: "ev-gone", client_id: "client-gone", mailchimp_tag: "CQ-old-show", cirqlin_page_slug: null, mailchimp_audience_id: null },
  ],
  d2c_connections: [
    { id: "conn-bird", client_id: CLIENT, provider: "bird", status: "active", external_account_id: "ws-1" },
    { id: "conn-mc", client_id: CLIENT, provider: "mailchimp", status: "active", external_account_id: "us1" },
    { id: "conn-gone", client_id: "client-gone", provider: "bird", status: "active", external_account_id: "ws-9" },
  ],
};

const NOW = Date.parse("2026-11-15T04:05:00Z");

const birdRoutes: Array<[RegExp, (p: string) => unknown]> = [
  [/\/campaigns\?/, () => ({
    results: [
      { id: "b1", activatedAt: "2026-11-01T17:00:00Z", currentVersion: { recipients: { include: [{ type: "group", id: "l-show" }] } } },
      { id: "b2", activatedAt: "2026-11-03T17:00:00Z", currentVersion: { recipients: { include: [{ type: "group", id: "l-master" }] } } },
    ],
  })],
  [/reporting\/campaigns\/metrics/, () => [
    { summary: { campaignId: "b1", platformId: "whatsapp", sent: 600, delivered: 540, readOrOpened: 300, clicked: 45 } },
    { summary: { campaignId: "b2", platformId: "whatsapp", sent: 900, delivered: 820, readOrOpened: 400, clicked: 30 } },
  ]],
  [/\/lists\/l-show$/, () => ({ name: "CQ-moonlit-harbour" })],
  [/\/lists\/l-master$/, () => ({ name: "Harbour Loves" })],
];

const mcRoutes: Array<[RegExp, (p: string) => unknown]> = [
  [/^\/3\.0\/\?fields=account_id/, () => ({ account_id: "acct-1" })],
  [/^\/3\.0\/reports\?/, () => ({ total_items: 1, reports: [{ id: "m1", list_id: "list-a", emails_sent: 400, opens: { unique_opens: 100, proxy_excluded_unique_opens: 12 }, clicks: { unique_subscriber_clicks: 9 } }] })],
  [/^\/3\.0\/campaigns\?/, () => ({ total_items: 1, campaigns: [{ id: "m1", recipients: { list_id: "list-a", segment_opts: { match: "any", conditions: [{ condition_type: "StaticSegment", op: "static_is", value: 7 }] } } }] })],
  [/\/segments\?/, () => ({ total_items: 1, segments: [{ id: 7, name: "CQ-moonlit-harbour" }] })],
];

const creds = async (id: string) =>
  id === "conn-bird" ? { api_key: "bird-test-key", workspace_id: "ws-1" } : { api_key: "abc-us1", server_prefix: "us1" };

const readerFor = (s: D2CStatsSource) => reader(s.provider === "bird" ? birdRoutes : mcRoutes);

test("the gate is exactly '1', and the slot is 04:00–04:14 UTC", () => {
  assert.equal(isStatsIngestEnabled({}), false);
  assert.equal(isStatsIngestEnabled({ ENABLE_D2C_STATS_INGEST: "true" }), false);
  assert.equal(isStatsIngestEnabled({ ENABLE_D2C_STATS_INGEST: "1" }), true);
  assert.equal(isNightlyStatsSlot(new Date("2026-11-15T04:00:00Z")), true);
  assert.equal(isNightlyStatsSlot(new Date("2026-11-15T04:14:59Z")), true);
  assert.equal(isNightlyStatsSlot(new Date("2026-11-15T04:15:00Z")), false);
  assert.equal(isNightlyStatsSlot(new Date("2026-11-15T03:59:00Z")), false);
});

test("a dry run reads both providers, attributes, and writes nothing", async () => {
  const { db, upserts } = fakeDb(tables);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await runD2CStatsIngest(db as any, { apply: false, nowMs: NOW, loadCredentials: creds, readerFor });
  assert.equal(result.ok, true);
  assert.equal(upserts.length, 0);
  assert.equal(result.written, 0);
  const b1 = result.rows.find((r) => r.external_id === "b1")!;
  const b2 = result.rows.find((r) => r.external_id === "b2")!;
  const m1 = result.rows.find((r) => r.external_id === "m1")!;
  assert.equal(b1.event_id, "ev-moonlit");
  // A list no show answers to, and not a master tag of this client: not tied to a show.
  assert.equal(b2.attribution, "not_tied");
  assert.equal(b2.client_id, CLIENT);
  assert.equal(m1.event_id, "ev-moonlit");
  assert.equal(m1.opens_unique_filtered, 12);
  assert.deepEqual(result.skippedConnections, [{ connectionId: "conn-gone", reason: "archived client" }]);
  assert.ok(result.calls > 0);
  assert.equal(result.calls, result.sources.reduce((n, s) => n + s.calls, 0));
});

test("--apply upserts the rows", async () => {
  const { db, upserts } = fakeDb(tables);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await runD2CStatsIngest(db as any, { apply: true, nowMs: NOW, loadCredentials: creds, readerFor });
  assert.equal(result.applied, true);
  assert.equal(result.written, 3);
  assert.equal(upserts.flat().length, 3);
});

test("two clients on one Mailchimp account: whole-list sends are unattributed", async () => {
  const shared = {
    ...tables,
    clients: [...tables.clients, { id: "client-pier", status: "active", mailchimp_audience_id: null }],
    d2c_connections: [
      { id: "conn-mc", client_id: CLIENT, provider: "mailchimp", status: "active", external_account_id: "us1" },
      { id: "conn-mc2", client_id: "client-pier", provider: "mailchimp", status: "active", external_account_id: "us1" },
    ],
  };
  const wholeList: Array<[RegExp, (p: string) => unknown]> = [
    mcRoutes[0]!,
    [/^\/3\.0\/reports\?/, () => ({ total_items: 1, reports: [{ id: "m9", list_id: "list-z", emails_sent: 10 }] })],
    [/^\/3\.0\/campaigns\?/, () => ({ total_items: 1, campaigns: [{ id: "m9", recipients: { list_id: "list-z", segment_opts: null } }] })],
  ];
  const { db } = fakeDb(shared);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await runD2CStatsIngest(db as any, { apply: false, nowMs: NOW, loadCredentials: creds, readerFor: () => reader(wholeList) });
  assert.equal(result.sources.length, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]!.attribution, "unattributed");
});

test("a provider error is reported per account and does not stop the others", async () => {
  const { db } = fakeDb(tables);
  const broken: Array<[RegExp, (p: string) => unknown]> = [[/./, () => {
    throw new StatsReadError(401, "unauthorised");
  }]];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await runD2CStatsIngest(db as any, {
    apply: false,
    nowMs: NOW,
    loadCredentials: creds,
    readerFor: (s) => reader(s.provider === "bird" ? broken : mcRoutes),
  });
  assert.equal(result.ok, false);
  assert.ok(result.sources.find((s) => s.provider === "bird")?.error?.includes("401"));
  assert.equal(result.rows.filter((r) => r.provider === "mailchimp").length, 1);
});
