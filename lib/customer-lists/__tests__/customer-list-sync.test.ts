import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { cirqlinHashedReader, parseHashedPage, type HashedEntry, type HashedReader, type HashedReadResult } from "../cirqlin-hashed.ts";
import { planEnable } from "../enable.ts";
import { eightLondonOn, isEightLondon, listTriggerAt, londonWeekday, normaliseAccount, pickAccount, redactHashes, replaceDue, replaceSessionId, syncState, usersBatches } from "../rules.ts";
import { runCustomerListSync, type CustomerListGraph, type MetaAudience, type ReplaceSession, type SyncEvent, type SyncRow, type SyncWork } from "../sync.ts";
import { showName, templateMatchesShow, type TemplateRow } from "../templates.ts";
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
    name: "Glitterbox - Newcastle",
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
    last_replaced_at: null,
    created_at: "2026-11-25T10:00:00Z",
    ...over,
  };
}

const SHOW_LIST: MetaAudience = { id: "120250000000000002", name: "NX27-GLITTERBOX · Signups", subtype: "CUSTOM", account_id: "606252931141334" };
const TECH_HOUSE: MetaAudience = { id: "120252283933420755", name: "Tech House Data", subtype: "CUSTOM", account_id: "606252931141334" };
const NX_LOVES: MetaAudience = { id: "120233817912470755", name: "NX LOVES DATA CSV", subtype: "CUSTOM", account_id: "606252931141334" };

type Call = { op: "create" | "add" | "remove" | "replace"; id: string; rows: number; session?: ReplaceSession };

function fakeGraph(audiences: MetaAudience[] = [], opts: { failAddOnCall?: number; failReplaceOnCall?: number; failMessage?: string } = {}) {
  const calls: Call[] = [];
  let addCalls = 0;
  let replaceCalls = 0;
  const all = [...audiences];
  const fail = (code: number) => {
    const err = new Error(opts.failMessage ?? "Invalid parameter") as Error & { code: number };
    err.code = code;
    return err;
  };
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
      if (opts.failAddOnCall === addCalls) throw fail(100);
      calls.push({ op: "add", id, rows: payload.data.length });
      assert.deepEqual(payload.schema, ["EMAIL_SHA256", "PHONE_SHA256"]);
      return { received: payload.data.length, invalid: 0 };
    },
    async removeUsers(id, payload) {
      calls.push({ op: "remove", id, rows: payload.data.length });
      return { received: payload.data.length, invalid: 0 };
    },
    async replaceUsers(id, payload, session) {
      replaceCalls += 1;
      if (opts.failReplaceOnCall === replaceCalls) throw fail(2650);
      calls.push({ op: "replace", id, rows: payload.data.length, session: { ...session } });
      assert.deepEqual(payload.schema, ["EMAIL_SHA256", "PHONE_SHA256"]);
      return { received: payload.data.length, invalid: 0 };
    },
  };
  return { graph, calls };
}

/** CIRQLIN by cursor: pages[since ?? ""]. */
function fakeCirqlin(pages: Record<string, { cursor: string; added: HashedEntry[]; removed?: HashedEntry[]; hasMore?: boolean }>, fail?: HashedReadResult) {
  const reads: { scope: string; since: string | null }[] = [];
  const reader: HashedReader = async ({ scope, since }) => {
    reads.push({ scope, since });
    if (fail) return fail;
    const p = pages[since ?? ""];
    if (!p) return { ok: true, page: { cursor: since, added: [], removed: [], counts: null, hasMore: false } };
    return { ok: true, page: { cursor: p.cursor, added: remember(p.added), removed: remember(p.removed ?? []), counts: { consented_show: p.added.length, consented_promoter: p.added.length + 7, not_consented: 3 }, hasMore: p.hasMore ?? false } };
  };
  return { reader, reads };
}

/** A template (CC-3's shape: shows as names in notes) holding two genre lists. */
const TEMPLATES = (notes = "Glitterbox, Fol Amour"): Record<string, Record<string, unknown>[]> => ({
  audience_templates: [{ id: "t1", user_id: "user-1", name: "House & disco", client_id: "client-1", notes }],
  audience_template_items: [
    { id: "i1", template_id: "t1", kind: "customer_list", list_role: "buyers", family_key: "house_tech", page_id: null, retention_days: null, interest_id: null, meta_audience_id: TECH_HOUSE.id, detail: { name: TECH_HOUSE.name } },
    { id: "i2", template_id: "t1", kind: "customer_list", list_role: "buyers", family_key: "disco", page_id: null, retention_days: null, interest_id: null, meta_audience_id: NX_LOVES.id, detail: { name: NX_LOVES.name } },
  ],
});

function baseDb(rows: SyncRow[], extra: Record<string, Record<string, unknown>[]> = {}): FakeDb {
  return fakeDb({
    customer_list_syncs: rows.map((r) => ({ ...r })),
    campaign_drafts: [{ id: "draft-1", event_id: EVENT_ID, created_at: "2026-11-19T10:00:00Z" }],
    meta_custom_audiences: [],
    meta_write_idempotency: [],
    audience_templates: [],
    audience_template_items: [],
    ...extra,
  });
}

