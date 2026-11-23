import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  FINDINGS_CONFLICT,
  isLearningFindingsEnabled,
  learningFindingsRunLog,
  runLearningFindings,
  summariseFindings,
} from "../load-observed-tests.ts";
import {
  ONE_VARIANT,
  eventCodeOf,
  findingRow,
  groupObservedTests,
  londonAt,
  noResultEventText,
  priorOf,
  readObservedTest,
  resultEventOf,
  weekStart,
  type ObservedRead,
  type ObservedTest,
} from "../observed-tests.ts";
import { SHOW_DAYS, TEST_DAYS, showDaysOf } from "./observed-fixtures.ts";

const READ_ON = "2026-11-23";
const tests = groupObservedTests(TEST_DAYS);
const testOf = (adsetId: string): ObservedTest => tests.find((t) => t.adsetId === adsetId)!;
const TOP_TRACKS = "120248963912920539";
const ROBBIE = "120252640404890755";
const KREAM_AB = "120250552866970716";
const KREAM_CARDS = "120250552886780716";
const P26_AB = "120248937493960539";
const JULIAN = "120252640412680755";

function read(adsetId: string, opts: Partial<Parameters<typeof readObservedTest>[0]> = {}): ObservedRead {
  const test = testOf(adsetId);
  const r = readObservedTest({ test, showDays: showDaysOf(test.eventCode) as never, readOn: READ_ON, currency: "GBP", ...opts });
  assert.ok(r, adsetId);
  return r;
}
const byLabel = (r: ObservedRead, label: string) => r.variants.find((v) => v.label.includes(label))!;

describe("observed tests: what a test is", () => {
  it("is an ad set of a show test campaign, its ads the variants, its code from the campaign", () => {
    assert.equal(eventCodeOf("EBR26-KREAM · AB copy test"), "EBR26-KREAM");
    assert.equal(eventCodeOf("P26-BDAY · Tests"), "P26-BDAY");
    assert.equal(eventCodeOf("EBR26-KREAM · Artist cards test"), "EBR26-KREAM");
    assert.equal(eventCodeOf("[P26-BDAY] Puzzle - 27 Dec - On Sale V2"), null);
    assert.equal(eventCodeOf("P26-BDAY · Retargeting"), null);
    assert.equal(eventCodeOf("P26-BDAY · Tests copy"), null);
    assert.equal(tests.length, 6);
    assert.deepEqual(testOf(TOP_TRACKS).ads.map((a) => a.label), [
      "Puzzle - Luke Dean Top Tracks Ranked",
      "Puzzle - Luke Dean Top Tracks Forever",
      "Puzzle - Luke Dean Top Tracks Level",
      "Puzzle - Luke Dean Top Tracks Cant Live",
    ]);
    assert.equal(testOf(TOP_TRACKS).adsetName, "Top tracks reels · Luke Dean");
  });

  it("ignores rows of any other campaign", () => {
    const main = SHOW_DAYS.map((d) => ({ ...d, meta_adset_id: "main", meta_campaign_id: "c", adset_name: null, ad_name: null, ad_account_id: null, promoted_event: null, optimization_goal: null, campaign_objective: null }));
    assert.equal(groupObservedTests(main as never).length, 0);
  });

  it("reads the result the ad set optimises for, as resultOf does", () => {
    assert.equal(resultEventOf("INITIATED_CHECKOUT", "OFFSITE_CONVERSIONS"), "initiate_checkout");
    assert.equal(resultEventOf("COMPLETE_REGISTRATION", "OFFSITE_CONVERSIONS"), "complete_registration");
    assert.equal(resultEventOf(null, "LEAD_GENERATION"), "complete_registration");
    assert.equal(resultEventOf(null, "LANDING_PAGE_VIEWS"), "landing_page_view");
    assert.equal(resultEventOf("ADD_TO_CART", "OFFSITE_CONVERSIONS"), null);
    assert.equal(resultEventOf("PURCHASE", "OFFSITE_CONVERSIONS"), null);
  });
});

