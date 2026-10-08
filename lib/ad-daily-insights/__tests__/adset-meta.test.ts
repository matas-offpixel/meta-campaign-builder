import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { fakeDb, op, type FakeCall } from "../../launched-ads/__tests__/fake-db.ts";
import { createPromotedEventLookup, fetchAdSetMeta, readStoredPromotedEvents } from "../adset-meta.ts";
import { backfillAccounts, runObjectiveBackfill } from "../objective-backfill.ts";
import { runAdDailyInsights, upsertBatches } from "../runner.ts";

const ON = { ENABLE_AD_DAILY_INSIGHTS: "1" };
const WINDOW = { since: "2026-10-05", until: "2026-10-05" };

function adRow(adId: string, adsetId: string, objective: string, goal: string) {
  return { ad_id: adId, adset_id: adsetId, date_start: "2026-10-05", spend: "1", actions: [], objective, optimization_goal: goal };
}

const isUpsert = (c: FakeCall) => c.table === "ad_daily_insights" && !!op(c, "upsert");
const isStoredRead = (c: FakeCall) => c.table === "ad_daily_insights" && !!op(c, "select") && !op(c, "upsert");

function upserted(calls: FakeCall[]) {
  return calls.filter(isUpsert).flatMap((c) => op(c, "upsert")![0] as { meta_adset_id: string; promoted_event?: string }[]);
}

type StoredRow = Record<string, unknown> & { meta_ad_id: string; date: string };

/**
 * ad_daily_insights as PostgREST sees it. An upsert's columns are the union
 * of the batch's keys (what supabase-js sends as `columns=`); merge-duplicates
 * sets exactly those columns, NULL where a row lacks the key. The stored
 * read honours in / not null / order / limit.
 */
function pgStore(seed: StoredRow[], opts: { failStoredRead?: boolean } = {}) {
  const rows = new Map(seed.map((r) => [`${r.meta_ad_id}|${r.date}`, { ...r }]));
  const fake = fakeDb((call) => {
    if (call.table !== "ad_daily_insights") return { data: [], error: null };
    const up = op(call, "upsert");
    if (up) {
      const batch = up[0] as Record<string, unknown>[];
      const columns = [...new Set(batch.flatMap((r) => Object.keys(r)))];
      for (const r of batch) {
        const key = `${r.meta_ad_id}|${r.date}`;
        const target = rows.get(key) ?? ({} as StoredRow);
        for (const c of columns) target[c] = r[c] ?? null;
        rows.set(key, target);
      }
      return { error: null };
    }
    if (opts.failStoredRead) return { data: null, error: { message: "statement timeout" } };
    const ids = (op(call, "in")?.[1] ?? []) as string[];
    const limit = (op(call, "limit")?.[0] as number | undefined) ?? Infinity;
    const data = [...rows.values()]
      .filter((r) => ids.includes(r.meta_adset_id as string) && r.promoted_event != null)
      .sort((a, b) => String(a.meta_adset_id).localeCompare(String(b.meta_adset_id)))
      .slice(0, limit)
      .map((r) => ({ meta_adset_id: r.meta_adset_id, promoted_event: r.promoted_event }));
    return { data, error: null };
  });
  return { ...fake, rows };
}