function work(rows: SyncRow[], over: Partial<SyncEvent> = {}): SyncWork[] {
  return [{ event: event(over), rows }];
}

const AT_TRIGGER = new Date("2026-11-27T08:00:00Z");
const MONDAY = new Date("2026-11-30T08:00:00Z");
const TUESDAY = new Date("2026-12-01T08:00:00Z");

describe("when a show's list is made", () => {
  it("presale day 08:00 London, in winter and summer", () => {
    assert.equal(listTriggerAt({ presale_at: "2026-11-27T12:00:00Z", general_sale_at: "2026-11-27T14:00:00Z", event_date: null })?.toISOString(), "2026-11-27T08:00:00.000Z");
    assert.equal(eightLondonOn("2026-07-10").toISOString(), "2026-07-10T07:00:00.000Z");
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
    assert.equal(calls.length + c.reads.length + db.writes.length, 0);
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
    assert.equal(reg.meta_ad_account_id, ACT);
    assert.deepEqual(db.tables.meta_write_idempotency.map((r) => r.op_kind), ["customer_list_create", "customer_list_users", "customer_list_users"]);
    assert.ok(db.tables.meta_write_idempotency.every((r) => r.op_status === "success" && r.draft_id === "draft-1"));
  });

  it("already passed and newly enabled: acts at once, and adopts a list of the same name instead of making a second", async () => {
    const db = baseDb([row()]);
    const { graph, calls } = fakeGraph([SHOW_LIST]);
    const c = fakeCirqlin({ "": { cursor: "c1", added: entries(0, 4) } });
    const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: new Date("2026-11-28T08:00:00Z"), mode: "write", log: () => {} }, work([row()]));
    assert.equal(res.rows[0].outcome, "sent");
    assert.deepEqual(calls.map((x) => x.op), ["add"]);
    assert.equal(calls[0].id, SHOW_LIST.id);
    assert.equal(db.tables.customer_list_syncs[0].meta_audience_id, SHOW_LIST.id);
  });
});

describe("adds and removes by cursor", () => {
  it("the next run reads from the saved cursor, adds the new and removes the withdrawn", async () => {
    const r = row({ meta_audience_id: SHOW_LIST.id, cursor: "c1", sent_total: 10 });
    const db = baseDb([r]);
    const { graph, calls } = fakeGraph([SHOW_LIST]);
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

  it("follows has_more pages in one run, moving the cursor page by page", async () => {
    const r = row({ meta_audience_id: SHOW_LIST.id });
    const db = baseDb([r]);
    const { graph, calls } = fakeGraph([SHOW_LIST]);
    const c = fakeCirqlin({ "": { cursor: "p1", added: entries(0, 3), hasMore: true }, p1: { cursor: "p2", added: entries(3, 2), hasMore: true }, p2: { cursor: "p3", added: entries(5, 1) } });
    const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: AT_TRIGGER, mode: "write", log: () => {} }, work([r]));
    assert.deepEqual(c.reads.map((x) => x.since), [null, "p1", "p2"]);
    assert.deepEqual(calls.map((x) => x.rows), [3, 2, 1]);
    assert.equal(res.rows[0].pages, 3);
    assert.equal(db.tables.customer_list_syncs[0].cursor, "p3");
  });

  it("a failed batch keeps the cursor; the retry resends only the batch that failed", async () => {
    const r = row({ meta_audience_id: SHOW_LIST.id, cursor: "c1" });
    const db = baseDb([r]);
    const pages = { c1: { cursor: "c2", added: entries(0, 10_002) } };
    const lines: string[] = [];
    const first = fakeGraph([SHOW_LIST], { failAddOnCall: 2, failMessage: `bad entry ${entries(0, 1)[0].em}` });
    const res = await runCustomerListSync({ db, graph: first.graph, readHashed: fakeCirqlin(pages).reader, env: ON, now: AT_TRIGGER, mode: "write", log: (l) => lines.push(l) }, work([r]));
    assert.equal(res.rows[0].outcome, "meta_error");
    assert.equal(db.tables.customer_list_syncs[0].cursor, "c1");
    assert.match(String(db.tables.customer_list_syncs[0].last_error), /add batch 2 of 2 \(2 rows\)/);
    assert.match(String(db.tables.customer_list_syncs[0].last_error), /\[hash\]/);

    const second = fakeGraph([SHOW_LIST]);
    const again = await runCustomerListSync({ db, graph: second.graph, readHashed: fakeCirqlin(pages).reader, env: ON, now: AT_TRIGGER, mode: "write", log: (l) => lines.push(l) }, work([{ ...r }]));
    assert.equal(again.rows[0].outcome, "sent");
    assert.deepEqual(second.calls.map((x) => x.rows), [2]);
    assert.equal(db.tables.customer_list_syncs[0].cursor, "c2");
    assert.equal(db.tables.customer_list_syncs[0].last_error, null);
    assertNoHash(db, res, lines);
    assertNoHash(db, again, lines);
  });
});

