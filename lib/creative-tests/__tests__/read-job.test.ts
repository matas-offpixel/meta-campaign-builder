/**
 * The creative tests' daily read (read-job.ts) on a memory db and a fake Graph:
 * the killswitch, the 08:00 London hour, day 4 and day 8, extend vs stop, the
 * cap re-check, idempotent retries (never two extensions, never a second
 * pause, never a resume), the write gates, Meta errors, never a main
 * campaign's ad set, and archived clients.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { memoryDb } from "../../onsale-refresh/__tests__/memory-db.ts";
import { capLeftMinor, runCreativeTestsRead, type ReadGraph } from "../read-job.ts";

const MATAS = "matas";
const START = "2026-11-18T08:00:00.000Z";
/** 08:00 London (GMT) on a day of November. */
const morning = (day: number) => new Date(`2026-11-${String(day).padStart(2, "0")}T08:00:00Z`);
const WRITES = { ENABLE_CREATIVE_TESTS_READ: "1", CREATIVE_TESTS_READ_WRITES_ENABLED: "true", CREATIVE_TESTS_CREATE_ENABLED: "true", OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED: "true" };

type AdDayRow = { date: string; meta_ad_id: string; campaign_name: string; spend: number; landing_page_views: number; registrations: number; actions: unknown[] };
const ic = (n: number) => (n ? [{ action_type: "omni_initiated_checkout", value: String(n) }] : []);
const day = (date: string, ad: string, spend: number, checkouts = 0, campaign = "P26-BDAY · Tests"): AdDayRow => ({ date, meta_ad_id: ad, campaign_name: campaign, spend, landing_page_views: 0, registrations: 0, actions: ic(checkouts) });

/** The variants' days: payoff and earlier drops, spread over 18–21 Nov (and on to 25 Nov for day 8). */
function variantDays(to: number, payoff: [number, number], earlier: [number, number]): AdDayRow[] {
  const out: AdDayRow[] = [];
  const n = to - 18 + 1;
  for (let d = 18; d <= to; d += 1) {
    const date = `2026-11-${d}`;
    out.push(day(date, "ad-payoff", Math.round((payoff[0] / n) * 100) / 100, d === to ? payoff[1] : 0));
    out.push(day(date, "ad-earlier", Math.round((earlier[0] / n) * 100) / 100, d === to ? earlier[1] : 0));
  }
  return out;
}

/** The show's main campaign at £3.00 per checkout over the test's days. */
const showDays = async (_code: string, from: string, to: string) => {
  const rows: Record<string, unknown>[] = [];
  for (let d = Number(from.slice(8)); d <= Number(to.slice(8)); d += 1) rows.push(day(`2026-11-${d}`, `main-${d}`, 30, 10, "[P26-BDAY] Puzzle - On Sale"));
  return rows;
};

function seed(opts: { extensions?: number; evidence?: unknown; budget?: number | null; spend?: number; source?: string; days?: AdDayRow[]; archived?: boolean; kind?: string } = {}) {
  return memoryDb({
    creative_tests: [
      {
        id: "t1",
        user_id: MATAS,
        plan_id: "plan",
        event_id: "ev1",
        n: 1,
        kind: opts.kind ?? "pair",
        format: "video",
        runs_in: "tests_adset",
        state: "running",
        result_event: "initiate_checkout",
        currency: "GBP",
        daily_budget_minor: 100,
        hold_minor: 400,
        started_at: START,
        first_delivery_at: START,
        meta_campaign_id: "111",
        meta_adset_id: "222",
        extensions: opts.extensions ?? 0,
        extension_evidence: opts.evidence ?? null,
      },
    ],
    creative_test_variants: [
      { id: "v-earlier", test_id: "t1", position: 1, label: "Get Hard · earlier drop", meta_ad_id: "ad-earlier", state: "created" },
      { id: "v-payoff", test_id: "t1", position: 2, label: "Get Hard · payoff drop", meta_ad_id: "ad-payoff", state: "created" },
    ],
    creative_test_reads: [],
    ad_daily_insights: opts.days ?? variantDays(22, [2.52, 0], [1.48, 0]),
    events: [{ id: "ev1", event_code: "P26-BDAY", client_id: "cl1", budget_marketing: opts.budget === undefined ? 5000 : opts.budget }],
    clients: [{ id: "cl1", status: opts.archived ? "archived" : "active" }],
    event_daily_rollups: [{ event_id: "ev1", date: "2026-11-10", ad_spend: opts.spend ?? 1000 }],
    launched_ad_sets: [{ meta_adset_id: "222", draft_id: "d-main", source_type: opts.source ?? "creative_test", event_id: "ev1" }],
    meta_write_idempotency: [],
  });
}