describe("observed tests: the 23 Nov read (figures 17–22 Nov)", () => {
  it("P26-BDAY · Tests / Top tracks reels: day 4, no winner, every variant above the show", () => {
    const r = read(TOP_TRACKS);
    assert.equal(r.firstDeliveryDay, "2026-11-19");
    assert.equal(r.readDay, 4);
    assert.equal(r.phase, "end_day");
    assert.equal(r.decides, true);
    assert.deepEqual([byLabel(r, "Ranked").spend, byLabel(r, "Ranked").results], [27.01, 2]);
    assert.deepEqual([byLabel(r, "Forever").spend, byLabel(r, "Forever").results], [16.02, 2]);
    assert.deepEqual([byLabel(r, "Level").spend, byLabel(r, "Level").results], [13.66, 0]);
    assert.deepEqual([byLabel(r, "Cant Live").spend, byLabel(r, "Cant Live").results], [3.09, 0]);
    // ≈ 5 % of the spend: barely served.
    assert.equal(Math.round(byLabel(r, "Cant Live").share! * 100), 5);
    assert.equal(byLabel(r, "Cant Live").judged, false);
    // TF5: the show's main campaign 19–22 Nov, test campaigns dropped.
    assert.deepEqual(r.benchmark, { cost: 4.036, spend: 141.26, results: 35 });
    assert.notEqual(r.state, "ready_to_call");
    assert.equal(r.winnerId, null);
    // TF6: all above the show at the end day → the next read is day 8.
    // Design C1 / S4: never TF6's "Extended"; TF6's clause stays, "all 4" for more than two.
    assert.equal(r.state, "next_read");
    assert.equal(r.text, "Next read 27 Nov: all 4 above the show's £4.04 per checkout");
    assert.equal(r.action, "extend");
    assert.equal(r.after.extensions, 1);
    assert.equal(r.after.evidence.day4?.length, 4);
    assert.equal(r.after.final, false);
  });

  it("NX26-ROBBIEDOHERTY · AB copy test: [AB-A] wins (93 % of spend, 3 checkouts, £4.16 under the show's £5.31)", () => {
    const r = read(ROBBIE);
    const a = byLabel(r, "[AB-A]");
    const b = byLabel(r, "[AB-B]");
    assert.deepEqual([a.spend, a.results], [12.48, 3]);
    assert.deepEqual([b.spend, b.results], [0.95, 0]);
    assert.equal(Math.round(b.share! * 100), 7);
    assert.equal(b.judged, false);
    assert.equal(r.benchmark?.results, 36);
    assert.equal(r.benchmark?.cost, 5.3089);
    assert.equal(r.phase, "after_end");
    assert.equal(r.decides, true);
    assert.equal(r.state, "ready_to_call");
    assert.equal(r.text, "Ready to call");
    assert.equal(r.winnerId, a.adId);
  });

  it("EBR26-KREAM · AB copy test: no winner yet (B has 91 % but 2 checkouts)", () => {
    const r = read(KREAM_AB);
    const b = byLabel(r, "[AB-B]");
    assert.deepEqual([b.spend, b.results], [8.1, 2]);
    assert.deepEqual([byLabel(r, "[AB-A]").spend, byLabel(r, "[AB-A]").results], [0.84, 0]);
    assert.equal(Math.round(b.share! * 100), 91);
    assert.equal(r.leaderId, b.adId);
    assert.equal(r.winnerId, null);
    assert.equal(r.state, "next_read");
    assert.equal(r.text, "Next read 25 Nov: both above the show's £1.44 per checkout");
  });

  it("EBR26-KREAM · Artist cards test: no checkouts, no winner", () => {
    const r = read(KREAM_CARDS);
    assert.deepEqual(r.variants.map((v) => [v.label, v.spend, v.results]), [
      ["[CARD-SUPPORT-LeenaPunks]", 5.5, 0],
      ["[CARD-SUPPORT-Parts]", 4.71, 0],
      ["[CARD-HEADLINER]", 0.87, 0],
      ["[CARD-SUPPORT-Estiva]", 0.58, 0],
    ]);
    assert.equal(r.winnerId, null);
    assert.equal(r.text, "Next read 27 Nov: all 4 above the show's £1.55 per checkout");
  });

  it("P26-BDAY · AB copy test: one ad → one variant, no call", () => {
    const r = read(P26_AB);
    assert.equal(r.state, "one_variant");
    assert.equal(r.text, ONE_VARIANT);
    assert.equal(r.text, "One variant: no call");
    assert.equal(r.benchmark, null);
    assert.equal(r.after.final, true);
  });

  it("an ad set optimising for Add to cart gets no call", () => {
    const r = read(JULIAN);
    assert.equal(r.state, "no_result_event");
    assert.equal(r.text, "Optimises for add to cart: no call");
    assert.equal(noResultEventText("PURCHASE"), "Optimises for purchases: no call");
    assert.equal(noResultEventText(null, "LANDING_PAGE_VIEWS"), "Optimises for landing page views: no call");
    assert.equal(noResultEventText(null, "LINK_CLICKS"), "Optimises for link clicks: no call");
    // Never Meta's raw enum.
    assert.equal(noResultEventText("SOME_NEW_EVENT", "SOME_GOAL"), "Optimises for an event no test reads: no call");
    // The figures still show.
    assert.deepEqual(r.variants.map((v) => v.spend), [2.56, 0.73]);
    assert.equal(r.after.final, true);
  });
});