describe("the weekly full replace", () => {
  it("is due on the Monday run, once a day, and on the first run 7 days after a missed Monday", () => {
    assert.equal(londonWeekday(MONDAY), 1);
    assert.equal(replaceDue({ cursor: "c", last_replaced_at: null }, MONDAY), true);
    assert.equal(replaceDue({ cursor: "c", last_replaced_at: "2026-11-30T08:00:05Z" }, new Date("2026-11-30T09:00:00Z")), false, "not twice on one London day");
    assert.equal(replaceDue({ cursor: "c", last_replaced_at: "2026-11-30T08:00:00Z" }, TUESDAY), false);
    assert.equal(replaceDue({ cursor: "c", last_replaced_at: "2026-11-23T08:00:00Z" }, TUESDAY), true, "Monday missed: caught up");
    assert.equal(replaceDue({ cursor: "c", last_replaced_at: null, created_at: "2026-11-23T10:00:00Z" }, TUESDAY), true, "never replaced: 7 days from the row");
    assert.equal(replaceDue({ cursor: "c", last_replaced_at: null, created_at: "2026-11-27T10:00:00Z" }, TUESDAY), false);
    assert.equal(replaceDue({ cursor: null, last_replaced_at: null }, MONDAY), false, "the first sync is already the full list");
  });

  it("the session id: one per list per London day, a safe positive integer", () => {
    const a = replaceSessionId(SHOW_LIST.id, "2026-11-30");
    assert.equal(a, replaceSessionId(SHOW_LIST.id, "2026-11-30"));
    assert.notEqual(a, replaceSessionId(SHOW_LIST.id, "2026-12-07"));
    assert.ok(Number.isSafeInteger(a) && a > 0);
  });

  it("reads CIRQLIN with no cursor to the end, then one session of 10,000 batches, last_batch_flag on the last only; stores the snapshot's cursor", async () => {
    const r = row({ meta_audience_id: SHOW_LIST.id, cursor: "c5", sent_total: 9 });
    const db = baseDb([r]);
    const { graph, calls } = fakeGraph([SHOW_LIST]);
    const c = fakeCirqlin({ "": { cursor: "s1", added: entries(0, 10_000), hasMore: true }, s1: { cursor: "s2", added: entries(10_000, 10_000), hasMore: true }, s2: { cursor: "s3", added: entries(20_000, 5) }, c5: { cursor: "c6", added: entries(90_000, 1) } });
    const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: MONDAY, mode: "write", log: () => {} }, work([r]));
    assert.equal(res.rows[0].outcome, "replaced");
    assert.deepEqual(c.reads.map((x) => [x.scope, x.since]), [["show", null], ["show", "s1"], ["show", "s2"]], "no cursor read on replace day");
    assert.deepEqual(calls.map((x) => [x.op, x.rows]), [["replace", 10_000], ["replace", 10_000], ["replace", 5]]);
    const sessions = calls.map((x) => x.session!);
    assert.equal(new Set(sessions.map((s) => s.session_id)).size, 1);
    assert.equal(sessions[0].session_id, replaceSessionId(SHOW_LIST.id, "2026-11-30"));
    assert.deepEqual(sessions.map((s) => [s.batch_seq, s.last_batch_flag, s.estimated_num_total]), [[1, false, 20_005], [2, false, 20_005], [3, true, 20_005]]);
    assert.equal(res.rows[0].replaced, 20_005);
    assert.equal(res.rows[0].pages, 3);
    const stored = db.tables.customer_list_syncs[0];
    assert.equal(stored.cursor, "s3");
    assert.equal(stored.last_replaced_at, MONDAY.toISOString());
    assert.equal(stored.last_replace_count, 20_005);
    const keys = db.tables.meta_write_idempotency.map((x) => x.op_kind);
    assert.deepEqual(keys, ["customer_list_users", "customer_list_users", "customer_list_users"]);
  });

  it("the next day goes back to the cursor (adds and removes)", async () => {
    const r = row({ meta_audience_id: SHOW_LIST.id, cursor: "s3", last_replaced_at: MONDAY.toISOString() });
    const db = baseDb([r]);
    const { graph, calls } = fakeGraph([SHOW_LIST]);
    const c = fakeCirqlin({ s3: { cursor: "s4", added: entries(0, 1), removed: entries(5, 1) } });
    await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: TUESDAY, mode: "write", log: () => {} }, work([r]));
    assert.deepEqual(c.reads.map((x) => x.since), ["s3"]);
    assert.deepEqual(calls.map((x) => x.op), ["add", "remove"]);
  });

  it("a failed batch keeps the cursor; the same-day retry carries on the same session, resending only what failed", async () => {
    const r = row({ meta_audience_id: SHOW_LIST.id, cursor: "c5" });
    const db = baseDb([r]);
    const pages = { "": { cursor: "s1", added: entries(0, 10_000), hasMore: true }, s1: { cursor: "s2", added: entries(10_000, 3) } };
    const first = fakeGraph([SHOW_LIST], { failReplaceOnCall: 2 });
    const a = await runCustomerListSync({ db, graph: first.graph, readHashed: fakeCirqlin(pages).reader, env: ON, now: MONDAY, mode: "write", log: () => {} }, work([r]));
    assert.equal(a.rows[0].outcome, "meta_error");
    assert.match(a.rows[0].error ?? "", /replace batch 2 of 2 \(3 rows\)/);
    assert.equal(db.tables.customer_list_syncs[0].cursor, "c5");
    assert.equal(db.tables.customer_list_syncs[0].last_replaced_at, null);

    const second = fakeGraph([SHOW_LIST]);
    const b = await runCustomerListSync({ db, graph: second.graph, readHashed: fakeCirqlin(pages).reader, env: ON, now: new Date("2026-11-30T09:00:00Z"), mode: "write", log: () => {} }, work([{ ...r }]));
    assert.equal(b.rows[0].outcome, "replaced");
    assert.deepEqual(second.calls.map((x) => [x.rows, x.session!.batch_seq, x.session!.last_batch_flag, x.session!.session_id]), [[3, 2, true, replaceSessionId(SHOW_LIST.id, "2026-11-30")]]);
    assert.equal(db.tables.customer_list_syncs[0].cursor, "s2");
  });

  it("half a snapshot is never a replace: a failed later page writes nothing", async () => {
    const r = row({ meta_audience_id: SHOW_LIST.id, cursor: "c5" });
    const db = baseDb([r]);
    const { graph, calls } = fakeGraph([SHOW_LIST]);
    let n = 0;
    const reader: HashedReader = async () => {
      n += 1;
      return n === 1 ? { ok: true, page: { cursor: "s1", added: remember(entries(0, 3)), removed: [], counts: null, hasMore: true } } : { ok: false, reason: "timeout" };
    };
    const res = await runCustomerListSync({ db, graph, readHashed: reader, env: ON, now: MONDAY, mode: "write", log: () => {} }, work([r]));
    assert.equal(res.rows[0].outcome, "cirqlin_timeout");
    assert.equal(calls.length, 0);
    assert.equal(db.tables.customer_list_syncs[0].cursor, "c5");
  });

  it("dry run: counts what it would replace, writes nothing", async () => {
    const r = row({ meta_audience_id: SHOW_LIST.id, cursor: "c5" });
    const db = baseDb([r]);
    const { graph, calls } = fakeGraph([SHOW_LIST]);
    const res = await runCustomerListSync({ db, graph, readHashed: fakeCirqlin({ "": { cursor: "s1", added: entries(0, 12) } }).reader, env: {}, now: MONDAY, mode: "write", log: () => {} }, work([r]));
    assert.equal(res.rows[0].outcome, "would_replace");
    assert.equal(res.rows[0].replaced, 12);
    assert.equal(calls.length + db.writes.length, 0);
  });
});