function fakeGraph(fail: string | null = null) {
  const calls: string[] = [];
  const graph: ReadGraph = {
    async postAdSetEndTime(adsetId, endTime) {
      calls.push(`end ${adsetId} ${endTime}`);
      if (fail === "end") throw new Error("(#100) Invalid parameter");
    },
    async postAdSetStatus(adsetId, status) {
      calls.push(`status ${adsetId} ${status}`);
      if (fail === "status") throw new Error("(#2) Service temporarily unavailable");
    },
  };
  return { graph, calls };
}

describe("the gates", () => {
  it("ENABLE_CREATIVE_TESTS_READ unset: 200 with skippedReason, nothing read or written", async () => {
    for (const env of [{}, { ENABLE_CREATIVE_TESTS_READ: "true" }, { ENABLE_CREATIVE_TESTS_READ: "0" }]) {
      const mem = seed();
      const { graph, calls } = fakeGraph();
      assert.deepEqual(await runCreativeTestsRead({ env, db: mem.db, graph, now: morning(23), showDays }), { ok: true, skippedReason: "killswitch" });
      assert.equal(calls.length, 0);
      assert.equal(mem.writes.length, 0);
    }
  });

  it("acts at 08:00 London only, unless forced", async () => {
    const mem = seed();
    const { graph } = fakeGraph();
    assert.deepEqual(await runCreativeTestsRead({ env: WRITES, db: mem.db, graph, now: new Date("2026-11-23T07:00:00Z"), showDays }), { ok: true, skippedReason: "not_08_london" });
    // In summer 08:00 London is 07:00 UTC.
    const summer = await runCreativeTestsRead({ env: { ENABLE_CREATIVE_TESTS_READ: "1" }, db: seed().db, graph, now: new Date("2027-06-23T07:00:00Z"), showDays });
    assert.ok(!("skippedReason" in summer));
  });

  it("writes off: the day's read lands, the decision waits, nothing is written to Meta", async () => {
    const mem = seed();
    const { graph, calls } = fakeGraph();
    const result = await runCreativeTestsRead({ env: { ENABLE_CREATIVE_TESTS_READ: "1" }, db: mem.db, graph, now: morning(23), showDays });
    assert.ok("records" in result);
    assert.deepEqual(result.records.map((r) => [r.action, r.wrote, r.pending]), [["extend", false, "writes off"]]);
    assert.equal(calls.length, 0);
    assert.equal(mem.tables.creative_tests![0]!.extensions, 0);
    assert.equal(mem.tables.creative_test_reads!.length, 1);
    // The pause's own gate off: waits too.
    const stop = seed({ budget: 100 });
    const { OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED: _off, ...noStatus } = WRITES;
    const stopped = await runCreativeTestsRead({ env: noStatus, db: stop.db, graph, now: morning(23), showDays });
    assert.ok("records" in stopped);
    assert.deepEqual(stopped.records.map((r) => [r.action, r.pending]), [["stop", "writes off"]]);
    assert.equal(stop.tables.creative_tests![0]!.state, "running");
  });
});

