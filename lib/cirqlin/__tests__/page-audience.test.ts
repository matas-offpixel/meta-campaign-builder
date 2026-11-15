import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyPageAudienceResponse,
  fetchCirqlinPageAudience,
  pageAudienceUrl,
  parsePageAudience,
} from "../page-audience/client.ts";
import { latestPageAudienceRows, offersWhatsapp, pageAudienceForClient, pageAudienceForEvents, pageAudienceForShow } from "../page-audience/read.ts";
import {
  CIRQLIN_PARTNER_BUCKET,
  checkSignups,
  isCirqlinAudienceIngestEnabled,
  loadPageAudienceTargets,
  orderTargets,
  runPageAudienceStep,
  storedSignupsTotal,
  type PageAudienceTarget,
} from "../page-audience/step.ts";

const P1 = "00000000-0000-4000-8000-0000000000a1";
const P2 = "00000000-0000-4000-8000-0000000000a2";
const P3 = "00000000-0000-4000-8000-0000000000a3";
const P4 = "00000000-0000-4000-8000-0000000000a4";
const P5 = "00000000-0000-4000-8000-0000000000a5";
const UMB = "00000000-0000-4000-8000-0000000000ff";

/** Shaped exactly like cirqlin #631's 200 body. */
function body(pageId: string, over: Record<string, unknown> = {}) {
  return {
    page_id: pageId,
    signups: 404,
    geography: {
      cities: [
        { name: "Newcastle upon Tyne", region: "England", country: "GB", signups: 251 },
        { name: "Sunderland", region: "England", country: "GB", signups: 38 },
      ],
      everywhere_else: 97,
      couldnt_tell: 18,
    },
    consent: { marketing: 371, channels_offered: ["email", "whatsapp"] },
    whatsapp_with_phone: 302,
    partner_opt_in: 120,
    community_joined: 88,
    community_link_clicks: 140,
    community_code_shared: false,
    daily_timezone: "Europe/London",
    ...over,
  };
}

function respond(status: number, payload: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
}

/** Answers per page id; records every URL asked. */
function partner(answers: Record<string, { status: number; body?: unknown }>) {
  const urls: string[] = [];
  const headers: Headers[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    headers.push(new Headers(init?.headers));
    const page = new URL(url).searchParams.get("page_id") ?? "";
    const a = answers[page] ?? { status: 200, body: body(page) };
    return new Response(JSON.stringify(a.body ?? { error: "x" }), { status: a.status });
  }) as typeof fetch;
  return { urls, headers, fetchImpl };
}