describe("genre lists get nothing; the show list joins its templates", () => {
  it("in a write run with genre lists in the template, every Meta write is to the show's own list", async () => {
    for (const now of [AT_TRIGGER, MONDAY]) {
      const r = now === MONDAY ? row({ meta_audience_id: SHOW_LIST.id, cursor: "c1" }) : row();
      const db = baseDb([r], TEMPLATES());
      const { graph, calls } = fakeGraph([TECH_HOUSE, NX_LOVES, ...(now === MONDAY ? [SHOW_LIST] : [])]);
      const c = fakeCirqlin({ "": { cursor: "c1", added: entries(0, 20), removed: entries(40, 2) }, c1: { cursor: "c2", added: entries(60, 2) } });
      const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now, mode: "write", log: () => {} }, work([r]));
      const showId = res.rows[0].listId!;
      assert.ok(calls.length > 0);
      for (const call of calls.filter((x) => x.op !== "create")) assert.equal(call.id, showId, `${call.op} went to ${call.id}`);
      assert.ok(!calls.some((x) => x.id === TECH_HOUSE.id || x.id === NX_LOVES.id));
      assert.ok(c.reads.every((x) => x.scope === "show"));
    }
  });

  it("a genre row left on the table is never synced", async () => {
    const g = { ...row({ id: "row-g", meta_audience_id: TECH_HOUSE.id }), kind: "genre" } as unknown as SyncRow;
    const db = baseDb([g]);
    const { graph, calls } = fakeGraph([TECH_HOUSE]);
    const c = fakeCirqlin({ "": { cursor: "c1", added: entries(0, 3) } });
    const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: AT_TRIGGER, mode: "write", log: () => {} }, work([g]));
    assert.equal(res.rows.length, 0);
    assert.equal(calls.length + c.reads.length, 0);
  });

  it("no genre or high-value write anywhere in the engine, the script or the cron (grep)", () => {
    const files = [
      ...readdirSync("lib/customer-lists").filter((f) => f.endsWith(".ts")).map((f) => `lib/customer-lists/${f}`),
      "scripts/customer-list-sync.mts",
      "app/api/cron/customer-list-sync/route.ts",
    ];
    for (const f of files) {
      const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      assert.doesNotMatch(code, /["']genre["']/, `${f}: a "genre" kind`);
      assert.doesNotMatch(code, /HIGH_VALUE|high[-_ ]value/i, `${f}: the high-value list`);
      if (!f.endsWith("cirqlin-hashed.ts")) assert.doesNotMatch(code, /["']promoter["']/, `${f}: a scope=promoter read`);
    }
  });

  it("on list create, the list is added to each template whose shows include the event (by code or by name), once", async () => {
    const db = baseDb([row()], TEMPLATES());
    const { graph, calls } = fakeGraph();
    const c = fakeCirqlin({ "": { cursor: "c1", added: entries(0, 3) } });
    const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: AT_TRIGGER, mode: "write", log: () => {} }, work([row()]));
    const listId = calls[0].id;
    assert.deepEqual(res.rows[0].templates.map((t) => [t.template, t.action]), [["House & disco", "added"]]);
    const items = db.tables.audience_template_items;
    assert.equal(items.length, 3, "one show-lists item next to the two genre lists");
    const added = items[2];
    assert.equal(added.kind, "customer_list");
    assert.equal(added.list_role, "signups");
    assert.equal(added.family_key, null);
    assert.equal(added.meta_audience_id, null);
    assert.equal(added.user_id, "user-1");
    assert.deepEqual((added.detail as { show_lists: unknown }).show_lists, [{ code: "NX27-GLITTERBOX", meta_audience_id: listId, ad_account_id: ACT, name: "NX27-GLITTERBOX · Signups" }]);
    // The genre items are as they were.
    assert.deepEqual(items.slice(0, 2), TEMPLATES().audience_template_items);

    const again = await runCustomerListSync({ db, graph, readHashed: fakeCirqlin({ c1: { cursor: "c2", added: [] } }).reader, env: ON, now: AT_TRIGGER, mode: "write", log: () => {} }, work([{ ...row(), meta_audience_id: listId, cursor: "c1" }]));
    assert.deepEqual(again.rows[0].templates.map((t) => t.action), ["present"]);
    assert.equal(db.tables.audience_template_items.length, 3);
  });

  it("a second show in the same template is appended to the same item", async () => {
    const tables = TEMPLATES("Glitterbox, Fol Amour");
    tables.audience_template_items.push({
      id: "i3",
      template_id: "t1",
      kind: "customer_list",
      list_role: "signups",
      family_key: null,
      page_id: null,
      retention_days: null,
      interest_id: null,
      meta_audience_id: null,
      detail: { name: "Show signup lists", show_lists: [{ code: "NX26-FOLAMOUR", meta_audience_id: "120250000000000077", ad_account_id: ACT, name: "NX26-FOLAMOUR · Signups" }] },
    });
    const db = baseDb([row({ meta_audience_id: SHOW_LIST.id, cursor: "c1" })], tables);
    const { graph } = fakeGraph([SHOW_LIST]);
    await runCustomerListSync({ db, graph, readHashed: fakeCirqlin({}).reader, env: ON, now: AT_TRIGGER, mode: "write", log: () => {} }, work([row({ meta_audience_id: SHOW_LIST.id, cursor: "c1" })]));
    const lists = (db.tables.audience_template_items[2].detail as { show_lists: { code: string }[] }).show_lists;
    assert.deepEqual(lists.map((l) => l.code), ["NX26-FOLAMOUR", "NX27-GLITTERBOX"]);
  });

  it("matching: code or CC-3's show name, case-insensitive; another client's or show's templates don't match", () => {
    assert.equal(showName("AZYR b2b Partiboi69"), "AZYR");
    assert.equal(showName("Glitterbox - Newcastle"), "Glitterbox");
    assert.equal(templateMatchesShow({ notes: "glitterbox, Fol Amour" }, "NX27-GLITTERBOX", "Glitterbox - Newcastle"), true);
    assert.equal(templateMatchesShow({ notes: "NX27-GLITTERBOX" }, "NX27-GLITTERBOX", null), true);
    assert.equal(templateMatchesShow({ notes: "Silva Bumpa" }, "NX27-GLITTERBOX", "Glitterbox - Newcastle"), false);
  });

  it("dry run and proposed templates: says would_add, writes nothing", async () => {
    const proposed: TemplateRow[] = [{ id: "proposed-1", user_id: null, name: "House & disco", notes: "Glitterbox", client_id: "client-1", proposed: true }];
    const db = baseDb([row()]);
    const { graph } = fakeGraph();
    const res = await runCustomerListSync({ db, graph, readHashed: fakeCirqlin({ "": { cursor: "c1", added: entries(0, 2) } }).reader, env: {}, now: AT_TRIGGER, mode: "dry", log: () => {}, templates: proposed }, work([row()]));
    assert.deepEqual(res.rows[0].templates, [{ templateId: "proposed-1", template: "House & disco", proposed: true, action: "would_add" }]);
    assert.equal(db.writes.length, 0);
  });

  it("no template lists the show: a note, not an error", async () => {
    const db = baseDb([row()]);
    const { graph } = fakeGraph();
    const res = await runCustomerListSync({ db, graph, readHashed: fakeCirqlin({ "": { cursor: "c1", added: entries(0, 2) } }).reader, env: ON, now: AT_TRIGGER, mode: "write", log: () => {} }, work([row()]));
    assert.equal(res.rows[0].outcome, "sent");
    assert.deepEqual(res.rows[0].templates, []);
    assert.match(res.rows[0].templatesNote ?? "", /no templates/);
    assert.equal(res.rows[0].error, null);
  });
});

