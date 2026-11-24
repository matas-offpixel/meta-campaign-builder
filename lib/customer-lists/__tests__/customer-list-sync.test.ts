import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { cirqlinHashedReader, parseHashedPage, type HashedEntry, type HashedReader, type HashedReadResult } from "../cirqlin-hashed.ts";
import { planEnable } from "../enable.ts";
import { eightLondonOn, isEightLondon, listTriggerAt, normaliseAccount, pickAccount, redactHashes, syncState, usersBatches } from "../rules.ts";
import { runCustomerListSync, type CustomerListGraph, type MetaAudience, type SyncEvent, type SyncRow, type SyncWork } from "../sync.ts";
import { fakeDb, type FakeDb } from "./fake-db.ts";

const ON = { OFFPIXEL_META_CUSTOMER_LIST_WRITES_ENABLED: "true" };
const ACT = "act_606252931141334";
const OTHER = "act_2011069725849568";
const EVENT_ID = "ev-1";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const entries = (from: number, n: number): HashedEntry[] => Array.from({ length: n }, (_, i) => ({ em: sha(`fan${from + i}@example.com`), ...(i % 2 ? { ph: sha(`4470000${from + i}`) } : {}) }));
const ALL_FIXTURE_HASHES = new Set<string>();
function remember(list: HashedEntry[]): HashedEntry[] {
  for (const e of list) {
    if (e.em) ALL_FIXTURE_HASHES.add(e.em);
    if (e.ph) ALL_FIXTURE_HASHES.add(e.ph);
  }
  return list;
}

function event(over: Partial<SyncEvent> = {}): SyncEvent {
  return {
    id: EVENT_ID,
    event_code: "NX27-GLITTERBOX",
    user_id: "user-1",
    client_id: "client-1",
    client_status: "active",
    mailchimp_tag: "CQ-glitterbox-newcastle",
    presale_at: "2026-11-27T12:00:00Z",
    general_sale_at: "2026-11-27T14:00:00Z",
    event_date: "2027-03-05",
    account: ACT,
    ...over,
  };
}

function row(over: Partial<SyncRow> = {}): SyncRow {
  return {
    id: "row-show",
    event_id: EVENT_ID,
    kind: "show",
    meta_audience_id: null,
    ad_account_id: ACT,
    enabled: true,
    cursor: null,
    sent_total: 0,
    removed_total: 0,
    last_sent_at: null,
    last_error: null,
    ...over,
  };
}

type Call = { op: "create" | "add" | "remove"; id: string; rows: number };

function fakeGraph(audiences: MetaAudience[] = [], opts: { failAddOnCall?: number; failMessage?: string } = {}) {
  const calls: Call[] = [];
  let addCalls = 0;
  const all = [...audiences];
  const graph: CustomerListGraph = {
    async listAudiences(account) {
      return all.filter((a) => normaliseAccount(a.account_id) === account);
    },
    async getAudience(id) {
      return all.find((a) => a.id === id) ?? null;
    },
    async createList(account, body) {
      const id = String(900000 + calls.length);
      calls.push({ op: "create", id, rows: 0 });
      all.push({ id, name: String(body.name), subtype: "CUSTOM", account_id: account.replace("act_", "") });
      return id;
    },
    async addUsers(id, payload) {
      addCalls += 1;
      if (opts.failAddOnCall === addCalls) {
        const err = new Error(opts.failMessage ?? "Invalid parameter") as Error & { code: number };
        err.code = 100;
        throw err;
      }
      calls.push({ op: "add", id, rows: payload.data.length });
      assert.deepEqual(payload.schema, ["EMAIL_SHA256", "PHONE_SHA256"]);
      return { received: payload.data.length, invalid: 0 };
    },
    async removeUsers(id, payload) {
      calls.push({ op: "remove", id, rows: payload.data.length });
      return { received: payload.data.length, invalid: 0 };
    },
  };
  return { graph, calls };
}