// ── a small fake of the supabase-js builder ────────────────────────────
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>, opts: { missing?: string[]; failUpsert?: boolean; throwOnFrom?: boolean } = {}) {
  const upserts: { table: string; rows: Row[]; onConflict?: string }[] = [];
  const orders: { table: string; columns: string[] }[] = [];
  const db = {
    upserts,
    orders,
    from(table: string) {
      if (opts.throwOnFrom) throw new Error(`unexpected read of ${table}`);
      const filters: ((r: Row) => boolean)[] = [];
      const order: { column: string; ascending: boolean }[] = [];
      let columns = "*";
      const run = (from?: number, to?: number) => {
        if (opts.missing?.includes(table)) return { data: null, error: { message: `relation "public.${table}" does not exist` } };
        let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        rows = [...rows].sort((a, b) => {
          for (const o of order) {
            const x = String(a[o.column] ?? "");
            const y = String(b[o.column] ?? "");
            if (x !== y) return (x < y ? -1 : 1) * (o.ascending ? 1 : -1);
          }
          return 0;
        });
        if (from != null && to != null) rows = rows.slice(from, to + 1);
        const pick = columns === "*" ? null : columns.split(",").map((c) => c.trim());
        return { data: rows.map((r) => (pick ? Object.fromEntries(pick.map((c) => [c, r[c] ?? null])) : { ...r })), error: null };
      };
      const q = {
        select(c: string) {
          columns = c;
          return q;
        },
        eq(c: string, v: unknown) {
          filters.push((r) => r[c] === v);
          return q;
        },
        neq(c: string, v: unknown) {
          filters.push((r) => r[c] !== v);
          return q;
        },
        in(c: string, vs: readonly unknown[]) {
          filters.push((r) => vs.includes(r[c]));
          return q;
        },
        not(c: string, op: string, v: unknown) {
          if (op === "is" && v === null) filters.push((r) => r[c] != null);
          return q;
        },
        order(column: string, o: { ascending: boolean }) {
          order.push({ column, ascending: o.ascending });
          return q;
        },
        range(from: number, to: number) {
          orders.push({ table, columns: order.map((o) => o.column) });
          return Promise.resolve(run(from, to));
        },
        limit(n: number) {
          const r = run();
          return Promise.resolve(r.error ? r : { data: r.data!.slice(0, n), error: null });
        },
        upsert(rows: Row[], o?: { onConflict?: string }) {
          upserts.push({ table, rows, onConflict: o?.onConflict });
          if (opts.failUpsert) return Promise.resolve({ error: { message: "boom" } });
          const keys = (o?.onConflict ?? "").split(",");
          const list = (tables[table] ??= []);
          for (const row of rows) {
            const i = list.findIndex((x) => keys.every((k) => x[k] === row[k]));
            if (i >= 0) list[i] = { ...list[i], ...row };
            else list.push({ ...row });
          }
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  };
  return db;
}
const asDb = (db: ReturnType<typeof fakeDb>) => db as unknown as Parameters<typeof runPageAudienceStep>[0]["db"];

const ON = { ENABLE_CIRQLIN_AUDIENCE_INGEST: "1" };
const SECRET = "test-secret";
const NOW = () => new Date("2026-11-15T23:57:00Z");
const quiet = () => {};

function snapshot(eventId: string, pageId: string | null, total: number, at = "2026-11-15T23:55:30Z", via = "page_id") {
  return { event_id: eventId, source: "cirqlin", day: "2026-11-15", signups_total: total, snapshot_at: at, raw_json: { via, page_id: pageId } };
}

const targets = (...pages: string[]): PageAudienceTarget[] => pages.map((p, i) => ({ eventId: `e${i + 1}`, pageId: p, isUmbrella: false }));

// ── client ─────────────────────────────────────────────────────────────
describe("page-audience client", () => {
  it("keeps only the listed keys, a planted key anywhere is dropped", () => {
    const planted = body(P1, { email: "x@example.com", sync: { mailchimp: 1 } });
    (planted.geography.cities[0] as Record<string, unknown>).lat = 54.97;
    (planted.consent as Record<string, unknown>).phone = "+44";
    const parsed = parsePageAudience(planted);
    assert.ok(parsed.ok);
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          walk(x);
        }
    };
    walk(parsed.audience);
    assert.deepEqual(
      [...keys].sort(),
      ["channels_offered", "cities", "community_code_shared", "community_joined", "community_link_clicks", "consent", "couldnt_tell", "country", "daily_timezone", "everywhere_else", "geography", "marketing", "name", "page_id", "partner_opt_in", "region", "signups", "whatsapp_with_phone"],
    );
  });

  it("rejects a body whose cities + everywhere_else + couldnt_tell isn't signups", () => {
    assert.deepEqual(parsePageAudience(body(P1, { signups: 405 })), { ok: false, reason: "geography_mismatch" });
    const r = classifyPageAudienceResponse(200, body(P1, { signups: 403 }), P1);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, "geography_mismatch");
  });

  it("rejects a wrong shape: a missing block, a string count, a negative, a bad page id, another page's body", () => {
    const noConsent: Record<string, unknown> = body(P1);
    delete noConsent.consent;
    assert.equal(parsePageAudience(noConsent).ok, false);
    assert.equal(parsePageAudience(body(P1, { partner_opt_in: "120" })).ok, false);
    assert.equal(parsePageAudience(body(P1, { community_joined: -1 })).ok, false);
    assert.equal(parsePageAudience(body(P1, { community_code_shared: "no" })).ok, false);
    assert.equal(parsePageAudience(body("not-a-uuid")).ok, false);
    const other = classifyPageAudienceResponse(200, body(P2), P1);
    assert.equal(!other.ok && other.reason, "bad_shape");
  });

  it("classifies 401, 404, 400, 429 and 500", () => {
    const reason = (s: number) => {
      const r = classifyPageAudienceResponse(s, { error: "x" }, P1);
      return r.ok ? "ok" : r.reason;
    };
    assert.deepEqual([401, 404, 400, 429, 500].map(reason), ["unauthorized", "no_page", "bad_request", "rate_limited", "read_failed"]);
  });

  it("asks all time by page id with the bearer, and makes no call without a secret", async () => {
    const p = partner({});
    const r = await fetchCirqlinPageAudience(P1.toUpperCase(), { fetchImpl: p.fetchImpl, secret: SECRET, base: "https://cirqlin.test/" });
    assert.ok(r.ok && r.called);
    assert.equal(p.urls[0], `https://cirqlin.test/api/partner/page-audience?page_id=${P1}`);
    assert.equal(p.headers[0]!.get("authorization"), `Bearer ${SECRET}`);
    assert.equal(pageAudienceUrl("https://x.test", P1, { from: "2026-09-01", to: "2026-09-30" }), `https://x.test/api/partner/page-audience?page_id=${P1}&from=2026-09-01&to=2026-09-30`);

    const none = await fetchCirqlinPageAudience(P1, { fetchImpl: p.fetchImpl, secret: "", base: "https://cirqlin.test" });
    assert.deepEqual(none, { ok: false, reason: "not_configured", called: false });
    assert.equal(p.urls.length, 1);
  });

  it("a network failure is read_failed and counts as a call", async () => {
    const r = await fetchCirqlinPageAudience(P1, { fetchImpl: (async () => { throw new Error("socket"); }) as typeof fetch, secret: SECRET });
    assert.deepEqual(r, { ok: false, reason: "read_failed", called: true });
    const bad = await fetchCirqlinPageAudience(P1, { fetchImpl: respond(200, "not json"), secret: SECRET });
    assert.equal(!bad.ok && bad.reason, "bad_shape");
  });
});

