import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { showBenchmark } from "../../../creative-tests/benchmark.ts";
import { isBusinessHours } from "../../../notify/business-hours.ts";
import { axisRollup, testKindOf, type FindingRowLike } from "../axis-rollup.ts";
import { copyRules, type CopyFeatureRow } from "../copy-rules.ts";
import { DIGEST_SCHEDULE, buildDigest, digestDedupeKey, isoWeekKey, runLearningDigest, type DigestRow } from "../digest.ts";
import { lastCompleteWeek, showWeek, showWeekRow, type WeekDay } from "../show-week.ts";

const AT = "2026-11-23T04:15:00.000Z";

// ── E4 show week ────────────────────────────────────────────────────────────

const day = (date: string, campaign: string, ad: string, spend: number, ic: number, name = ad): WeekDay => ({
  date,
  meta_ad_id: ad,
  ad_name: name,
  campaign_name: campaign,
  spend,
  landing_page_views: 0,
  registrations: 0,
  purchases: 0,
  actions: ic ? [{ action_type: "omni_initiated_checkout", value: String(ic) }] : [],
  promoted_event: "INITIATED_CHECKOUT",
  optimization_goal: "OFFSITE_CONVERSIONS",
  campaign_objective: "OUTCOME_SALES",
});
const MAIN = "[P26-BDAY] Puzzle - 27 Dec - On Sale V2";
const WEEK: WeekDay[] = [
  // Last week (9–15 Nov).
  day("2026-11-10", MAIN, "a1", 30, 10, "Static CTA"),
  day("2026-11-12", MAIN, "a2", 20, 2, "Vid 4"),
  day("2026-11-14", MAIN, "a3", 15, 3, "Snippet 2"),
  // This week (16–22 Nov).
  day("2026-11-17", MAIN, "a1", 18, 10, "Static CTA"),
  day("2026-11-18", MAIN, "a2", 40, 2, "Vid 4"),
  day("2026-11-19", MAIN, "a3", 14, 4, "Snippet 2"),
  day("2026-11-20", MAIN, "a4", 13, 0, "Vid CTA 1"),
  day("2026-11-21", MAIN, "a5", 5, 1, "Tiny"),
  // Never the show's cost: the Tests campaign and Retargeting.
  day("2026-11-19", "P26-BDAY · Tests", "t1", 60, 1),
  day("2026-11-19", "[P26-BDAY] Retargeting", "r1", 9, 9),
];

describe("E4 show week", () => {
  it("reads the last complete Monday–Sunday week", () => {
    assert.deepEqual(lastCompleteWeek("2026-11-23"), { weekStart: "2026-11-16", weekEnd: "2026-11-22", lastWeekStart: "2026-11-09" });
    assert.deepEqual(lastCompleteWeek("2026-11-26"), { weekStart: "2026-11-16", weekEnd: "2026-11-22", lastWeekStart: "2026-11-09" });
    assert.deepEqual(lastCompleteWeek("2026-11-30"), { weekStart: "2026-11-23", weekEnd: "2026-11-29", lastWeekStart: "2026-11-16" });
  });

  it("costs are showBenchmark's, both weeks", () => {
    const w = showWeek({ eventCode: "P26-BDAY", days: WEEK, readOn: "2026-11-23" })!;
    assert.deepEqual(w.thisWeek, showBenchmark(WEEK as never, { eventCode: "P26-BDAY", result: "initiate_checkout", fromDay: "2026-11-16", toDay: "2026-11-22" }));
    assert.deepEqual(w.lastWeek, showBenchmark(WEEK as never, { eventCode: "P26-BDAY", result: "initiate_checkout", fromDay: "2026-11-09", toDay: "2026-11-15" }));
    assert.deepEqual([w.thisWeek.spend, w.thisWeek.results, w.thisWeek.cost], [90, 17, 5.2941]);
    assert.deepEqual([w.lastWeek.spend, w.lastWeek.results, w.lastWeek.cost], [65, 15, 4.3333]);
    assert.equal(w.ratio, 1.2217);
    assert.equal(w.result, "initiate_checkout");
  });

  it("best and worst 3 ads at £12 or more; the biggest mover", () => {
    const w = showWeek({ eventCode: "P26-BDAY", days: WEEK, readOn: "2026-11-23" })!;
    assert.deepEqual(w.best.map((a) => [a.name, a.cost]), [["Static CTA", 1.8], ["Snippet 2", 3.5], ["Vid 4", 20]]);
    // No checkouts first, then the dearest not already best; "Tiny" (£5) never counts.
    assert.deepEqual(w.worst.map((a) => a.name), ["Vid CTA 1"]);
    // Vid 4: £10 → £20 per checkout is the biggest change either way.
    assert.deepEqual([w.mover?.name, w.mover?.lastCost, w.mover?.cost, w.mover?.ratio], ["Vid 4", 10, 20, 2]);
    const row = showWeekRow(w, { eventId: "e", clientId: "c", gbpRate: 1, currency: "GBP", computedAt: AT });
    assert.deepEqual([row.kind, row.scope_id, row.subject, row.week_start, row.stage, row.value_a, row.value_b, row.verdict], ["show_week", "P26-BDAY", "week", "2026-11-16", "ticket_sale", 5.2941, 4.3333, "dearer"]);
  });

  it("no main spend this week: no row", () => {
    assert.equal(showWeek({ eventCode: "P26-BDAY", days: WEEK.filter((d) => d.date < "2026-11-16"), readOn: "2026-11-23" }), null);
  });
});