describe("day 4", () => {
  it("both above the show's £3.00: the ad set's end moves to 23:59 London on day 8, once, with its hold and the day-4 figures", async () => {
    const mem = seed();
    const { graph, calls } = fakeGraph();
    const result = await runCreativeTestsRead({ env: WRITES, db: mem.db, graph, now: morning(23), showDays });
    assert.ok("records" in result && result.ok);
    assert.deepEqual(calls, ["end 222 2026-11-26T23:59:00+0000"]);
    assert.equal(result.records[0]!.text, "Extended to 26 Nov: both above the show's £3.00 per checkout");
    const test = mem.tables.creative_tests![0]!;
    assert.equal(test.extensions, 1);
    assert.equal(test.hold_minor, 800);
    assert.deepEqual((test.extension_evidence as { day4: unknown[] }).day4.length, 2);
    assert.deepEqual(mem.tables.meta_write_idempotency!.map((r) => [r.op_kind, r.op_status]), [["adset_end_time_update", "success"]]);
    const read = mem.tables.creative_test_reads![0]!;
    assert.deepEqual([read.read_day, read.state, read.benchmark_cost, read.benchmark_results], ["2026-11-23", "extended", 3, 50]);

    // A rerun the same morning: no second extension, no second write.
    const again = await runCreativeTestsRead({ env: WRITES, db: mem.db, graph, now: morning(23), showDays });
    assert.ok("records" in again);
    assert.equal(calls.length, 1);
    assert.equal(mem.tables.creative_tests![0]!.hold_minor, 800);
    assert.equal(mem.tables.creative_test_reads!.length, 1);
  });

  it("a retry after the write landed but the test row didn't: the ledger answers, Meta isn't asked again", async () => {
    const mem = seed();
    const { graph, calls } = fakeGraph();
    await runCreativeTestsRead({ env: WRITES, db: mem.db, graph, now: morning(23), showDays });
    Object.assign(mem.tables.creative_tests![0]!, { extensions: 0, hold_minor: 400 });
    await runCreativeTestsRead({ env: WRITES, db: mem.db, graph, now: morning(23), showDays });
    assert.equal(calls.length, 1);
    assert.equal(mem.tables.creative_tests![0]!.extensions, 1);
  });

  it("the cap re-check: no room for the extra £4.00, so it stops at day 4 and the ad set is paused", async () => {
    // £100 budget, £1,000 spent: no plan left, no room.
    const mem = seed({ budget: 100 });
    const { graph, calls } = fakeGraph();
    const result = await runCreativeTestsRead({ env: WRITES, db: mem.db, graph, now: morning(23), showDays });
    assert.ok("records" in result);
    assert.deepEqual(calls, ["status 222 PAUSED"]);
    assert.equal(result.records[0]!.text, "Stopped: both above the show's £3.00 per checkout");
    assert.equal(mem.tables.creative_tests![0]!.state, "stopped");
    assert.equal(capLeftMinor({ budget: 1000, spendToDate: 800, heldMinor: 3600 }), 400);
    assert.equal(capLeftMinor({ budget: null, spendToDate: 0, heldMinor: 0 }), 0);
  });

  it("a winner at or under the benchmark is left for Matas to call: no write", async () => {
    const mem = seed({ days: variantDays(22, [9, 3], [4, 0]) });
    const { graph, calls } = fakeGraph();
    const result = await runCreativeTestsRead({ env: WRITES, db: mem.db, graph, now: morning(23), showDays });
    assert.ok("records" in result);
    assert.equal(result.records[0]!.state, "ready_to_call");
    assert.equal(calls.length, 0);
    assert.equal(mem.tables.creative_tests![0]!.state, "running");
  });
});

describe("day 8", () => {
  const day4 = { day4: [{ variantId: "v-payoff", cost: null, results: 0 }, { variantId: "v-earlier", cost: null, results: 0 }] };

  it("neither improved: stopped, paused once, never resumed", async () => {
    const mem = seed({ extensions: 1, evidence: day4, days: variantDays(26, [5.04, 0], [2.96, 0]) });
    const { graph, calls } = fakeGraph();
    const result = await runCreativeTestsRead({ env: WRITES, db: mem.db, graph, now: morning(27), showDays });
    assert.ok("records" in result);
    assert.equal(result.records[0]!.text, "Stopped: both above the show's £3.00 per checkout");
    assert.deepEqual(calls, ["status 222 PAUSED"]);
    assert.equal(mem.tables.creative_tests![0]!.state, "stopped");
    // Stopped is no longer running: a later morning reads nothing and writes nothing.
    await runCreativeTestsRead({ env: WRITES, db: mem.db, graph, now: morning(28), showDays });
    assert.deepEqual(calls, ["status 222 PAUSED"]);
    assert.ok(!calls.some((c) => c.includes("ACTIVE")));
  });

  it("one came within 30 % with no results at day 4: a second extension to 23:59 on day 12, keeping who earned it", async () => {
    // Payoff £11.40 / 3 = £3.80 over 8 days, within 30 % of £3.00.
    const mem = seed({ extensions: 1, evidence: day4, days: variantDays(26, [11.4, 3], [6, 0]) });
    const { graph, calls } = fakeGraph();
    const result = await runCreativeTestsRead({ env: WRITES, db: mem.db, graph, now: morning(27), showDays });
    assert.ok("records" in result);
    assert.deepEqual(calls, ["end 222 2026-11-30T23:59:00+0000"]);
    const test = mem.tables.creative_tests![0]!;
    assert.equal(test.extensions, 2);
    assert.equal(test.hold_minor, 800);
    assert.equal((test.extension_evidence as { second: { variantId: string } }).second.variantId, "v-payoff");
  });
});