// ── self-check ─────────────────────────────────────────────────────────
describe("signups self-check", () => {
  it("ok, mismatch with both numbers, unchecked", () => {
    assert.deepEqual(checkSignups(404, { total: 404, at: "t" }), { status: "ok", stored: 404, storedAt: "t" });
    assert.deepEqual(checkSignups(404, { total: 402, at: "t" }), { status: "mismatch", stored: 402, storedAt: "t" });
    assert.deepEqual(checkSignups(404, null), { status: "unchecked", stored: null, storedAt: null });
  });

  it("reads the stored total only from this page's page-id snapshot, the newest one", async () => {
    const db = fakeDb({
      signup_source_snapshots: [
        snapshot("e1", P1, 400, "2026-11-14T23:55:30Z"),
        snapshot("e1", P1, 404),
        { ...snapshot("e1", P1, 0, "2026-11-16T00:00:00Z"), day: "1970-01-01" },
        snapshot("e2", null, 999, undefined, "tag"),
        snapshot("e3", P2, 10),
      ],
    });
    assert.deepEqual(await storedSignupsTotal(asDb(db), "e1", P1), { total: 404, at: "2026-11-15T23:55:30Z" });
    assert.equal(await storedSignupsTotal(asDb(db), "e2", P1), null, "a tag read is a different number");
    assert.equal(await storedSignupsTotal(asDb(db), "e3", P1), null, "another page's total");
    assert.equal(await storedSignupsTotal(asDb(db), "e9", P1), null);
  });
});