// ── E3 rollup ───────────────────────────────────────────────────────────────

const pairRow = (show: string, client: string, ratio: number, results: [number, number], spend: number, adA: string, exact = true): FindingRowLike => ({
  kind: "variant_pair",
  scope: "event",
  scope_id: show,
  client_id: client,
  stage: "registration",
  subject: `${show}|text`,
  verdict: "x",
  ratio,
  results: results[0] + results[1],
  spend_gbp: spend,
  confidence: "ok",
  evidence: { axis: "text", ratioBound: exact ? "exact" : "at_least", a: { adIds: [adA], results: results[0] }, b: { adIds: [`${adA}b`], results: results[1] } },
});
const curveRow = (show: string, client: string, phase: string, ratio: number | null, results: number): FindingRowLike => ({ kind: "phase_curve", scope: "event", scope_id: show, client_id: client, stage: "registration", subject: phase, verdict: phase, ratio, results, spend_gbp: 100, confidence: "ok", evidence: {} });
const testRow = (show: string, client: string, verdict: string, campaignName: string, adsetName = campaignName): FindingRowLike => ({ kind: "test_verdict", scope: "event", scope_id: show, client_id: client, stage: "ticket_sale", subject: `${show}-adset`, verdict, ratio: null, results: 1, spend_gbp: 10, confidence: null, evidence: { campaignName, adsetName } });