/** CIRQLIN by cursor: pages[since ?? ""] for each scope. */
function fakeCirqlin(pages: Record<string, { cursor: string; added: HashedEntry[]; removed?: HashedEntry[]; hasMore?: boolean }>, fail?: HashedReadResult) {
  const reads: { scope: string; since: string | null }[] = [];
  const reader: HashedReader = async ({ scope, since }) => {
    reads.push({ scope, since });
    if (fail) return fail;
    const p = pages[since ?? ""];
    if (!p) return { ok: true, page: { cursor: since, added: [], removed: [], counts: null, hasMore: false } };
    return { ok: true, page: { cursor: p.cursor, added: remember(p.added), removed: remember(p.removed ?? []), counts: { consented_show: p.added.length, consented_promoter: p.added.length, not_consented: 3 }, hasMore: p.hasMore ?? false } };
  };
  return { reader, reads };
}

function baseDb(rows: SyncRow[]): FakeDb {
  return fakeDb({
    customer_list_syncs: rows.map((r) => ({ ...r })),
    campaign_drafts: [{ id: "draft-1", event_id: EVENT_ID, created_at: "2026-11-19T10:00:00Z" }],
    meta_custom_audiences: [],
    meta_write_idempotency: [],
  });
}

function work(rows: SyncRow[], over: Partial<SyncEvent> = {}): SyncWork[] {
  return [{ event: event(over), rows }];
}

const AT_TRIGGER = new Date("2026-11-27T08:00:00Z");