describe("observed tests: TF9's cadence, kept in the finding", () => {
  it("before day 4 TF2 reads, and nothing moves", () => {
    const r = read(TOP_TRACKS, { readOn: "2026-11-21" });
    assert.equal(r.phase, "before");
    assert.equal(r.decides, false);
    assert.equal(r.state, "running");
    assert.match(r.text, /^Running · 56 h · \d+ % of spend on Puzzle - Luke Dean Top Tracks Ranked$/);
    assert.equal(r.after.extensions, 0);
  });

  it("an ad set with no delivery after day 4 reads \"Ended {d Mon} before day 8\" at its day-8 read, and stands", () => {
    // EBR26-KREAM's AB copy test last spent on 21 Nov (day 4).
    const day4 = read(KREAM_AB);
    const prior = { readOn: day4.readOn, before: day4.before, after: day4.after };
    const between = read(KREAM_AB, { readOn: "2026-11-24", prior });
    assert.equal(between.phase, "before");
    assert.equal(between.endDay, "2026-11-25");
    assert.equal(between.after.extensions, 1);
    assert.equal(between.state, "next_read");
    assert.equal(between.text, "Next read 25 Nov: both above the show's £1.44 per checkout");
    const day8 = read(KREAM_AB, { readOn: "2026-11-25", prior: { readOn: between.readOn, before: between.before, after: between.after } });
    assert.equal(day8.phase, "end_day");
    assert.equal(day8.state, "ended_no_call");
    assert.equal(day8.text, "Ended 21 Nov before day 8: no call");
    assert.equal(day8.after.final, true);
    // The finding stands from here: no later read, never a day 12.
    assert.equal(readObservedTest({ test: testOf(KREAM_AB), showDays: showDaysOf("EBR26-KREAM") as never, readOn: "2026-11-26", prior: { readOn: day8.readOn, before: day8.before, after: day8.after } }), null);
  });

  it("a test still delivering after day 4 reads \"Day 8: … · no call\" at day 8, and stands", () => {
    // Top tracks reels kept spending 23–26 Nov with no checkout: still all above the show at day 8.
    const later = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"];
    const base = testOf(TOP_TRACKS);
    const extra = later.flatMap((date) => base.ads.map((ad) => ({ ...base.days.find((d) => d.meta_ad_id === ad.adId)!, date, spend: 2, landing_page_views: 1, actions: [] })));
    const test = { ...base, days: [...base.days, ...extra] };
    const show = showDaysOf("P26-BDAY");
    const day4 = readObservedTest({ test, showDays: show as never, readOn: READ_ON, currency: "GBP" })!;
    assert.equal(day4.text, "Next read 27 Nov: all 4 above the show's £4.04 per checkout");
    const day8 = readObservedTest({ test, showDays: show as never, readOn: "2026-11-27", prior: { readOn: day4.readOn, before: day4.before, after: day4.after }, currency: "GBP" })!;
    assert.equal(day8.phase, "end_day");
    assert.equal(day8.state, "day8_no_call");
    assert.match(day8.text, /^Day 8: .+ · no call$/);
    assert.doesNotMatch(day8.text, /Stopped|Extended/);
    assert.equal(day8.after.final, true);
    assert.equal(readObservedTest({ test, showDays: show as never, readOn: "2026-12-01", prior: { readOn: day8.readOn, before: day8.before, after: day8.after } }), null);
  });

  it("a row #1352 stored (verdict extended, TF6's words) reads on cleanly with the new keys", () => {
    // What tonight's 04:15 run on #1352's code stores for EBR26-KREAM's AB copy test.
    const old = {
      kind: "test_verdict",
      subject: KREAM_AB,
      verdict: "extended",
      evidence: {
        observed: true,
        text: "Extended to 25 Nov: both above the show's £1.44 per checkout",
        readOn: READ_ON,
        state: {
          before: { extensions: 0, evidence: {}, reads: [], final: false },
          after: { extensions: 1, evidence: { day4: [{ variantId: "120250552884850716", cost: 4.05, results: 2 }, { variantId: "120250552877890716", cost: null, results: 0 }] }, reads: [READ_ON], final: false },
        },
      },
    };
    const prior = priorOf(old);
    assert.ok(prior);
    // A rerun the same London day starts again from before that read: the same key, the new words.
    const same = read(KREAM_AB, { prior });
    assert.deepEqual([same.state, same.text], ["next_read", "Next read 25 Nov: both above the show's £1.44 per checkout"]);
    assert.deepEqual(same.after.reads, [READ_ON]);
    // The next morning: "extended" isn't final; it reads on to day 8 without counting a read day twice.
    const next = read(KREAM_AB, { readOn: "2026-11-24", prior });
    assert.equal(next.state, "next_read");
    assert.deepEqual(next.after.reads, [READ_ON, "2026-11-24"]);
    const row = findingRow(testOf(KREAM_AB), next, { eventId: "e", clientId: "c", gbpRate: 1, currency: "GBP", computedAt: "2026-11-24T04:15:00Z" });
    assert.deepEqual([row.kind, row.scope_id, row.subject, row.week_start, row.verdict], ["test_verdict", "EBR26-KREAM", KREAM_AB, "2026-11-16", "next_read"]);
  });

  it("observed tests never carry TF6's keys or words", () => {
    for (const id of [TOP_TRACKS, ROBBIE, KREAM_AB, KREAM_CARDS, P26_AB, JULIAN]) {
      const r = read(id);
      assert.ok(!["extended", "stopped"].includes(r.state), `${id} ${r.state}`);
      assert.doesNotMatch(r.text, /^(Extended|Stopped)/, id);
    }
  });

  it("a rerun on the same day starts from the state before that day's read", () => {
    const first = read(TOP_TRACKS);
    const again = read(TOP_TRACKS, { prior: { readOn: READ_ON, before: first.before, after: first.after } });
    assert.equal(again.text, first.text);
    assert.equal(again.after.extensions, 1);
  });

  it("a read before yesterday's insights are restated moves nothing", () => {
    const r = read(TOP_TRACKS, { covered: false });
    assert.equal(r.action, "extend");
    assert.equal(r.pending, "yesterday's insights aren't restated yet");
    assert.equal(r.after.extensions, 0);
    // It doesn't count as the end day's read, so tomorrow's can still decide.
    assert.deepEqual(r.after.reads, []);
    assert.equal(r.state, "next_read");
  });
});