describe("E3 axis rollup", () => {
  const verticalOf = new Map([["c1", "music"], ["c2", "music"]]);
  const voiceOf = new Map([["p1", "promoter"], ["p1b", "promoter"], ["p2", "promoter"], ["p2b", "promoter"], ["p3", "artist"], ["p3b", "promoter"]]);

  it("pairs pool by axis × stage × voice, shrunk toward the scope above, thin under 3 shows", () => {
    const rows = axisRollup({ rows: [pairRow("S1", "c1", 0.5, [20, 20], 200, "p1"), pairRow("S2", "c2", 0.8, [10, 30], 120, "p2"), pairRow("S3", "c1", 2, [5, 5], 50, "p3"), pairRow("S1", "c1", 3, [0, 4], 30, "p1", false)], verticalOf, voiceOf, computedAt: AT });
    const all = rows.find((r) => r.scope === "all" && r.subject === "pair|text|promoter")!;
    // exp((40·ln 0.5 + 40·ln 0.8) / 80) = 0.6325, shrunk toward 1 with k = 10 over 2 priced pairs.
    assert.equal(all.value_b, 0.6325);
    assert.equal(all.value_a, Math.round(((2 * 0.632456 + 10 * 1) / 12) * 10000) / 10000);
    assert.deepEqual([all.n_shows, all.n_pairs, (all.evidence as { bounds: number }).bounds], [2, 3, 1]);
    assert.equal(all.confidence, "thin");
    assert.equal(all.verdict, "no_text_cheaper");
    // Arms on different voices pool as unknown.
    assert.ok(rows.some((r) => r.scope === "all" && r.subject === "pair|text|unknown"));
    // Client c1 shrinks toward its vertical (or all, if the vertical is thin): here both thin → the last with an index.
    const c1 = rows.find((r) => r.scope === "client" && r.scope_id === "c1" && r.subject === "pair|text|promoter")!;
    assert.equal(c1.value_b, 0.5);
    assert.ok(c1.value_a! > 0.5 && c1.value_a! < 1);
  });

  it("never strong under 3 shows, whatever the n (capByShows)", () => {
    const many = Array.from({ length: 12 }, (_, i) => pairRow(i < 6 ? "S1" : "S2", "c1", 0.5, [40, 40], 100, "p1"));
    const all = axisRollup({ rows: many, verticalOf, voiceOf, computedAt: AT }).find((r) => r.scope === "all")!;
    assert.equal(all.confidence, "ok");
  });

  it("phase curves: median of each show's ratio to its own teaser; no teaser, no ratio", () => {
    const rows = axisRollup({ rows: [curveRow("S1", "c1", "announced", 6.5, 118), curveRow("S2", "c1", "announced", 3.85, 58), curveRow("S3", "c2", "announced", 3.19, 36), curveRow("S4", "c2", "announced", null, 50), curveRow("S1", "c1", "teaser", 1, 770)], verticalOf, voiceOf, computedAt: AT });
    const all = rows.find((r) => r.scope === "all" && r.subject === "phase|teaser>announced")!;
    assert.deepEqual([all.value_a, all.n_shows, all.verdict, all.confidence], [3.85, 3, "cost_rises", "ok"]);
    assert.ok(!rows.some((r) => r.subject === "phase|teaser>teaser"));
  });

  it("test verdicts: winners of tests by test kind", () => {
    assert.equal(testKindOf(testRow("P26-BDAY", "c1", "next_read", "P26-BDAY · Tests", "Top tracks reels · Luke Dean")), "Top tracks reels");
    assert.equal(testKindOf(testRow("NX26-DOD", "c1", "next_read", "NX26-DOD · AB copy test")), "AB copy test");
    const rows = axisRollup({ rows: [testRow("A", "c1", "ready_to_call", "A · AB copy test"), testRow("B", "c1", "next_read", "B · AB copy test"), testRow("C", "c2", "one_variant", "C · AB copy test")], verticalOf, voiceOf, computedAt: AT });
    const all = rows.find((r) => r.scope === "all" && r.subject === "tests|AB copy test")!;
    assert.deepEqual([all.value_a, all.value_b, all.n_shows, all.verdict, all.confidence], [1, 3, 3, "winners", "ok"]);
    assert.deepEqual([(all.evidence as { called: number }).called, (all.evidence as { running: number }).running], [2, 1]);
  });
});

// ── E5 copy rules ───────────────────────────────────────────────────────────

const feature = (over: Partial<CopyFeatureRow>): CopyFeatureRow => ({ feature: "scarcity_kind", value: "final_x", field: "body", stage: "ticket_sale", voice: "promoter", scope: "all", scope_id: "all", events_n: 11, ads_n: 30, spend: 500, results: 100, index_vs_event: 0.8822, confidence: "strong", proven: true, ...over });

describe("E5 copy rules (copy_features as stored)", () => {
  it("final_x: promoter 0.88 (proven) vs artist 1.86 → voices disagree", () => {
    const rows = copyRules([feature({}), feature({ voice: "artist", index_vs_event: 1.8647, events_n: 18, proven: false })], AT);
    const disagree = rows.find((r) => r.subject === "scarcity_kind=final_x|body|voices")!;
    assert.deepEqual([disagree.value_a, disagree.value_b, disagree.verdict, disagree.scope_id, disagree.n_shows], [0.8822, 1.8647, "promoter_better", null, 11]);
    // The artist side on its own is a "worse" rule (≥ 1.25 from ≥ 2 shows); 0.88 is proven but not ≤ 0.85.
    assert.deepEqual(rows.map((r) => [r.subject, r.verdict]).sort(), [["scarcity_kind=final_x|body|artist", "worse"], ["scarcity_kind=final_x|body|voices", "promoter_better"]]);
  });

  it("strong rows: proven ≤ 0.85, or ≥ 1.25 from 2 shows or more; never from 1 show", () => {
    const rows = copyRules([feature({ index_vs_event: 0.78 }), feature({ value: "countdown", index_vs_event: 1.9, proven: false, events_n: 1 }), feature({ value: "pct_sold", index_vs_event: 0.85, proven: false, events_n: 1 })], AT);
    assert.deepEqual(rows.map((r) => [r.subject, r.verdict]), [["scarcity_kind=final_x|body|promoter", "better"]]);
  });

  it("client rows keep their client", () => {
    const [row] = copyRules([feature({ scope: "client", scope_id: "c1", index_vs_event: 0.7 })], AT);
    assert.deepEqual([row!.scope, row!.scope_id, row!.client_id], ["client", "c1", "c1"]);
  });
});