describe("the account and --enable", () => {
  it("the event's, else the venue's; never anything else", () => {
    assert.equal(pickAccount("606252931141334", "act_1").chosen, ACT);
    assert.equal(pickAccount(null, "act_2011069725849568").chosen, OTHER);
    assert.equal(pickAccount(null, null).chosen, null);
  });

  it("--enable plans the show row only, adopting a same-named list; nothing created", async () => {
    const db = fakeDb({ meta_custom_audiences: [] });
    const { graph, calls } = fakeGraph([{ ...SHOW_LIST, name: "NX27-SILVABUMPA · Signups" }, TECH_HOUSE, NX_LOVES]);
    const plan = await planEnable({ db, graph, event: { id: "ev-2", event_code: "NX27-SILVABUMPA", client_id: "client-1", meta_ad_account_id: "606252931141334" }, venueAccount: null });
    assert.deepEqual(plan.rows.map((r) => [r.kind, r.meta_audience_id]), [["show", SHOW_LIST.id]]);
    assert.equal(plan.showList.existingFrom, "by_name");
    assert.equal(calls.length, 0);
  });
});

describe("gates", () => {
  it("kill switch off: a write run is a dry run — no Meta write, no row write, no ledger row", async () => {
    for (const env of [{}, { OFFPIXEL_META_CUSTOMER_LIST_WRITES_ENABLED: "1" }, { OFFPIXEL_META_CUSTOMER_LIST_WRITES_ENABLED: "TRUE" }]) {
      const db = baseDb([row()], TEMPLATES());
      const { graph, calls } = fakeGraph();
      const c = fakeCirqlin({ "": { cursor: "c1", added: entries(0, 5) } });
      const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env, now: AT_TRIGGER, mode: "write", log: () => {} }, work([row()]));
      assert.equal(res.writesOff, true);
      assert.equal(res.mode, "dry");
      assert.equal(res.rows[0].outcome, "would_create");
      assert.equal(res.rows[0].added, 5);
      assert.deepEqual(res.rows[0].templates.map((t) => t.action), ["would_add"]);
      assert.equal(calls.length, 0);
      assert.equal(db.writes.length, 0);
    }
  });

  it("the cron answers killswitch before any read", () => {
    const src = readFileSync("app/api/cron/customer-list-sync/route.ts", "utf8");
    const gate = src.indexOf('skippedReason: "killswitch"');
    assert.ok(gate > 0);
    for (const later of ["loadEnabledRows(", "createServiceRoleClient();\n  } catch", "runCustomerListSync("]) assert.ok(src.indexOf(later) > gate, later);
    assert.match(readFileSync("lib/customer-lists/rules.ts", "utf8"), /env\[CUSTOMER_LIST_WRITES_ENV\] === "true"/);
  });

  it("a failed ledger write refuses the Meta call", async () => {
    const db = baseDb([row({ meta_audience_id: SHOW_LIST.id })]);
    db.failWrites.meta_write_idempotency = { code: "XX000", message: "boom" };
    const { graph, calls } = fakeGraph([SHOW_LIST]);
    const c = fakeCirqlin({ "": { cursor: "c1", added: entries(0, 5) } });
    const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: AT_TRIGGER, mode: "write", log: () => {} }, work([row({ meta_audience_id: SHOW_LIST.id })]));
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
  for (const reason of ["not_linked", "not_available", "timeout", "bad_shape", "unauthorized"] as const) {
    it(reason, async () => {
      const rows = [row()];
      const db = baseDb(rows, TEMPLATES());
      const before = JSON.stringify(db.tables);
      const { graph, calls } = fakeGraph();
      const c = fakeCirqlin({}, { ok: false, reason });
      const lines: string[] = [];
      const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: AT_TRIGGER, mode: "write", log: (l) => lines.push(l) }, work(rows));
      assert.deepEqual(res.rows.map((x) => x.outcome), [`cirqlin_${reason}`]);
      assert.match(lines.join("\n"), new RegExp(`outcome=cirqlin_${reason} pages=0 added=0 removed=0 replaced=0`));
      assert.equal(calls.length, 0, "no list made, no users sent");
      assert.equal(db.writes.length, 0, "no row, ledger or template write");
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
  it("a full run: create, adds, removes, a template item", async () => {
    const show = row();
    const db = baseDb([show], TEMPLATES());
    const { graph } = fakeGraph();
    const c = fakeCirqlin({ "": { cursor: "c1", added: entries(0, 50), removed: entries(1000, 5) } });
    const lines: string[] = [];
    const res = await runCustomerListSync({ db, graph, readHashed: c.reader, env: ON, now: AT_TRIGGER, mode: "write", log: (l) => lines.push(l) }, work([show]));
    assert.deepEqual(res.rows.map((x) => x.outcome), ["sent"]);
    assertNoHash(db, res, lines);
  });

  it("a weekly replace, a failed batch whose error carries a hash, and the retry", async () => {
    const r = row({ meta_audience_id: SHOW_LIST.id, cursor: "c5" });
    const db = baseDb([r]);
    const lines: string[] = [];
    const pages = { "": { cursor: "s1", added: entries(0, 10_000), hasMore: true }, s1: { cursor: "s2", added: entries(10_000, 3) } };
    const first = fakeGraph([SHOW_LIST], { failReplaceOnCall: 2, failMessage: `bad ${entries(0, 1)[0].em}` });
    const a = await runCustomerListSync({ db, graph: first.graph, readHashed: fakeCirqlin(pages).reader, env: ON, now: MONDAY, mode: "write", log: (l) => lines.push(l) }, work([r]));
    assert.match(a.rows[0].error ?? "", /\[hash\]/);
    const second = fakeGraph([SHOW_LIST]);
    const b = await runCustomerListSync({ db, graph: second.graph, readHashed: fakeCirqlin(pages).reader, env: ON, now: MONDAY, mode: "write", log: (l) => lines.push(l) }, work([{ ...r }]));
    assert.equal(b.rows[0].outcome, "replaced");
    assertNoHash(db, a, lines);
    assertNoHash(db, b, lines);
  });

  it("redactHashes replaces any SHA-256 in text", () => {
    assert.equal(redactHashes(`x ${sha("a")} y`), "x [hash] y");
  });

  it("the ledger key names the list, op and cursors (or the replace session), never a hash", () => {
    const src = readFileSync("lib/customer-lists/sync.ts", "utf8");
    assert.match(src, /\{ audience_id: listId, op, since: since \?\? null, next: p\.cursor, batch: i, rows: batch\.data\.length \}/);
    assert.match(src, /\{ audience_id: listId, op: "replace", session_id: sessionId, batch_seq: i \+ 1, of: batches\.length, rows: batch\.data\.length \}/);
  });

  it("the live writer never logs and never reads invalid_entry_samples", () => {
    const src = readFileSync("lib/customer-lists/graph-live.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(src, /console\./);
    assert.doesNotMatch(src, /graphPostWithToken/);
    assert.doesNotMatch(src.replace(/^.*invalid_entry_samples.*$/gm, (l) => (l.trim().startsWith("//") ? "" : l)), /invalid_entry_samples/);
    assert.match(src, /usersreplace/);
  });
});