describe("when a show's list is made", () => {
  it("presale day 08:00 London, in winter and summer", () => {
    assert.equal(listTriggerAt({ presale_at: "2026-11-27T12:00:00Z", general_sale_at: "2026-11-27T14:00:00Z", event_date: null })?.toISOString(), "2026-11-27T08:00:00.000Z");
    assert.equal(eightLondonOn("2026-07-10").toISOString(), "2026-07-10T07:00:00.000Z");
    // A presale just after midnight London in summer is that London day.
    assert.equal(listTriggerAt({ presale_at: "2026-07-09T23:30:00Z", general_sale_at: null, event_date: null })?.toISOString(), "2026-07-10T07:00:00.000Z");
  });

  it("general sale day when there's no presale; nothing without either", () => {
    assert.equal(listTriggerAt({ presale_at: null, general_sale_at: "2026-12-03T10:00:00Z", event_date: null })?.toISOString(), "2026-12-03T08:00:00.000Z");
    assert.equal(syncState({ presale_at: null, general_sale_at: null, event_date: null }, AT_TRIGGER).state, "no_sale_date");
  });

  it("waits before the trigger, acts at it, acts at once when it's passed, stops after show day", () => {
    const e = { presale_at: "2026-11-27T12:00:00Z", general_sale_at: null, event_date: "2027-03-05" };
    assert.equal(syncState(e, new Date("2026-11-27T07:59:00Z")).state, "waiting");
    assert.equal(syncState(e, AT_TRIGGER).state, "active");
    assert.equal(syncState(e, new Date("2026-12-04T08:00:00Z")).state, "active");
    assert.equal(syncState(e, new Date("2027-03-05T22:00:00Z")).state, "active");
    assert.equal(syncState(e, new Date("2027-03-06T08:00:00Z")).state, "show_passed");
  });

  it("the cron acts on the run that is 08:00 London", () => {
    assert.equal(isEightLondon(new Date("2026-11-27T08:00:00Z")), true);
    assert.equal(isEightLondon(new Date("2026-11-27T07:00:00Z")), false);
    assert.equal(isEightLondon(new Date("2026-07-10T07:00:00Z")), true);
  });

  it("before the trigger: no CIRQLIN read, no Meta call, no row write", async () => {
    const db = baseDb([row()]);
    const { graph, calls } = fakeGraph();
    const c = fakeCirqlin({ "": { cursor: "c1", added: entries(0, 5) } });
    const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: new Date("2026-11-26T08:00:00Z"), mode: "write", log: () => {} }, work([row()]));
    assert.equal(res.rows[0].outcome, "waiting");
    assert.equal(calls.length, 0);
    assert.equal(c.reads.length, 0);
    assert.equal(db.writes.length, 0);
  });

  it("at the trigger: creates {code} · Signups once, registers it with list_role signups, and sends in batches of 10,000", async () => {
    const db = baseDb([row()]);
    const { graph, calls } = fakeGraph();
    const c = fakeCirqlin({ "": { cursor: "c1", added: entries(0, 10_001) } });
    const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: AT_TRIGGER, mode: "write", log: () => {} }, work([row()]));
    assert.equal(res.rows[0].outcome, "sent");
    assert.deepEqual(calls.map((x) => [x.op, x.rows]), [["create", 0], ["add", 10_000], ["add", 1]]);
    assert.deepEqual(c.reads, [{ scope: "show", since: null }]);
    const stored = db.tables.customer_list_syncs[0];
    assert.equal(stored.meta_audience_id, calls[0].id);
    assert.equal(stored.cursor, "c1");
    assert.equal(stored.sent_total, 10_001);
    const reg = db.tables.meta_custom_audiences[0];
    assert.equal(reg.name, "NX27-GLITTERBOX · Signups");
    assert.equal(reg.list_role, "signups");
    assert.equal(reg.audience_subtype, "customer_list");
    assert.equal(reg.meta_ad_account_id, ACT);
    const kinds = db.tables.meta_write_idempotency.map((r) => r.op_kind);
    assert.deepEqual(kinds, ["customer_list_create", "customer_list_users", "customer_list_users"]);
    assert.ok(db.tables.meta_write_idempotency.every((r) => r.op_status === "success" && r.draft_id === "draft-1"));
  });

  it("already passed and newly enabled: acts at once, and adopts a list of the same name instead of making a second", async () => {
    const db = baseDb([row()]);
    const handMade = { id: "120250000000000001", name: "NX27-GLITTERBOX · Signups", subtype: "CUSTOM", account_id: "606252931141334" };
    const { graph, calls } = fakeGraph([handMade]);
    const c = fakeCirqlin({ "": { cursor: "c1", added: entries(0, 4) } });
    const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: new Date("2026-11-28T08:00:00Z"), mode: "write", log: () => {} }, work([row()]));
    assert.equal(res.rows[0].outcome, "sent");
    assert.deepEqual(calls.map((x) => x.op), ["add"]);
    assert.equal(calls[0].id, handMade.id);
    assert.equal(db.tables.customer_list_syncs[0].meta_audience_id, handMade.id);
  });
});