// ── E8 digest ───────────────────────────────────────────────────────────────

const digestRow = (over: Partial<DigestRow>): DigestRow => ({ kind: "axis_rollup", scope: "all", scope_id: null, client_id: null, stage: "registration", week_start: null, subject: "phase|teaser>announced", metric: "cost_ratio_to_teaser", value_a: 2.52, value_b: null, ratio: 2.52, n_shows: 9, n_pairs: null, spend_gbp: 0, results: 0, confidence: "ok", verdict: "cost_rises", evidence: { from: "teaser", to: "announced" }, recommendation: null, ...over });

const ROWS: DigestRow[] = [
  digestRow({}),
  digestRow({ subject: "pair|text|promoter", metric: "cost_ratio", value_a: 0.5, ratio: 0.5, n_shows: 4, n_pairs: 6, confidence: "strong", evidence: { axis: "text", voice: "promoter", sides: ["no_text", "with_text"] } }),
  digestRow({ subject: "tests|AB copy test", metric: "winners", value_a: 1, value_b: 6, n_shows: 6, confidence: "ok", evidence: { testKind: "AB copy test" } }),
  digestRow({ subject: "phase|teaser>general_sale", value_a: 1.2, n_shows: 1, confidence: "thin" }),
  digestRow({ subject: "pair|cta|artist", value_a: 0.9, ratio: 0.9, n_shows: 3, confidence: "ok", evidence: { axis: "cta", voice: "artist", sides: ["cta", "no_cta"] } }),
  digestRow({ kind: "show_week", scope: "event", scope_id: "P26-BDAY", week_start: "2026-11-16", metric: "cost_per_initiate_checkout", subject: "week", evidence: { currency: "GBP", thisWeek: { spend: 223.8, results: 67, cost: 3.3403 }, lastWeek: { spend: 247.44, results: 53, cost: 4.6687 } } }),
  digestRow({ kind: "show_week", scope: "event", scope_id: "NX26-IPC", week_start: "2026-11-16", metric: "cost_per_initiate_checkout", subject: "week", evidence: { currency: "GBP", thisWeek: { spend: 26.44, results: 0, cost: null }, lastWeek: { spend: 34, results: 0, cost: null } } }),
  digestRow({ kind: "show_week", scope: "event", scope_id: "OLD", week_start: "2026-11-09", metric: "cost_per_initiate_checkout", subject: "week", evidence: {} }),
  digestRow({ kind: "test_verdict", scope: "event", scope_id: "NX26-ROBBIEDOHERTY", verdict: "ready_to_call", subject: "1", evidence: { adsetName: "NX26-ROBBIEDOHERTY · AB copy test", text: "Ready to call", readOn: "2026-11-23" } }),
  digestRow({ kind: "test_verdict", scope: "event", scope_id: "P26-BDAY", verdict: "next_read", subject: "2", evidence: { adsetName: "Top tracks reels · Luke Dean", text: "Next read 27 Nov: all 4 above the show's £4.04 per checkout", readOn: "2026-11-23" } }),
  digestRow({ kind: "test_verdict", scope: "event", scope_id: "EBR26-KREAM", verdict: "ended_no_call", subject: "3", evidence: { adsetName: "EBR26-KREAM · AB copy test", text: "Ended 21 Nov before day 8: no call", readOn: "2026-11-25" } }),
  digestRow({ kind: "test_verdict", scope: "event", scope_id: "OLDER", verdict: "day8_no_call", subject: "4", evidence: { adsetName: "OLDER · AB copy test", text: "Day 8: x · no call", readOn: "2026-11-10" } }),
];

