/**
 * plan_retargeting timed out from the connector on prod (Matas, 27 Nov): every
 * outside read ≤ its limit, a budget per show, one for the whole read, and a
 * "not read in time" line instead of a hang. Reads here never resolve; each
 * test checks it stops at its limit, the read answers within its budget, and
 * one slow show holds up no other. Also: the connector loads only its shows'
 * ad-days, and they're the same rows the full load gives those shows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { boundGraph, runPool, TimedOut, within, type ReadLimits } from "../limits.ts";
import { codePattern, launchedIdsFor, loadShowInsights } from "../show-insights.ts";
import { runRetargetingRead } from "../runner.ts";
import { rowsForEvent } from "../../onsale-refresh/load.ts";
import type { AdContextIndex } from "../../learning/ad-facts.ts";
import type { RefreshGraph } from "../../onsale-refresh/purchase-read.ts";
import { fakeDb } from "../../mcp/__tests__/fake-db.ts";
import { TIME_WORDS } from "../../mcp/retargeting/time-words.ts";
import { AUD_WORDS } from "../../mcp/audiences/words.ts";

const never = <T,>(): Promise<T> => new Promise<T>(() => {});
const elapsed = async <T,>(run: () => Promise<T>): Promise<{ value: T; ms: number }> => {
  const from = Date.now();
  const value = await run();
  return { value, ms: Date.now() - from };
};

test("within: a read that never resolves stops at its limit, as TimedOut", async () => {
  const { value, ms } = await elapsed(() => within("never", 40, () => never<number>()).catch((err) => err));
  assert.ok(value instanceof TimedOut);
  assert.ok(ms >= 35 && ms < 200, `${ms} ms`);
  // The outer signal stops it sooner.
  const outer = new AbortController();
  setTimeout(() => outer.abort(), 10);
  const sooner = await elapsed(() => within("never", 1_000, () => never<number>(), outer.signal).catch((err) => err));
  assert.ok(sooner.value instanceof TimedOut && sooner.ms < 200, `${sooner.ms} ms`);
  // The run is handed the joined signal, so a read that takes one stops for real.
  let seen: AbortSignal | null = null;
  await within("signal", 20, (signal) => ((seen = signal), never<number>())).catch(() => null);
  assert.equal((seen as AbortSignal | null)?.aborted, true);
});

test("boundGraph: each request stops at requestMs and says so; none starts after the budget", async () => {
  let calls = 0;
  let timeouts = 0;
  const graph: RefreshGraph = { graphGet: () => ((calls += 1), never()), multiGet: () => ((calls += 1), never()) };
  const budget = new AbortController();
  const bound = boundGraph(graph, { signal: budget.signal, requestMs: 30, onTimeout: () => (timeouts += 1) });
  const { value, ms } = await elapsed(() => bound.graphGet("/act_1/promote_pages", {}).catch((err) => err));
  assert.ok(value instanceof TimedOut && ms < 200, `${ms} ms`);
  assert.equal(timeouts, 1);
  budget.abort();
  await assert.rejects(bound.multiGet("/", { ids: "1" }), TimedOut);
  assert.equal(calls, 1, "no request after the budget ran out");
});

test("runPool: one slow item doesn't hold up the others; it's unfinished at its own budget", async () => {
  const total = new AbortController();
  let inFlight = 0;
  let most = 0;
  const { value, ms } = await elapsed(() =>
    runPool(["slow", "a", "b", "c"], { concurrency: 2, itemMs: 60, signal: total.signal }, async (item) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      try {
        if (item === "slow") await never();
        await new Promise((r) => setTimeout(r, 5));
        return item.toUpperCase();
      } finally {
        inFlight -= 1;
      }
    }),
  );
  assert.deepEqual(value, [{ ok: false, unfinished: "item" }, { ok: true, value: "A" }, { ok: true, value: "B" }, { ok: true, value: "C" }]);
  assert.ok(ms < 200, `${ms} ms`);
  assert.ok(most <= 2, `at most 2 at once (${most})`);
});

test("runPool: the whole budget stops the item running and starts no more", async () => {
  const total = new AbortController();
  setTimeout(() => total.abort(), 50);
  const { value, ms } = await elapsed(() => runPool(["a", "b", "c"], { concurrency: 1, itemMs: 1_000, signal: total.signal }, () => never<string>()));
  assert.deepEqual(value, [{ ok: false, unfinished: "total" }, { ok: false, unfinished: "total" }, { ok: false, unfinished: "total" }]);
  assert.ok(ms < 200, `${ms} ms`);
});

// ── The connector's ad-days: only its shows', and the same rows the full load gives them ──

const SHOW = "e1";
const OTHER = "e2";
const context: AdContextIndex = {
  launchedAds: new Map([
    ["ad-launched", { clientId: "c1", eventId: SHOW }],
    ["ad-other-but-named", { clientId: "c1", eventId: OTHER }],
  ]),
  launchedAdSets: new Map([["set-launched", { clientId: "c1", eventId: SHOW }]]),
  codedEvents: [
    { eventId: SHOW, clientId: "c1", eventCode: "NX26-RUDIMENTAL", adAccountId: "1" },
    { eventId: OTHER, clientId: "c1", eventCode: "NX26-OTHER", adAccountId: "1" },
  ],
} as unknown as AdContextIndex;
const ad = (meta_ad_id: string, over: Record<string, unknown>) => ({ meta_ad_id, meta_adset_id: null, meta_campaign_id: "9", ad_account_id: "act_1", date: "2026-11-20", ad_name: null, adset_name: null, campaign_name: "Prospecting", spend: 1, landing_page_views: 0, purchases: 0, actions: [], promoted_event: null, optimization_goal: null, video_plays_3s: 0, ...over });
const AD_DAYS = [
  ad("ad-launched", {}),
  ad("ad-in-set", { meta_adset_id: "set-launched" }),
  ad("ad-named", { campaign_name: "[NX26-RUDIMENTAL] Wider" }),
  ad("ad-en-dash", { campaign_name: "[NX26–RUDIMENTAL] Interests" }),
  ad("ad-other-but-named", { campaign_name: "[NX26-RUDIMENTAL] mislabelled" }),
  ad("ad-other", { campaign_name: "[NX26-OTHER] Broad" }),
  ad("ad-arm", { campaign_name: "NX26-OTHER · Retargeting · A/B · A" }),
];

test("codePattern matches every name holding [CODE], any dash, and launchedIdsFor gives the show's own ads and ad sets", () => {
  assert.equal(codePattern("NX26-RUDIMENTAL"), "%[NX26_RUDIMENTAL]%");
  assert.equal(codePattern(" 50%_OFF "), "%[50__OFF]%");
  assert.deepEqual(launchedIdsFor(context, new Set([SHOW])), { adIds: ["ad-launched"], adSetIds: ["set-launched"] });
});

test("loadShowInsights: one show reads only rows that can be its own, and gets exactly the full load's rows for it", async () => {
  const db = fakeDb({ ad_daily_insights: AD_DAYS.map((row) => ({ ...row })) });
  const scoped = await loadShowInsights(db as never, [{ id: SHOW, event_code: "NX26-RUDIMENTAL" }], context);
  const ids = scoped.rows.map((row) => row.meta_ad_id).sort();
  // The other show's own row isn't read at all; the mislabelled one is read (its name holds the code) and dropped by the join, as before.
  assert.ok(!ids.includes("ad-other"), ids.join(","));
  const full = { rows: AD_DAYS as never[], context };
  assert.deepEqual(rowsForEvent(scoped, SHOW).map((row) => row.meta_ad_id).sort(), rowsForEvent(full as never, SHOW).map((row) => row.meta_ad_id).sort());
  assert.deepEqual(rowsForEvent(scoped, SHOW).map((row) => row.meta_ad_id).sort(), ["ad-en-dash", "ad-in-set", "ad-launched", "ad-named"]);
  // RT17's layout-test arms are read for the pooled read, whichever show they're on.
  assert.ok(ids.includes("ad-arm"));
});

// ── The whole read, with Graph reads that never resolve ──

/** Every table the read touches answers empty unless given. */
function emptyTables(tables: Record<string, Record<string, unknown>[]>): Record<string, Record<string, unknown>[]> {
  return new Proxy(tables, { get: (t, key: string) => (t[key] ??= []) });
}
const show = (id: string, code: string, account: string) => ({ id, name: code, event_code: code, event_date: "2026-12-20", general_sale_at: "2026-10-01T09:00:00Z", presale_at: null, announcement_at: null, status: "on_sale", client_id: "c1", user_id: "u1", budget_marketing: null, drive_folder_id: null, signup_url: null, ticket_url: "https://www.skiddle.com/e/1", venue_country: "GB", venue_id: null, mailchimp_tag: null, meta_ad_account_id: account, meta_pixel_id: null, genre_family: null });
function readWith(graph: RefreshGraph, limits: ReadLimits) {
  const db = fakeDb(emptyTables({ events: [show("e1", "SLOW26-ONE", "act_slow"), show("e2", "FAST26-TWO", "act_fast"), show("e3", "FAST26-THREE", "act_fast")], clients: [{ id: "c1", name: "NX", status: "active", meta_ad_account_id: null, meta_pixel_id: null, default_page_ids: null, default_instagram_actor_id: null }] }));
  return runRetargetingRead({ env: {}, db: db as never, now: new Date("2026-11-27T12:00:00Z"), dryRun: true, force: true, connector: true, graph, limits });
}
/** The slow show's account never answers; every other read answers empty at once. */
const slowAccount: RefreshGraph = { graphGet: (path) => (path.startsWith("/act_slow") ? never() : Promise.resolve({ data: [] })), multiGet: () => Promise.resolve({}) };