describe("CIRQLIN's hashed endpoint", () => {
  it("404 is not_linked (an unknown tag), 501 not_available, no secret not_configured", async () => {
    const status = (n: number) => (async () => new Response("x", { status: n })) as typeof fetch;
    assert.deepEqual(await cirqlinHashedReader({ secret: "s", fetchImpl: status(404) })({ tag: "t", scope: "show", since: null }), { ok: false, reason: "not_linked", status: 404 });
    assert.deepEqual(await cirqlinHashedReader({ secret: "s", fetchImpl: status(501) })({ tag: "t", scope: "show", since: null }), { ok: false, reason: "not_available", status: 501 });
    assert.deepEqual(await cirqlinHashedReader({ env: {}, fetchImpl: status(200) })({ tag: "t", scope: "show", since: null }), { ok: false, reason: "not_configured" });
  });

  it("the bearer is CIRQLIN_PARTNER_HASHES_SECRET, never CIRQLIN_PARTNER_READ_SECRET, and never in a result", async () => {
    let auth: string | null = null;
    const fetchOk = (async (_url: string, init: RequestInit) => {
      auth = new Headers(init.headers).get("authorization");
      return new Response(JSON.stringify({ cursor: "c", has_more: false, added: [], removed: [], counts: { consented_show: 0, consented_promoter: 0, not_consented: 0 } }), { status: 200 });
    }) as unknown as typeof fetch;
    assert.deepEqual(await cirqlinHashedReader({ env: { CIRQLIN_PARTNER_READ_SECRET: "read-secret" }, fetchImpl: fetchOk })({ tag: "t", scope: "show", since: null }), { ok: false, reason: "not_configured" });
    const res = await cirqlinHashedReader({ env: { CIRQLIN_PARTNER_HASHES_SECRET: "hashes-secret", CIRQLIN_PARTNER_READ_SECRET: "read-secret" }, fetchImpl: fetchOk })({ tag: "t", scope: "show", since: null });
    assert.ok(res.ok);
    assert.equal(auth, "Bearer hashes-secret");
    assert.doesNotMatch(JSON.stringify(res), /secret/);
  });

  it("sends crm_base_tag, scope, since and limit (at most 10,000); parses the contract's shape", async () => {
    const seen: string[] = [];
    const body = { cursor: "c9", has_more: true, added: [{ em: sha("a@b.c") }, { ph: sha("447000") }], removed: [], counts: { consented_show: 2, consented_promoter: 5, not_consented: 1 } };
    const fetchOk = (async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const reader = cirqlinHashedReader({ secret: "s3", base: "https://cirqlin.test", fetchImpl: fetchOk });
    const res = await reader({ tag: "CQ-x", scope: "show", since: "c8" });
    await reader({ tag: "CQ-x", scope: "promoter", since: null, limit: 50_000 });
    assert.equal(seen[0], "https://cirqlin.test/api/partner/signups/hashed?crm_base_tag=CQ-x&scope=show&since=c8&limit=10000");
    assert.equal(seen[1], "https://cirqlin.test/api/partner/signups/hashed?crm_base_tag=CQ-x&scope=promoter&limit=10000");
    assert.ok(res.ok);
    if (res.ok) {
      assert.equal(res.page.cursor, "c9");
      assert.equal(res.page.added.length, 2);
      assert.equal(res.page.hasMore, true);
      assert.deepEqual(res.page.counts, { consented_show: 2, consented_promoter: 5, not_consented: 1 });
    }
  });

  it("a non-hex entry fails the whole page; has_more decides paging", () => {
    assert.equal(parseHashedPage({ cursor: "c", has_more: false, added: [{ em: "fan@example.com" }], removed: [] }), null);
    assert.equal(parseHashedPage({ cursor: "c", has_more: false, added: entries(0, 10_000), removed: [] })?.hasMore, false);
    assert.equal(parseHashedPage({ cursor: "c", has_more: true, added: [], removed: [] })?.hasMore, true);
  });

  it("Meta rows: CIRQLIN's hashes as they are, [EMAIL_SHA256, PHONE_SHA256], '' for a missing key", () => {
    const [b] = usersBatches([{ em: sha("a") }, { ph: sha("1") }]);
    assert.deepEqual(b.data, [[sha("a"), ""], ["", sha("1")]]);
  });
});

describe("migration 267", () => {
  const sql = readFileSync("supabase/migrations/267_customer_list_syncs.sql", "utf8");
  const kindsIn = (text: string) => [...text.slice(text.indexOf("add constraint meta_write_idempotency_op_kind_check")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  it("adds both kinds, keeps every kind live on prod (read 24 Nov), and re-adds the same list as 257", () => {
    const listed = kindsIn(sql);
    const live = ["campaign_create", "adset_create", "ad_create", "creative_upload", "adset_targeting_update", "adset_destination_update", "refresh_creative_create", "refresh_ad_create", "ad_status_update", "adset_status_update", "refresh_adset_budget_update", "refresh_adset_create", "refresh_custom_conversion_create", "refresh_campaign_create", "refresh_campaign_lifetime_budget_update", "refresh_campaign_status_update", "retargeting_audience_rule_update", "retargeting_study_create", "retargeting_study_end", "adset_end_time_update"];
    for (const kind of [...live, "customer_list_create", "customer_list_users"]) assert.ok(listed.includes(kind), kind);
    assert.equal(listed.length, 22);
    assert.ok(sql.indexOf("drop constraint if exists meta_write_idempotency_op_kind_check") < sql.indexOf("add constraint meta_write_idempotency_op_kind_check"));
    const in257 = kindsIn(readFileSync("supabase/migrations/257_retargeting_audience_parts.sql", "utf8"));
    assert.deepEqual([...listed].sort(), [...in257].sort(), "257 and 267 re-add the same kinds, so either order is safe");
  });

  it("customer_list_syncs: show lists only, the replace columns, unique (event, kind, list), service role only", () => {
    for (const col of ["event_id", "kind", "meta_audience_id", "ad_account_id", "enabled", "cursor", "sent_total", "removed_total", "last_sent_at", "last_replaced_at", "last_replace_count", "last_error", "created_at", "updated_at"]) assert.match(sql, new RegExp(`\\n  ${col} `), col);
    assert.match(sql, /check \(kind in \('show'\)\)/);
    assert.doesNotMatch(sql, /'genre'/);
    assert.match(sql, /enabled\s+boolean\s+not null default false/);
    assert.match(sql, /unique nulls not distinct \(event_id, kind, meta_audience_id\)/);
    assert.match(sql, /enable row level security/);
    assert.doesNotMatch(sql, /create policy/i);
    assert.doesNotMatch(sql, /audience_template_items/i, "266's template items need no change");
  });
});