// ── the step ───────────────────────────────────────────────────────────
describe("page-audience step", () => {
  it("is off unless ENABLE_CIRQLIN_AUDIENCE_INGEST is exactly \"1\"; off makes no call and no read", async () => {
    for (const v of [undefined, "", "0", "true", " 1", "1 "]) assert.equal(isCirqlinAudienceIngestEnabled({ ENABLE_CIRQLIN_AUDIENCE_INGEST: v }), false);
    assert.equal(isCirqlinAudienceIngestEnabled(ON), true);
    const p = partner({});
    const r = await runPageAudienceStep({ env: {}, db: asDb(fakeDb({}, { throwOnFrom: true })), signupsPassCalls: 0, fetchImpl: p.fetchImpl, secret: SECRET });
    assert.equal(r.enabled, false);
    assert.equal(r.calls, 0);
    assert.equal(p.urls.length, 0);
  });

  it("stays inside the bucket left after the signups pass and reports the pages it skipped", async () => {
    const p = partner({});
    const db = fakeDb({});
    const r = await runPageAudienceStep({ env: ON, db: asDb(db), signupsPassCalls: CIRQLIN_PARTNER_BUCKET - 2, targets: targets(P1, P2, P3, P4, P5), fetchImpl: p.fetchImpl, secret: SECRET, now: NOW, log: quiet });
    assert.equal(r.calls, 2);
    assert.equal(p.urls.length, 2);
    assert.equal(r.skippedOnBucket, 3);
    assert.deepEqual(r.bucket, { size: 60, signupsPassCalls: 58, left: 2 });
    assert.equal(r.rowsWritten, 2);

    const spent = partner({});
    const r2 = await runPageAudienceStep({ env: ON, db: asDb(fakeDb({})), signupsPassCalls: 64, targets: targets(P1, P2), fetchImpl: spent.fetchImpl, secret: SECRET, log: quiet });
    assert.equal(spent.urls.length, 0);
    assert.equal(r2.skippedOnBucket, 2);
    assert.equal(r2.bucket.left, 0);
  });

  it("stops on a 429 and reports it", async () => {
    const p = partner({ [P2]: { status: 429, body: { error: "rate_limited", retryAfterSeconds: 600 } } });
    const r = await runPageAudienceStep({ env: ON, db: asDb(fakeDb({})), signupsPassCalls: 0, targets: targets(P1, P2, P3, P4), fetchImpl: p.fetchImpl, secret: SECRET, now: NOW, log: quiet });
    assert.equal(r.rateLimited, true);
    assert.equal(r.ok, false);
    assert.equal(r.calls, 2);
    assert.equal(r.skippedOnBucket, 2);
    assert.deepEqual(r.failures, [{ pageId: P2, eventId: "e2", reason: "rate_limited", status: 429 }]);
    assert.equal(r.rowsWritten, 1);
  });

  it("a 401 or 404 skips that page, reports it, and the rest are still read", async () => {
    const p = partner({ [P1]: { status: 401 }, [P2]: { status: 404, body: { error: "no_page" } }, [P3]: { status: 200, body: body(P3, { signups: 1 }) } });
    const db = fakeDb({});
    const r = await runPageAudienceStep({ env: ON, db: asDb(db), signupsPassCalls: 0, targets: targets(P1, P2, P3, P4), fetchImpl: p.fetchImpl, secret: SECRET, now: NOW, log: quiet });
    assert.equal(r.calls, 4);
    assert.deepEqual(r.failures.map((f) => [f.pageId, f.reason]), [[P1, "unauthorized"], [P2, "no_page"], [P3, "geography_mismatch"]]);
    assert.equal(r.rowsWritten, 1);
    assert.deepEqual(db.upserts.map((u) => u.rows[0]!.page_id), [P4]);
  });

  it("no secret: one report, no call", async () => {
    const p = partner({});
    const r = await runPageAudienceStep({ env: ON, db: asDb(fakeDb({})), signupsPassCalls: 0, targets: targets(P1, P2), fetchImpl: p.fetchImpl, secret: "", log: quiet });
    assert.equal(r.notConfigured, true);
    assert.equal(r.calls, 0);
    assert.equal(p.urls.length, 0);
  });

  it("stores the self-check: ok, mismatch with both numbers (logged, never corrected), unchecked", async () => {
    const p = partner({});
    const db = fakeDb({ signup_source_snapshots: [snapshot("e1", P1, 404), snapshot("e2", P2, 401)] });
    const lines: string[] = [];
    const r = await runPageAudienceStep({ env: ON, db: asDb(db), signupsPassCalls: 10, targets: targets(P1, P2, P3), fetchImpl: p.fetchImpl, secret: SECRET, now: NOW, log: (l) => lines.push(l) });
    assert.deepEqual(r.checks, { ok: 1, mismatch: 1, unchecked: 1 });
    assert.deepEqual(r.mismatches, [{ pageId: P2, eventId: "e2", signups: 404, stored: 401 }]);
    assert.ok(lines.some((l) => l.includes("signups_check=mismatch") && l.includes("page_audience=404") && l.includes("signups_stored=401")));
    assert.ok(lines.every((l) => !l.includes(SECRET)));
    const rows = Object.fromEntries(db.upserts.map((u) => [u.rows[0]!.page_id, u.rows[0]!]));
    assert.equal(rows[P1]!.signups_check, "ok");
    assert.equal(rows[P2]!.signups_check, "mismatch");
    assert.equal(rows[P2]!.signups, 404, "the page-audience number is stored as read");
    assert.equal(rows[P2]!.signups_stored, 401);
    assert.equal(rows[P3]!.signups_check, "unchecked");
    assert.equal(rows[P3]!.signups_stored, null);
    assert.equal(db.upserts.filter((u) => u.table === "signup_source_snapshots").length, 0, "the stored total is never touched");
  });

  it("writes one row per page per fetch day with every figure, the umbrella flagged as its own row", async () => {
    const p = partner({});
    const db = fakeDb({});
    await runPageAudienceStep({
      env: ON,
      db: asDb(db),
      signupsPassCalls: 0,
      targets: [{ eventId: "show", pageId: P1, isUmbrella: false }, { eventId: "umbrella", pageId: UMB, isUmbrella: true }],
      fetchImpl: p.fetchImpl,
      secret: SECRET,
      now: NOW,
      log: quiet,
    });
    assert.ok(db.upserts.every((u) => u.onConflict === "page_id,fetch_day"));
    const show = db.upserts.find((u) => u.rows[0]!.page_id === P1)!.rows[0]!;
    assert.deepEqual(show, {
      page_id: P1,
      fetch_day: "2026-11-15",
      event_id: "show",
      is_umbrella: false,
      signups: 404,
      geo_cities: body(P1).geography.cities,
      geo_everywhere_else: 97,
      geo_couldnt_tell: 18,
      consent_marketing: 371,
      channels_offered: ["email", "whatsapp"],
      community_joined: 88,
      community_link_clicks: 140,
      community_code_shared: false,
      whatsapp_with_phone: 302,
      partner_opt_in: 120,
      daily_timezone: "Europe/London",
      signups_check: "unchecked",
      signups_stored: null,
      signups_stored_at: null,
      fetched_at: "2026-11-15T23:57:00.000Z",
    });
    assert.equal(db.upserts.find((u) => u.rows[0]!.page_id === UMB)!.rows[0]!.is_umbrella, true);
    assert.ok(Object.values(show).every((v) => v !== undefined));
  });

  it("reads the pages fetched longest ago first", async () => {
    const lastDay = new Map([[P1, "2026-11-14"], [P2, "2026-11-10"]]);
    assert.deepEqual(orderTargets(targets(P1, P2, P3), lastDay).map((t) => t.pageId), [P3, P2, P1]);
    const p = partner({});
    const db = fakeDb({ cirqlin_page_audience: [{ page_id: P1, fetch_day: "2026-11-14" }, { page_id: P2, fetch_day: "2026-11-10" }] });
    await runPageAudienceStep({ env: ON, db: asDb(db), signupsPassCalls: 59, targets: targets(P1, P2, P3), fetchImpl: p.fetchImpl, secret: SECRET, now: NOW, log: quiet });
    assert.deepEqual(p.urls.map((u) => new URL(u).searchParams.get("page_id")), [P3]);
  });

  it("stops on the cron's time budget", async () => {
    const p = partner({});
    let n = 0;
    const r = await runPageAudienceStep({ env: ON, db: asDb(fakeDb({})), signupsPassCalls: 0, targets: targets(P1, P2, P3), fetchImpl: p.fetchImpl, secret: SECRET, overBudget: () => n++ >= 1, now: NOW, log: quiet });
    assert.equal(r.calls, 1);
    assert.equal(r.skippedOnTime, 2);
  });

  it("an upsert error is reported, not thrown", async () => {
    const r = await runPageAudienceStep({ env: ON, db: asDb(fakeDb({}, { failUpsert: true })), signupsPassCalls: 0, targets: targets(P1), fetchImpl: partner({}).fetchImpl, secret: SECRET, now: NOW, log: quiet });
    assert.deepEqual(r.failures, [{ pageId: P1, eventId: "e1", reason: "upsert" }]);
    assert.equal(r.ok, false);
  });

  it("can't read the pages: nothing is fetched", async () => {
    const p = partner({});
    const db = fakeDb({ clients: [] }, {});
    const broken = { from: (t: string) => (t === "events" ? { select: () => { throw new Error("events down"); } } : db.from(t)) };
    const r = await runPageAudienceStep({ env: ON, db: broken as never, signupsPassCalls: 0, fetchImpl: p.fetchImpl, secret: SECRET, log: quiet });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /events down/);
    assert.equal(p.urls.length, 0);
  });

  it("targets: linked pages only, archived clients out, one target per page, paged by id", async () => {
    const db = fakeDb({
      events: [
        { id: "e3", client_id: "c1", cirqlin_page_id: P1, is_umbrella: false },
        { id: "e1", client_id: "c1", cirqlin_page_id: P1.toUpperCase(), is_umbrella: false },
        { id: "e2", client_id: "gone", cirqlin_page_id: P2, is_umbrella: false },
        { id: "e4", client_id: null, cirqlin_page_id: UMB, is_umbrella: true },
        { id: "e5", client_id: "c1", cirqlin_page_id: null, is_umbrella: false },
      ],
    });
    const t = await loadPageAudienceTargets(asDb(db), new Set(["gone"]));
    assert.deepEqual(t, [
      { eventId: "e1", pageId: P1, isUmbrella: false },
      { eventId: "e4", pageId: UMB, isUmbrella: true },
    ]);
    assert.deepEqual(db.orders.find((o) => o.table === "events")!.columns, ["id"]);
  });
});