test("the read: a show whose reads hang is unfinished at its budget, and the others are planned without waiting on it", async () => {
  const limits: ReadLimits = { requestMs: 2_000, frontMs: 2_000, showMs: 150, totalMs: 3_000, concurrency: 2 };
  const { value, ms } = await elapsed(() => readWith(slowAccount, limits));
  assert.ok("records" in value);
  assert.ok(ms < 1_000, `answered in ${ms} ms, well inside the 2 s request limit`);
  assert.deepEqual(value.unfinished, [{ eventId: "e1", eventCode: "SLOW26-ONE", why: "show" }]);
  assert.deepEqual(value.records.map((row) => row.eventCode).sort(), ["FAST26-THREE", "FAST26-TWO"]);
});

test("the read: each hanging request stops at requestMs, and the show is planned with its unread reads named", async () => {
  const limits: ReadLimits = { requestMs: 40, frontMs: 1_000, showMs: 1_000, totalMs: 3_000, concurrency: 3 };
  const { value, ms } = await elapsed(() => readWith(slowAccount, limits));
  assert.ok("records" in value);
  assert.ok(ms < 800, `${ms} ms`);
  assert.deepEqual(value.unfinished, []);
  const slow = value.records.find((row) => row.eventCode === "SLOW26-ONE")!;
  // The account's pixel and its Pages are the reads that hung; the plan is made without them.
  assert.deepEqual(slow.notRead, ["pixel", "pages"]);
  for (const row of value.records.filter((r) => r.eventCode !== "SLOW26-ONE")) assert.equal(row.notRead, undefined);
});