describe("ad set promoted event in the nightly run", () => {
  it("reads stored events first and asks Meta only for unknown sales conversion ad sets; calls are counted", async () => {
    const { db, calls } = fakeDb((call) => {
      if (isStoredRead(call)) return { data: [{ meta_adset_id: "s-known", promoted_event: "PURCHASE" }], error: null };
      return { error: null };
    });
    const graph: { path: string; params: Record<string, string> }[] = [];
    const result = await runAdDailyInsights({
      env: ON,
      db,
      window: WINDOW,
      accounts: ["act_1"],
      graphGet: async (path, params) => {
        graph.push({ path, params });
        if (path === "/") return { "s-new": { id: "s-new", promoted_object: { custom_event_type: "COMPLETE_REGISTRATION" } } };
        return {
          data: [
            adRow("a1", "s-known", "OUTCOME_SALES", "OFFSITE_CONVERSIONS"),
            adRow("a2", "s-new", "OUTCOME_SALES", "OFFSITE_CONVERSIONS"),
            adRow("a3", "s-new", "OUTCOME_SALES", "OFFSITE_CONVERSIONS"),
            adRow("a4", "s-reach", "OUTCOME_AWARENESS", "REACH"),
          ],
        };
      },
    });
    assert.deepEqual(op(calls.find(isStoredRead)!, "in"), ["meta_adset_id", ["s-known", "s-new"]]);
    const batched = graph.filter((g) => g.path === "/");
    assert.equal(batched.length, 1);
    assert.deepEqual(batched[0].params, { ids: "s-new", fields: "promoted_object" });
    assert.equal(result.metaCalls, 2, "one insights call + one ad set batch");
    assert.equal(result.outcomes![0].calls, 2);
    assert.equal(result.outcomes![0].adsetCalls, 1);
    assert.deepEqual(
      Object.fromEntries(upserted(calls).map((r) => [r.meta_adset_id, r.promoted_event])),
      { "s-known": "PURCHASE", "s-new": "COMPLETE_REGISTRATION", "s-reach": undefined },
    );
    assert.equal("promoted_event" in upserted(calls).find((r) => r.meta_adset_id === "s-reach")!, false);
  });

  it("an ad set seen on an earlier account in the run is not read again; awareness-only runs cost nothing extra", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    let batches = 0;
    const result = await runAdDailyInsights({
      env: ON,
      db,
      window: WINDOW,
      accounts: ["act_1", "act_2", "act_3"],
      graphGet: async (path) => {
        if (path === "/") {
          batches++;
          return { s1: { promoted_object: { custom_event_type: "PURCHASE" } } };
        }
        if (path === "/act_3/insights") return { data: [adRow("a9", "s9", "OUTCOME_AWARENESS", "REACH")] };
        return { data: [adRow(`a-${path}`, "s1", "OUTCOME_SALES", "OFFSITE_CONVERSIONS")] };
      },
    });
    assert.equal(batches, 1);
    assert.equal(result.metaCalls, 4);
    assert.equal(calls.filter(isStoredRead).length, 1, "no stored read for an awareness-only span");
  });

  it("batches ≤50 ids a call", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `s${i}`);
    const sizes: number[] = [];
    const out = await fetchAdSetMeta(
      async (_path, params) => {
        sizes.push(params.ids.split(",").length);
        return {};
      },
      ids,
      "promoted_object",
    );
    assert.deepEqual(sizes, [50, 50, 20]);
    assert.equal(out.calls, 3);
  });

  it("a failed ad set read leaves promoted_event out of the upsert, still writes the rows, and stops asking for the run", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    let batches = 0;
    const result = await runAdDailyInsights({
      env: ON,
      db,
      window: WINDOW,
      accounts: ["act_1", "act_2"],
      graphGet: async (path) => {
        if (path === "/") {
          batches++;
          throw Object.assign(new Error("too many calls"), { code: 17 });
        }
        return { data: [adRow(`a-${path}`, path === "/act_1/insights" ? "s1" : "s2", "OUTCOME_SALES", "OFFSITE_CONVERSIONS")] };
      },
    });
    assert.equal(batches, 1);
    assert.equal(result.metaCalls, 3);
    assert.equal(result.outcomes![0].status, "ok");
    assert.equal(result.outcomes![0].adsetError, "too many calls");
    assert.deepEqual(upserted(calls).map((r) => "promoted_event" in r), [false, false]);
  });
});