describe("adds and removes by cursor", () => {
  it("the next run reads from the saved cursor, adds the new and removes the withdrawn", async () => {
    const r = row({ meta_audience_id: "120250000000000002", cursor: "c1", sent_total: 10 });
    const db = baseDb([r]);
    const { graph, calls } = fakeGraph([{ id: "120250000000000002", name: "NX27-GLITTERBOX · Signups", subtype: "CUSTOM", account_id: "606252931141334" }]);
    const c = fakeCirqlin({ c1: { cursor: "c2", added: entries(100, 2), removed: entries(0, 1) } });
    const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: new Date("2026-11-29T08:00:00Z"), mode: "write", log: () => {} }, work([r]));
    assert.deepEqual(c.reads, [{ scope: "show", since: "c1" }]);
    assert.deepEqual(calls.map((x) => [x.op, x.rows]), [["add", 2], ["remove", 1]]);
    assert.equal(res.rows[0].added, 2);
    assert.equal(res.rows[0].removed, 1);
    const stored = db.tables.customer_list_syncs[0];
    assert.equal(stored.cursor, "c2");
    assert.equal(stored.sent_total, 12);
    assert.equal(stored.removed_total, 1);
  });

  it("follows has_more pages in one run", async () => {
    const r = row({ meta_audience_id: "120250000000000002" });
    const db = baseDb([r]);
    const { graph, calls } = fakeGraph([{ id: "120250000000000002", name: "x", subtype: "CUSTOM", account_id: "606252931141334" }]);
    const c = fakeCirqlin({ "": { cursor: "p1", added: entries(0, 3), hasMore: true }, p1: { cursor: "p2", added: entries(3, 2) } });
    await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: AT_TRIGGER, mode: "write", log: () => {} }, work([r]));
    assert.deepEqual(c.reads.map((x) => x.since), [null, "p1"]);
    assert.deepEqual(calls.map((x) => x.rows), [3, 2]);
    assert.equal(db.tables.customer_list_syncs[0].cursor, "p2");
  });

  it("a failed batch keeps the cursor; the retry resends only the batch that failed", async () => {
    const r = row({ meta_audience_id: "120250000000000002", cursor: "c1" });
    const db = baseDb([r]);
    const audience = { id: "120250000000000002", name: "x", subtype: "CUSTOM", account_id: "606252931141334" };
    const pages = { c1: { cursor: "c2", added: entries(0, 10_002) } };
    const lines: string[] = [];
    const first = fakeGraph([audience], { failAddOnCall: 2, failMessage: `bad entry ${entries(0, 1)[0].em}` });
    const res = await runCustomerListSync({ db, graph: first.graph, readHashed: fakeCirqlin(pages).reader, env: ON, now: AT_TRIGGER, mode: "write", log: (l) => lines.push(l) }, work([r]));
    assert.equal(res.rows[0].outcome, "meta_error");
    assert.equal(db.tables.customer_list_syncs[0].cursor, "c1");
    assert.match(String(db.tables.customer_list_syncs[0].last_error), /add batch 2 of 2 \(2 rows\)/);
    assert.match(String(db.tables.customer_list_syncs[0].last_error), /\[hash\]/);

    const second = fakeGraph([audience]);
    const again = await runCustomerListSync({ db, graph: second.graph, readHashed: fakeCirqlin(pages).reader, env: ON, now: AT_TRIGGER, mode: "write", log: (l) => lines.push(l) }, work([{ ...r }]));
    assert.equal(again.rows[0].outcome, "sent");
    assert.deepEqual(second.calls.map((x) => x.rows), [2]);
    assert.equal(db.tables.customer_list_syncs[0].cursor, "c2");
    assert.equal(db.tables.customer_list_syncs[0].last_error, null);
    assertNoHash(db, res, lines);
    assertNoHash(db, again, lines);
  });
});