test("the read: the whole budget answers on time, every show left unfinished saying so", async () => {
  const hangs: RefreshGraph = { graphGet: () => never(), multiGet: () => never() };
  const limits: ReadLimits = { requestMs: 5_000, frontMs: 5_000, showMs: 5_000, totalMs: 120, concurrency: 1 };
  const { value, ms } = await elapsed(() => readWith(hangs, limits));
  assert.ok("records" in value);
  assert.ok(ms < 600, `${ms} ms`);
  assert.deepEqual(value.records, []);
  assert.deepEqual(value.unfinished?.map((row) => row.why), ["total", "total", "total"]);
});

test("the 08:00 read passes no limits: no unfinished list, no not-read names", async () => {
  const quick: RefreshGraph = { graphGet: () => Promise.resolve({ data: [] }), multiGet: () => Promise.resolve({}) };
  const db = fakeDb(emptyTables({ events: [show("e2", "FAST26-TWO", "act_fast")], clients: [{ id: "c1", name: "NX", status: "active" }] }));
  const value = await runRetargetingRead({ env: {}, db: db as never, now: new Date("2026-11-27T12:00:00Z"), dryRun: true, force: true, graph: quick });
  assert.ok("records" in value);
  assert.equal(value.unfinished, undefined);
  assert.equal(value.notRead, undefined);
  assert.equal(value.records.length, 1);
});

test("the 'not read in time' line is #1405's ruled line, word for word", () => {
  const ruled = AUD_WORDS.notRead("pixel").replace("the pixel and its events", "{source}");
  assert.equal(TIME_WORDS.notRead(["pages"]), ruled.replace("{source}", "the venue, promoter and lineup Pages"));
  assert.equal(TIME_WORDS.notRead(["pixel", "pages", "hosts"]), "Not read in time, so not shown: the ad account’s pixel, the venue, promoter and lineup Pages and the pixel’s sites. Try again.");
});