describe("E8 digest", () => {
  it("builds the brief's E8 order: 3 strongest, shows, tests called, recommendations", () => {
    const { text, counts } = buildDigest({ rows: ROWS, digestDay: "2026-11-23", appUrl: "https://app.example.test/" });
    assert.equal(
      text,
      [
        "Learnings · week of 16 Nov–22 Nov",
        "",
        "Strongest cross-client learnings",
        "• text · signup stage · promoter page: no text 2.0× cheaper · 4 shows · 6 pairs · strong",
        "• teaser → announced · signup stage: cost 2.5× median · 9 shows · ok",
        "• AB copy test: 1 winner in 6 tests · 6 shows · ok",
        "",
        "Shows",
        "• NX26-IPC: £26.44 · no checkouts (last week no checkouts)",
        "• P26-BDAY: £223.80 · 67 checkouts · £3.34 per checkout (last week £4.67)",
        "",
        "Tests called",
        "• NX26-ROBBIEDOHERTY · AB copy test: Ready to call",
        "",
        "Recommendations waiting",
        "• None yet.",
        "",
        "https://app.example.test",
      ].join("\n"),
    );
    assert.deepEqual(counts, { learnings: 3, thinRollups: 1, shows: 2, testsCalled: 1, recommendations: 0 });
  });

  it("says so when nothing reaches ok", () => {
    const { text } = buildDigest({ rows: [digestRow({ confidence: "thin" })], digestDay: "2026-11-23" });
    assert.match(text, /• None at ok or above yet \(1 thin rollup\)\./);
    assert.match(text, /• No show spent last week\./);
    assert.match(text, /• None this week\./);
  });

  it("dedupes per ISO week", () => {
    assert.equal(isoWeekKey("2026-11-23"), "2026-W48");
    assert.equal(isoWeekKey("2026-11-29"), "2026-W48");
    assert.equal(isoWeekKey("2026-11-30"), "2026-W49");
    assert.equal(isoWeekKey("2027-01-01"), "2026-W53");
    assert.equal(isoWeekKey("2026-01-01"), "2026-W01");
    assert.equal(isoWeekKey("2024-12-30"), "2025-W01");
    assert.equal(digestDedupeKey("2026-11-23"), "learning_digest:2026-W48");
  });

  it("the schedule, Mondays 10:00 UTC, sits inside business hours in winter and in summer", () => {
    assert.equal(DIGEST_SCHEDULE, "0 10 * * 1");
    const crons = (JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] }).crons;
    assert.deepEqual(crons.filter((c) => c.path === "/api/cron/learning-digest").map((c) => c.schedule), [DIGEST_SCHEDULE]);
    assert.equal(isBusinessHours(new Date("2026-11-23T10:00:00Z")), true);
    assert.equal(isBusinessHours(new Date("2027-06-28T10:00:00Z")), true);
    // An hour earlier in winter would be dropped: the reason it isn't 09:00.
    assert.equal(isBusinessHours(new Date("2026-11-23T09:00:00Z")), false);
  });

  it("is off unless ENABLE_LEARNING_DIGEST is exactly 1", async () => {
    let calls = 0;
    const res = await runLearningDigest({ env: { ENABLE_LEARNING_DIGEST: "true" }, db: {} as never, rows: ROWS, notify: async () => ((calls += 1), { sent: true }) });
    assert.deepEqual(res, { ok: true, skippedReason: "killswitch" });
    assert.equal(calls, 0);
  });

  it("the dry run builds the text and never calls notify()", async () => {
    let calls = 0;
    const res = await runLearningDigest({ env: { ENABLE_LEARNING_DIGEST: "1" }, db: {} as never, now: new Date("2026-11-23T10:00:00Z"), dryRun: true, rows: ROWS, notify: async () => ((calls += 1), { sent: true }) });
    assert.equal(calls, 0);
    assert.ok(!("skippedReason" in res));
    assert.deepEqual([res.sent, res.reason, res.dedupeKey], [false, "dry_run", "learning_digest:2026-W48"]);
    assert.match(res.text, /^Learnings · week of 16 Nov–22 Nov/);
  });

  it("the live run posts once to ads_ops, in business hours, deduped per week", async () => {
    const seen: unknown[] = [];
    const res = await runLearningDigest({ env: { ENABLE_LEARNING_DIGEST: "1" }, db: {} as never, now: new Date("2026-11-23T10:00:00Z"), rows: ROWS, notify: async (opts) => (seen.push(opts), { sent: false, reason: "killswitch_off" }) });
    assert.equal(seen.length, 1);
    const opts = seen[0] as { channel: string; dedupeKey: string; respectBusinessHours: boolean; text: string };
    assert.deepEqual([opts.channel, opts.dedupeKey, opts.respectBusinessHours], ["ads_ops", "learning_digest:2026-W48", true]);
    assert.ok(!("skippedReason" in res));
    assert.deepEqual([res.sent, res.reason], [false, "killswitch_off"]);
  });
});