describe("what it never does", () => {
  it("never writes to an ad set that isn't a creative test's", async () => {
    const mem = seed({ source: "launch" });
    const { graph, calls } = fakeGraph();
    const result = await runCreativeTestsRead({ env: WRITES, db: mem.db, graph, now: morning(23), showDays });
    assert.ok("records" in result);
    assert.equal(result.records[0]!.pending, "not a creative test ad set");
    assert.equal(calls.length, 0);
  });

  it("skips an archived client's tests", async () => {
    const mem = seed({ archived: true });
    const { graph, calls } = fakeGraph();
    const result = await runCreativeTestsRead({ env: WRITES, db: mem.db, graph, now: morning(23), showDays });
    assert.ok("records" in result);
    assert.equal(result.tests, 0);
    assert.equal(calls.length, 0);
  });

  it("a Meta error is reported, the test row stays, and the day's read says why", async () => {
    const mem = seed();
    const { graph } = fakeGraph("end");
    const result = await runCreativeTestsRead({ env: WRITES, db: mem.db, graph, now: morning(23), showDays });
    assert.ok("errors" in result);
    assert.equal(result.ok, false);
    assert.match(result.errors[0]!.error, /Invalid parameter/);
    assert.equal(mem.tables.creative_tests![0]!.extensions, 0);
    assert.match(String(mem.tables.creative_test_reads![0]!.not_read), /Invalid parameter/);
    assert.equal(mem.tables.meta_write_idempotency![0]!.op_status, "failed");
  });

  it("the cron route is registered at 08:00 London's two UTC hours, with its alarm, and never imports a raw ad-set update elsewhere", () => {
    const vercel = JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] };
    assert.deepEqual(vercel.crons.filter((c) => c.path === "/api/cron/creative-tests-read"), [{ path: "/api/cron/creative-tests-read", schedule: "0 7,8 * * *" }]);
    const alarms = readFileSync(path.join(process.cwd(), "lib/reporting/cron-alarm-config.ts"), "utf8");
    assert.match(alarms, /cronName: "creative-tests-read", intervalMinutes: 1440/);
    const job = readFileSync(path.join(process.cwd(), "lib/creative-tests/read-job.ts"), "utf8");
    assert.doesNotMatch(job, /graphPost|lib\/meta\/client/);
    assert.match(job, /writeAdSetEndTime\(/);
    assert.match(job, /writeAdSetStatus\(\{[^}]*status: "PAUSED"/);
    assert.doesNotMatch(job, /status: "ACTIVE"/);
  });
});

describe("migration 263", () => {
  const SQL = readFileSync(path.join(process.cwd(), "supabase/migrations/263_creative_tests_read_ledger.sql"), "utf8");
  it("adds adset_end_time_update and keeps every kind on main and in the open Retargeting migrations", () => {
    const listed = [...SQL.slice(SQL.indexOf("add constraint meta_write_idempotency_op_kind_check")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    for (const kind of ["campaign_create", "adset_create", "ad_create", "creative_upload", "adset_targeting_update", "adset_destination_update", "refresh_creative_create", "refresh_ad_create", "ad_status_update", "adset_status_update", "refresh_adset_budget_update", "refresh_adset_create", "refresh_custom_conversion_create", "refresh_campaign_create", "refresh_campaign_lifetime_budget_update", "refresh_campaign_status_update", "retargeting_audience_rule_update", "retargeting_study_create", "retargeting_study_end", "adset_end_time_update"]) assert.ok(listed.includes(kind), kind);
    assert.equal(listed.length, 20);
    assert.ok(SQL.indexOf("drop constraint if exists meta_write_idempotency_op_kind_check") < SQL.indexOf("add constraint meta_write_idempotency_op_kind_check"));
  });
});