describe("genre lists", () => {
  const genre = (id: string, account = ACT): SyncRow => row({ id: `row-${id}`, kind: "genre", meta_audience_id: id, ad_account_id: account });

  it("adds only, with scope=promoter, and never creates a list", async () => {
    const r = genre("120252283933420755");
    const db = baseDb([r]);
    const { graph, calls } = fakeGraph([{ id: "120252283933420755", name: "Tech House Data", subtype: "CUSTOM", account_id: "606252931141334" }]);
    const c = fakeCirqlin({ "": { cursor: "g1", added: entries(0, 3), removed: entries(50, 2) } });
    const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: AT_TRIGGER, mode: "write", log: () => {} }, work([r]));
    assert.deepEqual(c.reads, [{ scope: "promoter", since: null }]);
    assert.deepEqual(calls.map((x) => x.op), ["add"]);
    assert.equal(res.rows[0].removedNotSent, 2);
    assert.equal(db.tables.meta_custom_audiences.length, 0);
  });

  it("skips a list held in another account, and a list Meta doesn't have: no create, no add", async () => {
    const elsewhere = genre("120252282311810755");
    const gone = genre("120252282311810999");
    const db = baseDb([elsewhere, gone]);
    const { graph, calls } = fakeGraph([{ id: "120252282311810755", name: "Disco House Data", subtype: "CUSTOM", account_id: "2011069725849568" }]);
    const c = fakeCirqlin({ "": { cursor: "g1", added: entries(0, 3) } });
    const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: AT_TRIGGER, mode: "write", log: () => {} }, work([elsewhere, gone]));
    assert.deepEqual(res.rows.map((x) => x.outcome), ["other_account", "list_not_found"]);
    assert.equal(calls.length, 0);
    assert.equal(c.reads.length, 0);
  });

  it("planning: template lists in this account, the venue's high-value list by name, others skipped; nothing created", async () => {
    const db = fakeDb({
      audience_templates: [{ id: "t1", name: "House & garage", client_id: "client-1", notes: "NX27-SILVABUMPA, NX26-IPC" }],
      audience_template_items: [
        { template_id: "t1", kind: "customer_list", list_role: "buyers", meta_audience_id: "120252283933420755", detail: { name: "Tech House Data" } },
        { template_id: "t1", kind: "customer_list", list_role: "buyers", meta_audience_id: "120252296750950755", detail: { name: "Garage & Grime Data" } },
        { template_id: "t1", kind: "customer_list", list_role: "buyers", meta_audience_id: "120233817912470755", detail: { name: "NX LOVES DATA CSV" } },
        { template_id: "t1", kind: "interest", list_role: null, meta_audience_id: null, detail: {} },
      ],
      meta_custom_audiences: [],
    });
    const { graph, calls } = fakeGraph([
      { id: "120252283933420755", name: "Tech House Data", subtype: "CUSTOM", account_id: "606252931141334" },
      { id: "120252296750950755", name: "Garage & Grime Data", subtype: "CUSTOM", account_id: "2011069725849568" },
      { id: "120233817912470755", name: "NX LOVES DATA CSV", subtype: "CUSTOM", account_id: "606252931141334" },
    ]);
    const plan = await planEnable({ db, graph, event: { id: "ev-2", event_code: "NX27-SILVABUMPA", client_id: "client-1", meta_ad_account_id: "606252931141334" }, venueAccount: null });
    assert.equal(plan.template?.name, "House & garage");
    assert.deepEqual(plan.genre.map((g) => [g.name, g.skipped]), [["Tech House Data", null], ["Garage & Grime Data", "other_account"], ["NX LOVES DATA CSV", null], ["NX LOVES DATA CSV", "duplicate"]]);
    assert.deepEqual(plan.rows.map((r) => [r.kind, r.meta_audience_id]), [["show", null], ["genre", "120252283933420755"], ["genre", "120233817912470755"]]);
    assert.equal(calls.length, 0);
  });

  it("planning with no template: a 'no template' note, not an error; the high-value list still found by name", async () => {
    const db = fakeDb({ audience_templates: [], meta_custom_audiences: [] });
    const { graph } = fakeGraph([{ id: "120233817912470755", name: "NX LOVES DATA CSV", subtype: "CUSTOM", account_id: "606252931141334" }]);
    const plan = await planEnable({ db, graph, event: { id: "ev-1", event_code: "NX27-GLITTERBOX", client_id: "client-1", meta_ad_account_id: "606252931141334" }, venueAccount: null });
    assert.equal(plan.template, null);
    assert.match(plan.templateNote ?? "", /no template/);
    assert.deepEqual(plan.rows.map((r) => r.kind), ["show", "genre"]);
  });

  it("the account: the event's, else the venue's; never anything else", () => {
    assert.equal(pickAccount("606252931141334", "act_1").chosen, ACT);
    assert.equal(pickAccount(null, "act_2011069725849568").chosen, OTHER);
    assert.equal(pickAccount(null, null).chosen, null);
  });
});