describe("a stored promoted event is never overwritten with NULL", () => {
  const sales = (adId: string, adsetId: string) => adRow(adId, adsetId, "OUTCOME_SALES", "OFFSITE_CONVERSIONS");
  const stored = (adId: string, adsetId: string, extra: Record<string, unknown>): StoredRow => ({
    meta_ad_id: adId,
    meta_adset_id: adsetId,
    date: "2026-10-05",
    ...extra,
  });

  it("survives a run where Meta reads are stopped and the stored read fails", async () => {
    const store = pgStore([stored("a1", "s-buy", { promoted_event: "PURCHASE", campaign_objective: "OUTCOME_SALES" })], {
      failStoredRead: true,
    });
    let batches = 0;
    const result = await runAdDailyInsights({
      env: ON,
      db: store.db,
      window: WINDOW,
      accounts: ["act_1"],
      graphGet: async (path) => {
        if (path === "/") {
          batches++;
          throw Object.assign(new Error("too many calls"), { code: 17 });
        }
        return { data: [sales("a1", "s-buy")] };
      },
    });
    assert.equal(batches, 0, "an unreadable stored event is unknown: Meta is not asked");
    assert.match(result.outcomes![0].adsetError ?? "", /statement timeout/);
    assert.equal(store.rows.get("a1|2026-10-05")!.promoted_event, "PURCHASE");
  });

  it("survives Meta reads stopped mid-run", async () => {
    const store = pgStore([stored("a2", "s-reg", { promoted_event: "COMPLETE_REGISTRATION" })]);
    const known = createPromotedEventLookup(store.db, async () => {
      throw Object.assign(new Error("rate"), { code: 80004 });
    });
    await known.resolve(["s-new"]);
    const result = await runAdDailyInsights({
      env: ON,
      db: store.db,
      window: WINDOW,
      accounts: ["act_1", "act_2"],
      graphGet: async (path) => {
        if (path === "/") throw Object.assign(new Error("rate"), { code: 80004 });
        if (path === "/act_1/insights") return { data: [sales("a1", "s-new")] };
        return { data: [sales("a2", "s-reg")] };
      },
    });
    assert.equal(result.outcomes![0].adsetError, "rate");
    assert.equal(store.rows.get("a2|2026-10-05")!.promoted_event, "COMPLETE_REGISTRATION");
    assert.equal(store.rows.get("a1|2026-10-05")!.promoted_event ?? null, null);
  });

  it("survives a non-sales ad set's nightly upsert, in the same span as a sales row with an event", async () => {
    const store = pgStore([
      stored("a-reach", "s-reach", { promoted_event: "LEAD", campaign_objective: "OUTCOME_AWARENESS", optimization_goal: "REACH" }),
    ]);
    const { calls } = store;
    await runAdDailyInsights({
      env: ON,
      db: store.db,
      window: WINDOW,
      accounts: ["act_1"],
      graphGet: async (path) => {
        if (path === "/") return { "s-buy": { promoted_object: { custom_event_type: "PURCHASE" } } };
        return {
          data: [
            adRow("a-reach", "s-reach", "OUTCOME_AWARENESS", "REACH"),
            { ...sales("a-buy", "s-buy") },
            { ad_id: "a-bare", adset_id: "s-reach", date_start: "2026-10-05", spend: "1", actions: [] },
          ],
        };
      },
    });
    const reach = store.rows.get("a-reach|2026-10-05")!;
    assert.equal(reach.promoted_event, "LEAD");
    assert.equal(store.rows.get("a-buy|2026-10-05")!.promoted_event, "PURCHASE");
    const upserts = calls.filter(isUpsert).map((c) => Object.keys((op(c, "upsert")![0] as object[])[0]).sort().join(","));
    assert.equal(new Set(upserts).size, upserts.length, "one upsert per key set");
    assert.equal(upserts.length, 3, "with event / objective only / bare");
  });

  it("an upsert batch never mixes key sets", () => {
    const base = { ad_account_id: "act_1", date: "2026-10-05", fetched_at: "x" } as never;
    const row = (id: string, extra: object) => ({ ...(base as object), meta_ad_id: id, ...extra }) as never;
    const batches = upsertBatches([
      row("1", { promoted_event: "PURCHASE", campaign_objective: "OUTCOME_SALES" }),
      row("2", { campaign_objective: "OUTCOME_SALES" }),
      row("3", { promoted_event: "PURCHASE", campaign_objective: "OUTCOME_SALES" }),
      row("4", {}),
    ]);
    assert.deepEqual(
      batches.map((b) => b.map((r) => r.meta_ad_id)),
      [["1", "3"], ["2"], ["4"]],
    );
  });

  it("the stored read returns every ad set past 1000 rows, one row per ad set", async () => {
    const seed: StoredRow[] = [
      ...Array.from({ length: 1500 }, (_, i) => stored(`big-${i}`, "s-big", { promoted_event: "COMPLETE_REGISTRATION", date: `d${i}` })),
      stored("small", "s-small", { promoted_event: "PURCHASE" }),
    ];
    const store = pgStore(seed);
    const found = await readStoredPromotedEvents(store.db, ["s-big", "s-small", "s-none"]);
    assert.deepEqual(Object.fromEntries(found), { "s-big": "COMPLETE_REGISTRATION", "s-small": "PURCHASE" });
    assert.equal(store.calls.length, 2, "page 2 asks only for the ad sets page 1 did not find");
    assert.deepEqual(op(store.calls[1], "in"), ["meta_adset_id", ["s-small", "s-none"]]);
  });
});