// ── read helpers ───────────────────────────────────────────────────────
function stored(pageId: string, day: string, eventId: string, signups: number, isUmbrella = false) {
  return {
    page_id: pageId,
    fetch_day: day,
    event_id: eventId,
    is_umbrella: isUmbrella,
    signups,
    geo_cities: [{ name: "Sunderland", region: "England", country: "GB", signups: 10 }, { name: "Newcastle upon Tyne", region: "England", country: "GB", signups: signups - 10 }],
    geo_everywhere_else: 0,
    geo_couldnt_tell: 0,
    consent_marketing: 5,
    channels_offered: ["email"],
    community_joined: 1,
    community_link_clicks: 2,
    community_code_shared: true,
    whatsapp_with_phone: 0,
    partner_opt_in: 3,
    daily_timezone: "Europe/London",
    signups_check: "ok",
    signups_stored: signups,
    signups_stored_at: `${day}T23:55:30Z`,
    fetched_at: `${day}T23:57:00Z`,
  };
}

describe("page-audience read helpers", () => {
  const events = [
    { id: "lock", client_id: "nx", cirqlin_page_id: P1, is_umbrella: false },
    { id: "schak", client_id: "nx", cirqlin_page_id: P2, is_umbrella: false },
    { id: "global", client_id: "nx", cirqlin_page_id: UMB, is_umbrella: true },
    { id: "other", client_id: "elsewhere", cirqlin_page_id: P3, is_umbrella: false },
  ];
  const rows = [
    stored(P1, "2026-11-13", "lock", 380),
    stored(P1, "2026-11-15", "lock", 404),
    stored(P1, "2026-11-14", "lock", 400),
    stored(P2, "2026-11-15", "schak", 1792),
    stored(UMB, "2026-11-15", "global", 2210, true),
    stored(P3, "2026-11-15", "other", 50),
  ];

  it("the client's shows each get their page's latest row; the umbrella is apart and never in shows", async () => {
    const db = fakeDb({ events, cirqlin_page_audience: rows });
    const view = await pageAudienceForClient(asDb(db), "nx");
    assert.deepEqual([...view.shows.keys()].sort(), ["lock", "schak"]);
    assert.equal(view.shows.get("lock")!.signups, 404);
    assert.equal(view.shows.get("lock")!.fetchDay, "2026-11-15");
    assert.equal(view.shows.has("global"), false);
    assert.equal(view.umbrella!.eventId, "global");
    assert.equal(view.umbrella!.signups, 2210);
    assert.equal(view.umbrella!.isUmbrella, true);
    assert.deepEqual(view.shows.get("lock")!.geography.cities.map((c) => c.name), ["Newcastle upon Tyne", "Sunderland"]);
    assert.deepEqual(view.shows.get("lock")!.signupsCheck, { status: "ok", stored: 404, storedAt: "2026-11-15T23:55:30Z" });
  });

  it("offersWhatsapp comes from channelsOffered, as CIRQLIN decides it", async () => {
    assert.equal(offersWhatsapp(["email", "whatsapp"]), true);
    assert.equal(offersWhatsapp(["email", "sms"]), false);
    assert.equal(offersWhatsapp([]), false);
    assert.equal(offersWhatsapp(null), false);
    const wa = { ...stored(P1, "2026-11-15", "lock", 404), channels_offered: ["email", "whatsapp"] };
    const db = fakeDb({ events, cirqlin_page_audience: [wa, stored(P2, "2026-11-15", "schak", 1792)] });
    const view = await pageAudienceForClient(asDb(db), "nx");
    assert.equal(view.shows.get("lock")!.offersWhatsapp, true);
    assert.equal(view.shows.get("schak")!.offersWhatsapp, false);
  });

  it("by events and by show; a show with no row is absent", async () => {
    const db = fakeDb({ events, cirqlin_page_audience: rows.filter((r) => r.page_id !== P2) });
    const view = await pageAudienceForEvents(asDb(db), ["lock", "schak", "global"]);
    assert.deepEqual([...view.shows.keys()], ["lock"]);
    assert.deepEqual([...view.umbrellas.keys()], ["global"]);
    assert.equal((await pageAudienceForShow(asDb(db), "lock"))!.signups, 404);
    assert.equal(await pageAudienceForShow(asDb(db), "schak"), null);
    assert.equal((await pageAudienceForShow(asDb(db), "global"))!.isUmbrella, true);
  });

  it("follows today's link: a page moved to another show reads under that show", async () => {
    const moved = events.map((e) => (e.id === "lock" ? { ...e, cirqlin_page_id: null } : e.id === "schak" ? { ...e, cirqlin_page_id: P1 } : e));
    const view = await pageAudienceForClient(asDb(fakeDb({ events: moved, cirqlin_page_audience: rows })), "nx");
    assert.deepEqual([...view.shows.keys()], ["schak"]);
    assert.equal(view.shows.get("schak")!.pageId, P1);
  });

  it("before migration 247 is applied, every read is empty", async () => {
    const db = fakeDb({ events }, { missing: ["cirqlin_page_audience"] });
    const view = await pageAudienceForClient(asDb(db), "nx");
    assert.equal(view.shows.size, 0);
    assert.equal(view.umbrella, null);
    assert.equal((await latestPageAudienceRows(asDb(db), [P1])).size, 0);
  });
});