describe("gates", () => {
  it("kill switch off: a write run is a dry run — no Meta write, no row write, no ledger row", async () => {
    for (const env of [{}, { OFFPIXEL_META_CUSTOMER_LIST_WRITES_ENABLED: "1" }, { OFFPIXEL_META_CUSTOMER_LIST_WRITES_ENABLED: "TRUE" }]) {
      const db = baseDb([row()]);
      const { graph, calls } = fakeGraph();
      const c = fakeCirqlin({ "": { cursor: "c1", added: entries(0, 5) } });
      const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env, now: AT_TRIGGER, mode: "write", log: () => {} }, work([row()]));
      assert.equal(res.writesOff, true);
      assert.equal(res.mode, "dry");
      assert.equal(res.rows[0].outcome, "would_create");
      assert.equal(res.rows[0].added, 5);
      assert.equal(calls.length, 0);
      assert.equal(db.writes.length, 0);
    }
  });

  it("the cron answers killswitch before any read", () => {
    const src = readFileSync("app/api/cron/customer-list-sync/route.ts", "utf8");
    const gate = src.indexOf('skippedReason: "killswitch"');
    assert.ok(gate > 0);
    for (const later of ["loadEnabledRows(", "createServiceRoleClient();\n  } catch", "runCustomerListSync("]) assert.ok(src.indexOf(later) > gate, later);
    const rules = readFileSync("lib/customer-lists/rules.ts", "utf8");
    assert.match(rules, /env\[CUSTOMER_LIST_WRITES_ENV\] === "true"/);
  });

  it("a failed ledger write refuses the Meta call", async () => {
    const db = baseDb([row({ meta_audience_id: "120250000000000002" })]);
    db.failWrites.meta_write_idempotency = { code: "XX000", message: "boom" };
    const { graph, calls } = fakeGraph([{ id: "120250000000000002", name: "x", subtype: "CUSTOM", account_id: "606252931141334" }]);
    const c = fakeCirqlin({ "": { cursor: "c1", added: entries(0, 5) } });
    const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: AT_TRIGGER, mode: "write", log: () => {} }, work([row({ meta_audience_id: "120250000000000002" })]));
    assert.equal(res.rows[0].outcome, "meta_error");
    assert.match(res.rows[0].error ?? "", /ledger is required/);
    assert.equal(calls.length, 0);
    assert.equal(db.tables.customer_list_syncs[0].cursor, null);
  });

  it("no ledger draft for the event: refused before any call", async () => {
    const db = baseDb([row()]);
    db.tables.campaign_drafts = [];
    const { graph, calls } = fakeGraph();
    const res = await runCustomerListSync({ db, graph, readHashed: fakeCirqlin({ "": { cursor: "c1", added: entries(0, 1) } }).reader, env: ON, now: AT_TRIGGER, mode: "write", log: () => {} }, work([row()]));
    assert.equal(res.rows[0].outcome, "no_ledger_draft");
    assert.equal(calls.length, 0);
  });

  it("archived clients are out", async () => {
    const db = baseDb([row()]);
    const { graph, calls } = fakeGraph();
    const c = fakeCirqlin({ "": { cursor: "c1", added: entries(0, 1) } });
    const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: AT_TRIGGER, mode: "write", log: () => {} }, work([row()], { client_status: "archived" }));
    assert.equal(res.rows[0].outcome, "archived_client");
    assert.equal(calls.length + c.reads.length + db.writes.length, 0);
  });

  it("a row whose account the event no longer resolves to is skipped", async () => {
    const db = baseDb([row()]);
    const { graph, calls } = fakeGraph();
    const res = await runCustomerListSync({ db, graph, readHashed: fakeCirqlin({}).reader, env: ON, now: AT_TRIGGER, mode: "write", log: () => {} }, work([row()], { account: OTHER }));
    assert.equal(res.rows[0].outcome, "account_changed");
    assert.equal(calls.length, 0);
  });
});