describe("objective backfill", () => {
  const stored = [
    { meta_adset_id: "s-done", campaign_objective: "OUTCOME_SALES", optimization_goal: "OFFSITE_CONVERSIONS", promoted_event: "PURCHASE" },
    { meta_adset_id: "s-reach", campaign_objective: "OUTCOME_AWARENESS", optimization_goal: "REACH", promoted_event: null },
    { meta_adset_id: "s-pending", campaign_objective: "OUTCOME_SALES", optimization_goal: "OFFSITE_CONVERSIONS", promoted_event: null },
    { meta_adset_id: "s-old", campaign_objective: null, optimization_goal: null, promoted_event: null },
  ];
  const graphAnswer = {
    "s-pending": { optimization_goal: "OFFSITE_CONVERSIONS", promoted_object: { custom_event_type: "COMPLETE_REGISTRATION" }, campaign: { objective: "OUTCOME_SALES" } },
    "s-old": { optimization_goal: "REACH", campaign: { objective: "OUTCOME_AWARENESS" } },
  };

  for (const mode of ["plan", "fetch"] as const) {
    it(`${mode} makes zero writes${mode === "plan" ? " and zero Meta calls" : ""}`, async () => {
      const { db, calls } = fakeDb(() => ({ data: stored, error: null }));
      const graph: Record<string, string>[] = [];
      const result = await runObjectiveBackfill({
        db,
        mode,
        has187: true,
        accounts: ["act_1"],
        graphGet: async (_path, params) => {
          graph.push(params);
          return graphAnswer;
        },
      });
      assert.deepEqual(result.plan, [{ adAccountId: "act_1", adSetIds: ["s-old", "s-pending"], calls: 1 }]);
      assert.equal(result.plannedCalls, 1);
      for (const c of calls) {
        for (const write of ["update", "upsert", "insert", "delete"]) assert.equal(op(c, write), undefined, `${mode} ${write}`);
      }
      assert.equal(result.updated, 0);
      assert.equal(graph.length, mode === "plan" ? 0 : 1);
      if (mode === "fetch") {
        assert.deepEqual(graph[0], { ids: "s-old,s-pending", fields: "campaign{objective},optimization_goal,promoted_object" });
        assert.equal(result.found.get("s-pending")?.promotedEvent, "COMPLETE_REGISTRATION");
        assert.equal(result.found.get("s-old")?.campaignObjective, "OUTCOME_AWARENESS");
      }
    });
  }

  it("apply UPDATEs by meta_adset_id; before migration 187 every ad set counts and apply refuses", async () => {
    const { db, calls } = fakeDb(() => ({ data: stored, error: null }));
    const result = await runObjectiveBackfill({ db, mode: "apply", has187: true, accounts: ["act_1"], graphGet: async () => graphAnswer });
    const updates = calls.filter((c) => op(c, "update"));
    assert.deepEqual(
      updates.map((c) => c.ops.filter(([n]) => n === "eq").map(([, a]) => a)),
      [
        [["meta_adset_id", "s-old"], ["ad_account_id", "act_1"]],
        [["meta_adset_id", "s-pending"], ["ad_account_id", "act_1"]],
      ],
    );
    assert.deepEqual(op(updates[1], "update")![0], {
      campaign_objective: "OUTCOME_SALES",
      optimization_goal: "OFFSITE_CONVERSIONS",
      promoted_event: "COMPLETE_REGISTRATION",
    });
    assert.equal(result.updated, 2);

    const pre = await runObjectiveBackfill({
      db: fakeDb(() => ({ data: stored.map((r) => ({ meta_adset_id: r.meta_adset_id })), error: null })).db,
      mode: "plan",
      has187: false,
      accounts: ["act_1"],
      graphGet: async () => ({}),
    });
    assert.equal(pre.plan[0].adSetIds.length, 4);
    await assert.rejects(
      runObjectiveBackfill({ db, mode: "apply", has187: false, accounts: ["act_1"], graphGet: async () => ({}) }),
      /migration 187/,
    );
  });

  it("--account must be an active client's account; archived and unknown accounts are refused", async () => {
    const { db } = fakeDb((call) => {
      if (call.table === "clients" && op(call, "eq")) return { data: [{ id: "c-arch" }], error: null };
      if (call.table === "clients") {
        return { data: [{ id: "c-1", meta_ad_account_id: "act_111111" }, { id: "c-arch", meta_ad_account_id: "act_999999" }], error: null };
      }
      return { data: [], error: null };
    });
    assert.deepEqual(await backfillAccounts(db, null), ["act_111111"]);
    assert.deepEqual(await backfillAccounts(db, "act_111111"), ["act_111111"]);
    await assert.rejects(backfillAccounts(db, "act_999999"), /not an active client/);
    await assert.rejects(backfillAccounts(db, "act_404404"), /not an active client/);
  });

  it("a rate limit stops the run; a bad batch is skipped", async () => {
    const { db } = fakeDb(() => ({ data: stored, error: null }));
    let n = 0;
    const result = await runObjectiveBackfill({
      db,
      mode: "fetch",
      has187: true,
      accounts: ["act_1", "act_2"],
      graphGet: async () => {
        n++;
        throw Object.assign(new Error(n === 1 ? "unsupported get" : "rate"), { code: n === 1 ? 100 : 80004 });
      },
    });
    assert.equal(result.metaCalls, 2);
    assert.equal(result.failedBatches, 2);
    assert.equal(result.stopped, true);
  });
});

describe("migration 187", () => {
  const SQL = readFileSync("supabase/migrations/187_ad_daily_insights_objective.sql", "utf8");
  it("adds three nullable text columns with comments, idempotently", () => {
    for (const col of ["campaign_objective", "optimization_goal", "promoted_event"]) {
      assert.match(SQL, new RegExp(`add column if not exists ${col} text;`));
      assert.match(SQL, new RegExp(`comment on column ad_daily_insights\\.${col} is`));
    }
    assert.doesNotMatch(SQL, /not null/);
    assert.match(SQL, /notify pgrst, 'reload schema';\s*$/);
  });
});