describe("observed tests: the finding row", () => {
  it("one row per ad set, keyed to its first delivery's week", () => {
    const test = testOf(ROBBIE);
    const r = read(ROBBIE);
    const row = findingRow(test, r, { eventId: "e-robbie", clientId: "c-nx", gbpRate: 1, currency: "GBP", computedAt: "2026-11-23T04:15:00.000Z" });
    assert.equal(row.kind, "test_verdict");
    assert.equal(row.scope, "event");
    assert.equal(row.scope_id, "NX26-ROBBIEDOHERTY");
    assert.equal(row.subject, ROBBIE);
    assert.equal(row.week_start, "2026-11-16");
    assert.equal(row.stage, "ticket_sale");
    assert.equal(row.verdict, "ready_to_call");
    assert.equal(row.read_day, 6);
    assert.equal(row.value_a, 4.16);
    assert.equal(row.value_b, 5.3089);
    assert.equal(row.spend_gbp, 13.43);
    assert.equal(row.results, 3);
    assert.equal((row.evidence as { text: string }).text, "Ready to call");
    assert.equal((row.evidence as { wrote: boolean }).wrote, false);
    // The stored state round-trips.
    const prior = priorOf(row);
    assert.equal(prior?.readOn, READ_ON);
    assert.deepEqual(prior?.after, r.after);
  });

  it("London days and weeks", () => {
    assert.equal(weekStart("2026-11-19"), "2026-11-16");
    assert.equal(weekStart("2026-11-16"), "2026-11-16");
    assert.equal(weekStart("2026-11-22"), "2026-11-16");
    assert.equal(londonAt("2026-11-23", 8), "2026-11-23T08:00:00.000Z");
    assert.equal(londonAt("2026-07-01", 8), "2026-07-01T07:00:00.000Z");
    assert.equal(londonAt("2026-07-01", 0), "2026-06-30T23:00:00.000Z");
  });
});