describe("a failed CIRQLIN read leaves everything as it was", () => {
  for (const reason of ["not_available", "timeout", "bad_shape", "unauthorized"] as const) {
    it(reason, async () => {
      const rows = [row(), row({ id: "row-g", kind: "genre", meta_audience_id: "120252283933420755" })];
      const db = baseDb(rows);
      const before = JSON.stringify(db.tables);
      const { graph, calls } = fakeGraph([{ id: "120252283933420755", name: "Tech House Data", subtype: "CUSTOM", account_id: "606252931141334" }]);
      const c = fakeCirqlin({}, { ok: false, reason });
      const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: AT_TRIGGER, mode: "write", log: () => {} }, work(rows));
      assert.deepEqual(res.rows.map((x) => x.outcome), [`cirqlin_${reason}`, `cirqlin_${reason}`]);
      assert.equal(calls.length, 0, "no list made, no users sent");
      assert.equal(db.writes.length, 0);
      assert.equal(JSON.stringify(db.tables), before);
    });
  }
});

function assertNoHash(db: FakeDb, result: unknown, lines: string[]) {
  const scan = (label: string, text: string) => {
    for (const h of ALL_FIXTURE_HASHES) assert.ok(!text.includes(h), `${label} carries a signup hash`);
  };
  scan("log", lines.join("\n"));
  scan("result", JSON.stringify(result));
  scan("db writes", JSON.stringify(db.writes));
  scan("tables", JSON.stringify(db.tables));
  // No 64-hex at all outside the ledger's own payload hash.
  const rest = Object.fromEntries(Object.entries(db.tables).filter(([t]) => t !== "meta_write_idempotency"));
  assert.doesNotMatch(JSON.stringify(rest), /[0-9a-f]{64}/);
  assert.doesNotMatch(lines.join("\n"), /[0-9a-f]{64}/);
  assert.doesNotMatch(JSON.stringify(result), /[0-9a-f]{64}/);
}

describe("no hash in any log, row or error", () => {
  it("a full run: create, adds, removes, a genre list", async () => {
    const show = row();
    const g = row({ id: "row-g", kind: "genre", meta_audience_id: "120252283933420755" });
    const db = baseDb([show, g]);
    const { graph } = fakeGraph([{ id: "120252283933420755", name: "Tech House Data", subtype: "CUSTOM", account_id: "606252931141334" }]);
    const c = fakeCirqlin({ "": { cursor: "c1", added: entries(0, 50), removed: entries(1000, 5) } });
    const lines: string[] = [];
    const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: AT_TRIGGER, mode: "write", log: (l) => lines.push(l) }, work([show, g]));
    assert.deepEqual(res.rows.map((x) => x.outcome), ["sent", "sent"]);
    assertNoHash(db, res, lines);
  });

  it("redactHashes replaces any SHA-256 in text", () => {
    assert.equal(redactHashes(`x ${sha("a")} y`), "x [hash] y");
  });

  it("the ledger key names the list, direction and cursors, never a hash", () => {
    const src = readFileSync("lib/customer-lists/sync.ts", "utf8");
    assert.match(src, /\{ audience_id: listId, op, since: since \?\? null, next: p\.cursor, batch: i, rows: batch\.data\.length \}/);
  });

  it("the live writer never logs and never reads invalid_entry_samples", () => {
    const src = readFileSync("lib/customer-lists/graph-live.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(src, /console\./);
    assert.doesNotMatch(src, /graphPostWithToken/);
    assert.doesNotMatch(src.replace(/^.*invalid_entry_samples.*$/gm, (l) => (l.trim().startsWith("//") ? "" : l)), /invalid_entry_samples/);
  });
});