// ── The run, against a fake database ────────────────────────────────────────

type Tables = Record<string, Record<string, unknown>[]>;

function fakeDb(tables: Tables) {
  const upserts: { table: string; rows: unknown[]; onConflict?: string }[] = [];
  const deletes: { table: string; filters: string[] }[] = [];
  const reads: string[] = [];
  const db = {
    from(table: string) {
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      const said: string[] = [];
      let deleting = false;
      const like = (pattern: string) => new RegExp(`^${pattern.split("%").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i");
      const q = {
        select() {
          reads.push(table);
          return q;
        },
        eq(c: string, v: unknown) {
          filters.push((r) => r[c] === v);
          said.push(`eq ${c} ${String(v)}`);
          return q;
        },
        not(c: string, op: string, v: string) {
          said.push(`not ${c} ${op} ${v}`);
          if (deleting) {
            deletes.push({ table, filters: said });
            return Promise.resolve({ error: null });
          }
          return q;
        },
        delete() {
          deleting = true;
          return q;
        },
        in(c: string, v: readonly unknown[]) {
          filters.push((r) => v.includes(r[c]));
          return q;
        },
        ilike(c: string, v: string) {
          filters.push((r) => like(v).test(String(r[c] ?? "")));
          return q;
        },
        gte(c: string, v: string) {
          filters.push((r) => String(r[c]) >= v);
          return q;
        },
        lte(c: string, v: string) {
          filters.push((r) => String(r[c]) <= v);
          return q;
        },
        order() {
          return q;
        },
        range(from: number, to: number) {
          if (!(table in tables)) return Promise.resolve({ data: null, error: { message: `relation "${table}" does not exist`, code: "42P01" } });
          return Promise.resolve({ data: tables[table]!.filter((r) => filters.every((f) => f(r))).slice(from, to + 1), error: null });
        },
        // Awaited without .range (loadArchivedClientIds): every matching row.
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return q.range(0, Number.MAX_SAFE_INTEGER - 1).then(resolve, reject);
        },
        upsert(rows: unknown[], opts?: { onConflict?: string }) {
          upserts.push({ table, rows, onConflict: opts?.onConflict });
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  };
  return { db: db as never, upserts, reads, deletes };
}

function baseTables(): Tables {
  return {
    ad_daily_insights: [...TEST_DAYS, ...SHOW_DAYS.map((d) => ({ date: d.date, meta_ad_id: d.meta_ad_id, campaign_name: d.campaign_name, spend: d.spend, landing_page_views: d.landing_page_views, registrations: d.registrations, actions: d.actions, meta_adset_id: "main", meta_campaign_id: "main" }))] as never,
    creative_tests: [],
    events: [
      { id: "e-kream", event_code: "EBR26-KREAM", client_id: "c-ebr" },
      { id: "e-robbie", event_code: "NX26-ROBBIEDOHERTY", client_id: "c-nx" },
      { id: "e-julian", event_code: "NX27-JULIANFIJMA", client_id: "c-nx" },
      { id: "e-p26", event_code: "P26-BDAY", client_id: "c-puzzle" },
    ],
    clients: [],
    bm_ad_accounts: [],
    cron_runs: [{ cron_name: "ad-daily-insights", started_at: "2026-11-23T02:30:05.000Z", ok: true, detail: {} }],
    learning_findings: [],
  };
}

const ENV = { ENABLE_LEARNING_FINDINGS: "1" };

describe("observed tests: the run", () => {
  it("is off unless ENABLE_LEARNING_FINDINGS is exactly 1", async () => {
    assert.equal(isLearningFindingsEnabled({}), false);
    assert.equal(isLearningFindingsEnabled({ ENABLE_LEARNING_FINDINGS: "true" }), false);
    const { db, reads } = fakeDb(baseTables());
    assert.deepEqual(await runLearningFindings({ env: {}, db, readOn: READ_ON }), { ok: true, skippedReason: "killswitch" });
    assert.deepEqual(reads, []);
  });

  it("upserts one finding per observed test on the unique key", async () => {
    const fakeRun = fakeDb(baseTables());
    const { db, upserts } = fakeRun;
    const result = await runLearningFindings({ env: ENV, db, readOn: READ_ON, now: new Date("2026-11-23T04:15:00Z") });
    assert.ok(!("skippedReason" in result));
    assert.equal(result.ok, true);
    assert.equal(result.tests, 6);
    // Six test verdicts, and one no_phase_data curve row for each show whose main campaigns delivered (no announcement_at in this fixture).
    assert.deepEqual(result.writtenByKind, { test_verdict: 6, variant_pair: 0, phase_curve: 3 });
    assert.equal(result.written, 9);
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0]!.table, "learning_findings");
    assert.equal(upserts[0]!.onConflict, FINDINGS_CONFLICT);
    assert.equal(FINDINGS_CONFLICT, "kind,scope,scope_id,stage,week_start,subject");
    const subjects = (upserts[0]!.rows as { kind: string; subject: string }[]).filter((r) => r.kind === "test_verdict").map((r) => r.subject);
    assert.equal(new Set(subjects).size, 6);
    const curves = (upserts[0]!.rows as { kind: string; scope_id: string; subject: string }[]).filter((r) => r.kind === "phase_curve");
    assert.deepEqual(curves.map((r) => [r.scope_id, r.subject]).sort(), [["EBR26-KREAM", "no_phase_data"], ["NX26-ROBBIEDOHERTY", "no_phase_data"], ["P26-BDAY", "no_phase_data"]]);
    const robbie = (upserts[0]!.rows as { subject: string; event_id: string; verdict: string }[]).find((r) => r.subject === ROBBIE)!;
    assert.deepEqual([robbie.event_id, robbie.verdict], ["e-robbie", "ready_to_call"]);
    // Stale curve rows of each show are cleared, keeping this night's subjects.
    const { deletes } = fakeRun;
    assert.deepEqual(deletes.find((d) => d.filters.includes("eq scope_id P26-BDAY"))?.filters, ["eq kind phase_curve", "eq scope event", "eq scope_id P26-BDAY", 'not subject in ("no_phase_data")']);
    const body = summariseFindings(result);
    assert.deepEqual(learningFindingsRunLog(body).detail.verdicts, { next_read: 3, ready_to_call: 1, one_variant: 1, no_result_event: 1 });
  });

  it("skips an ad set the app's own test owns, and archived clients", async () => {
    const tables = baseTables();
    tables.creative_tests = [{ id: "t1", meta_adset_id: TOP_TRACKS }];
    tables.clients = [{ id: "c-ebr", status: "archived" }];
    const { db, upserts } = fakeDb(tables);
    const result = await runLearningFindings({ env: ENV, db, readOn: READ_ON });
    assert.ok(!("skippedReason" in result));
    assert.deepEqual(result.skipped, { appTest: 1, archivedClient: 2, findingStands: 0 });
    const subjects = (upserts[0]!.rows as { kind: string; subject: string }[]).filter((r) => r.kind === "test_verdict").map((r) => r.subject).sort();
    assert.deepEqual(subjects, [JULIAN, P26_AB, ROBBIE].sort());
    // The archived client's show gets no curve either.
    assert.ok(!(upserts[0]!.rows as { kind: string; scope_id: string }[]).some((r) => r.kind === "phase_curve" && r.scope_id === "EBR26-KREAM"));
  });

  it("dry run writes nothing and runs before migration 264; the cron refuses without it", async () => {
    const tables = baseTables();
    delete tables.learning_findings;
    const dry = fakeDb(tables);
    const result = await runLearningFindings({ env: ENV, db: dry.db, readOn: READ_ON, dryRun: true });
    assert.ok(!("skippedReason" in result));
    assert.equal(result.findingsTable, "missing");
    assert.equal(result.written, 0);
    assert.equal(dry.upserts.length, 0);
    await assert.rejects(runLearningFindings({ env: ENV, db: fakeDb(tables).db, readOn: READ_ON }), /migration 264/);
  });

  it("a finding that stands is not read again", async () => {
    const first = fakeDb(baseTables());
    await runLearningFindings({ env: ENV, db: first.db, readOn: READ_ON });
    const tables = baseTables();
    tables.learning_findings = (first.upserts[0]!.rows as { kind: string }[]).filter((r) => r.kind === "test_verdict") as never;
    const next = fakeDb(tables);
    const result = await runLearningFindings({ env: ENV, db: next.db, readOn: "2026-11-24" });
    assert.ok(!("skippedReason" in result));
    // one_variant, no_result_event and the day's ready_to_call (an end-day call) are final; the three next_read tests read again.
    assert.equal(result.skipped.findingStands, 3);
    assert.equal(result.writtenByKind.test_verdict, 3);
  });
});

describe("migration 264", () => {
  const sql = readFileSync("supabase/migrations/264_learning_findings.sql", "utf8");
  it("creates every kind now, with source and read_day", () => {
    for (const kind of ["test_verdict", "variant_pair", "phase_curve", "axis_rollup", "show_week", "copy_rule"]) assert.match(sql, new RegExp(`'${kind}'`));
    assert.match(sql, /\bsource\s+text\b/);
    assert.match(sql, /\bread_day\s+smallint\b/);
  });
  it("keys a row on (kind, scope, scope_id, stage, week_start, subject), nulls not distinct", () => {
    assert.match(sql, /unique nulls not distinct \(kind, scope, scope_id, stage, week_start, subject\)/);
  });
  it("is service role only, like copy_features (213), naming OPERATOR_USER_IDS", () => {
    assert.match(sql, /enable row level security/);
    assert.match(sql, /for select to authenticated using \(false\)/);
    assert.doesNotMatch(sql, /for (insert|update|delete|all) to authenticated/);
    assert.match(sql, /OPERATOR_USER_IDS/);
  });
});