describe("CIRQLIN's hashed endpoint", () => {
  it("not_available while it isn't live (404), not_configured without the secret", async () => {
    const fetch404 = (async () => new Response("not found", { status: 404 })) as typeof fetch;
    assert.deepEqual(await cirqlinHashedReader({ secret: "s", fetchImpl: fetch404 })({ tag: "t", scope: "show", since: null }), { ok: false, reason: "not_available", status: 404 });
    assert.deepEqual(await cirqlinHashedReader({ env: {}, fetchImpl: fetch404 })({ tag: "t", scope: "show", since: null }), { ok: false, reason: "not_configured" });
  });

  it("sends crm_base_tag, scope, since and the bearer; parses the spec's shape", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const body = { cursor: "c9", added: [{ em: sha("a@b.c") }, { ph: sha("447000") }], removed: [], counts: { consented_show: 2, consented_promoter: 2, not_consented: 1 } };
    const fetchOk = (async (url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get("authorization") };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await cirqlinHashedReader({ secret: "s3", base: "https://cirqlin.test", fetchImpl: fetchOk })({ tag: "CQ-x", scope: "promoter", since: "c8" });
    assert.equal(seen!.url, "https://cirqlin.test/api/partner/signups/hashed?crm_base_tag=CQ-x&scope=promoter&since=c8");
    assert.equal(seen!.auth, "Bearer s3");
    assert.ok(res.ok);
    if (res.ok) {
      assert.equal(res.page.cursor, "c9");
      assert.equal(res.page.added.length, 2);
      assert.equal(res.page.hasMore, false);
    }
  });

  it("a non-hex entry fails the whole page; a full page reads as has_more", () => {
    assert.equal(parseHashedPage({ cursor: "c", added: [{ em: "fan@example.com" }], removed: [] }), null);
    const full = parseHashedPage({ cursor: "c", added: entries(0, 10_000), removed: [] });
    assert.equal(full?.hasMore, true);
  });

  it("Meta rows: [EMAIL_SHA256, PHONE_SHA256], '' for a missing key", () => {
    const [b] = usersBatches([{ em: sha("a") }, { ph: sha("1") }]);
    assert.deepEqual(b.data, [[sha("a"), ""], ["", sha("1")]]);
  });
});

describe("migration 267", () => {
  const sql = readFileSync("supabase/migrations/267_customer_list_syncs.sql", "utf8");
  it("adds both kinds and keeps every kind live on prod (read 24 Nov)", () => {
    const listed = [...sql.slice(sql.indexOf("add constraint meta_write_idempotency_op_kind_check")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const live = ["campaign_create", "adset_create", "ad_create", "creative_upload", "adset_targeting_update", "adset_destination_update", "refresh_creative_create", "refresh_ad_create", "ad_status_update", "adset_status_update", "refresh_adset_budget_update", "refresh_adset_create", "refresh_custom_conversion_create", "refresh_campaign_create", "refresh_campaign_lifetime_budget_update", "refresh_campaign_status_update", "retargeting_audience_rule_update", "retargeting_study_create", "retargeting_study_end", "adset_end_time_update"];
    for (const kind of [...live, "customer_list_create", "customer_list_users"]) assert.ok(listed.includes(kind), kind);
    assert.equal(listed.length, 22);
    assert.ok(sql.indexOf("drop constraint if exists meta_write_idempotency_op_kind_check") < sql.indexOf("add constraint meta_write_idempotency_op_kind_check"));
  });

  it("customer_list_syncs: the brief's columns, unique (event, kind, list), service role only", () => {
    for (const col of ["event_id", "kind", "meta_audience_id", "ad_account_id", "enabled", "cursor", "sent_total", "removed_total", "last_sent_at", "last_error", "created_at", "updated_at"]) assert.match(sql, new RegExp(`\\n  ${col} `), col);
    assert.match(sql, /enabled\s+boolean\s+not null default false/);
    assert.match(sql, /unique nulls not distinct \(event_id, kind, meta_audience_id\)/);
    assert.match(sql, /enable row level security/);
    assert.doesNotMatch(sql, /create policy/i);
  });
});
