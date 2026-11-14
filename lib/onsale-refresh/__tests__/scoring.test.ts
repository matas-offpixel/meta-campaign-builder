/**
 * P5 (R6 / HR6): the on-sale refresh learning from its own moves. Every
 * outcome rule, unknowns, the 10 / 20-outcome thresholds, the rejection
 * streak, idempotent re-scoring, the learning-refresh wiring and the
 * killswitch-off identity. Fakes only.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { fakeDb } from "../../launched-ads/__tests__/fake-db.ts";
import { currencyResolver } from "../../learning/currency.ts";
import type { LearningInputs } from "../../learning/joins.ts";
import { LEARNING_JOBS, runLearningRefresh } from "../../learning/runner.ts";
import { CLIENTS, NOW, TAGS, fact } from "../../learning/__tests__/fixtures.ts";
import { ONSALE_PHASE } from "../phase-config.ts";
import { applyTrackRecords, buildProposal, type CampaignInput, type ProposalLine } from "../rules.ts";
import { runOnsaleRefresh, type RunRefreshInput } from "../runner.ts";
import { planRun } from "../schedule.ts";
import { MOVE_HOLD_RATIO, PAUSE_WORSE_RATIO, dueLines, isScoringEnabled, judgeLine, judgedWeek, scoreOnsaleRefresh, wasApplied, type InsightRow, type ScoreLine, type ScoreProposal } from "../scoring.ts";
import { LOW_TRACK_RECORD, MIN_JUDGED, REJECT_STREAK, STOP_JUDGED, computeTrackRecords, stoppedText, trackKey } from "../track-record.ts";
import { OR10_STOPPED } from "../../../scripts/plan-frames/refresh-fixtures.ts";
import { memoryDb } from "./memory-db.ts";

const IC = "initiate_checkout";
const row = (extra: Partial<InsightRow> & { ic?: number }): InsightRow => ({
  meta_ad_id: "a",
  meta_adset_id: "s1",
  meta_campaign_id: "c1",
  date: "2026-11-17",
  ad_name: "Ad",
  spend: 10,
  landing_page_views: 0,
  actions: [{ action_type: "omni_initiated_checkout", value: extra.ic ?? 1 }],
  ...extra,
});

function line(kind: string, extra: Partial<ScoreLine> = {}): ScoreLine {
  return { id: `l-${kind}`, proposal_id: "p1", user_id: "u1", kind, rule_id: `${kind}.rule`, state: "to_review", target: {}, evidence: {}, write: {}, applied_result: null, applied_at: null, ...extra };
}

const judge = (l: ScoreLine, rows: InsightRow[], scores: Map<string, number> = new Map()) => judgeLine(l, { objective: IC, rows, scores });

// Campaign in the week: £100 over 10 IC = £10 each, unless a test says otherwise.
const CAMPAIGN = [row({ meta_ad_id: "x1", ad_name: "Other", meta_adset_id: "s9", spend: 60, ic: 6 }), row({ meta_ad_id: "x2", ad_name: "Weak", meta_adset_id: "s1", spend: 40, ic: 4 })];

// ── Each rule ────────────────────────────────────────────────────────────────

describe("P5 scoring: pause (R6)", () => {
  const pause = (extra: Partial<ScoreLine> = {}) => line("pause_creative", { target: { creative: "Weak", adIds: ["x2"] }, evidence: { campaignCpr: 12, cprRatio: 1.8, spend: 30, results: 2 }, ...extra });

  it("applied: right when the campaign's cost held or improved and the creative had run worse than 1.5×", () => {
    const applied = pause({ state: "applied" });
    assert.equal(judge(applied, CAMPAIGN).outcome, "right", "£10 ≤ £12, and 1.8× ≥ 1.5×");
    assert.equal(judge(pause({ state: "applied", evidence: { campaignCpr: 8, cprRatio: 1.8 } }), CAMPAIGN).outcome, "wrong", "the campaign's cost rose to £10 from £8");
    assert.equal(judge(pause({ state: "applied", evidence: { campaignCpr: 12, cprRatio: 1.2 } }), CAMPAIGN).outcome, "wrong", "it hadn't run worse than 1.5×");
    assert.equal(judge(applied, [row({ ic: 0 })]).outcome, "unknown", "no cost per result in the week");
  });

  it("not applied: the counterfactual — did the creative keep running worse than 1.5× the campaign?", () => {
    // Weak at £40 / 2 IC = £20 vs the campaign's £100 / 8 = £12.50 → 1.6× → right.
    const rows = [row({ meta_ad_id: "x1", ad_name: "Other", spend: 60, ic: 6 }), row({ meta_ad_id: "x2", ad_name: "Weak", spend: 40, ic: 2 })];
    const shadow = judge(pause(), rows);
    assert.equal(shadow.outcome, "right");
    assert.equal(shadow.reason, "Not paused: the creative kept running worse than 1.5× the campaign.");
    assert.equal(judge(pause({ state: "rejected" }), CAMPAIGN).outcome, "wrong", "£10 each, 1× the campaign");
    assert.equal(judge(pause(), [row({ ad_name: "Other" })]).outcome, "unknown", "the creative didn't run");
    assert.equal(PAUSE_WORSE_RATIO, 1.5);
  });
});

describe("P5 scoring: add (R6)", () => {
  const add = (extra: Partial<ScoreLine> = {}) => line("add_creative", { target: { name: "P26-BDAY_enzo-4.mp4" }, state: "applied", applied_result: { adIds: [{ adId: "n1", adsetId: "s1" }] }, ...extra });
  const rows = [row({ ad_name: "A" }), row({ meta_ad_id: "b", ad_name: "B" }), row({ meta_ad_id: "c", ad_name: "C" }), row({ meta_ad_id: "n1", ad_name: "P26-BDAY_enzo-4" })];

  it("right at or above the campaign's median convert score; wrong under it", () => {
    const scores = new Map([["A", 30], ["B", 50], ["C", 70]]);
    assert.equal(judge(add(), rows, new Map([...scores, ["P26-BDAY_enzo-4", 50]])).outcome, "right", "50 ≥ median 50");
    assert.equal(judge(add(), rows, new Map([...scores, ["P26-BDAY_enzo-4", 49]])).outcome, "wrong");
  });

  it("unknown when it wasn't applied, or has no score yet, or nothing to compare", () => {
    assert.equal(judge(add({ state: "rejected", applied_result: null }), rows).reason, "Not applied: no ad ran to score.");
    assert.equal(judge(add(), rows, new Map([["A", 30]])).reason, "The new ad has no convert score yet.");
    assert.equal(judge(add(), rows, new Map([["P26-BDAY_enzo-4", 50]])).reason, "No other creative in the campaign has a convert score.");
  });
});

describe("P5 scoring: bring back and drop (R6)", () => {
  const back = (extra: Partial<ScoreLine> = {}) => line("bring_back_audience", { target: { adsetId: "s1", adsetIds: ["s1"] }, write: { kind: "adset_status" }, state: "applied", ...extra });
  const drop = (extra: Partial<ScoreLine> = {}) => line("drop_audience", { target: { adsetId: "s1", adsetIds: ["s1"] }, write: { kind: "adset_status" }, ...extra });

  it("a bring-back is right when its cost per result came in under the campaign's (the predicted side)", () => {
    // s1: £40 / 8 = £5 vs the campaign's £100 / 14 ≈ £7.14 → under → right.
    assert.equal(judge(back(), [row({ meta_adset_id: "s9", spend: 60, ic: 6 }), row({ meta_ad_id: "b", meta_adset_id: "s1", spend: 40, ic: 8 })]).outcome, "right");
    assert.equal(judge(back(), [row({ meta_adset_id: "s9", spend: 60, ic: 12 }), row({ meta_ad_id: "b", meta_adset_id: "s1", spend: 40, ic: 2 })]).outcome, "wrong");
    assert.equal(judge(back({ state: "to_review" }), CAMPAIGN).reason, "Not applied: the ad set stayed off, so it has no week to judge.");
  });

  it("a drop not applied kept running: right when it stayed dearer than the campaign; applied, it has no week", () => {
    assert.equal(judge(drop(), [row({ meta_adset_id: "s9", spend: 60, ic: 12 }), row({ meta_ad_id: "b", meta_adset_id: "s1", spend: 40, ic: 2 })]).outcome, "right");
    assert.equal(judge(drop(), [row({ meta_adset_id: "s9", spend: 60, ic: 2 }), row({ meta_ad_id: "b", meta_adset_id: "s1", spend: 40, ic: 10 })]).outcome, "wrong");
    assert.equal(judge(drop({ state: "applied" }), CAMPAIGN).reason, "Dropped: the ad set was off all week, so it has no figures to judge.");
    assert.equal(judge(drop(), [row({ meta_adset_id: "s9" })]).reason, "The ad set didn't spend in the week.");
  });
});

describe("P5 scoring: move (R6)", () => {
  const move = (extra: Partial<ScoreLine> = {}) => line("move_budget", { target: { fromAdsetId: "s9", toAdsetId: "s1" }, evidence: { toCpr: 5 }, state: "applied", ...extra });
  it("right when the receiving side held its cost per result within 20 %", () => {
    assert.equal(judge(move(), [row({ meta_adset_id: "s1", spend: 30, ic: 5 })]).outcome, "right", "£6 ≤ £5 × 1.2");
    assert.equal(judge(move(), [row({ meta_adset_id: "s1", spend: 31, ic: 5 })]).outcome, "wrong", "£6.20 > £6");
    assert.equal(MOVE_HOLD_RATIO, 1.2);
  });
  it("not applied, or applied part-way: unknown", () => {
    assert.equal(judge(move({ state: "rejected" }), CAMPAIGN).reason, "Not applied: the receiving side never had the money, so the move can't be judged.");
    assert.equal(wasApplied({ state: "failed", kind: "move_budget", applied_result: { written: ["s9"] } }), false, "only the giving side moved");
  });
});

describe("P5 scoring: new-ad-set kinds (the record has no rule; flagged for design)", () => {
  const made = (kind: string) => line(kind, { write: { kind: "new_adset" }, state: "applied", applied_result: { adsetId: "new1" } });
  it("right when the new ad set's cost per result is at or below the campaign's after 7 days", () => {
    for (const kind of ["bring_back_audience", "missing_default"]) {
      assert.equal(judge(made(kind), [row({ meta_adset_id: "s9", spend: 60, ic: 6 }), row({ meta_ad_id: "n", meta_adset_id: "new1", spend: 20, ic: 4 })]).outcome, "right", kind);
      assert.equal(judge(made(kind), [row({ meta_adset_id: "s9", spend: 60, ic: 10 }), row({ meta_ad_id: "n", meta_adset_id: "new1", spend: 40, ic: 2 })]).outcome, "wrong", kind);
    }
    assert.equal(judge({ ...made("missing_default"), state: "rejected", applied_result: null }, CAMPAIGN).reason, "Not applied: no new ad set ran.");
  });
});

describe("P5 scoring: never guess", () => {
  it("a claim, a week with no ad-days, and an unknown kind are unknown with a reason", () => {
    assert.equal(judge(line("claim_ready"), CAMPAIGN).outcome, "unknown");
    assert.equal(judge(line("pause_creative", { target: { creative: "Weak" } }), []).reason, "The campaign had no ad-days in the week.");
    assert.equal(judge(line("mystery"), CAMPAIGN).reason, "R6 has no outcome rule for mystery.");
  });
});

// ── The week, due lines, idempotence ─────────────────────────────────────────

describe("P5 scoring: the judged week and which lines are due", () => {
  const proposal: ScoreProposal = { id: "p1", event_id: "e1", user_id: "u1", campaign_key: "On Sale", campaign_ids: ["c1"], run_day: "2026-11-16", window_end: "2026-11-15", objective: IC };
  it("the first full Monday–Sunday week from the proposal's run day, or from Apply", () => {
    assert.deepEqual(judgedWeek(line("pause_creative"), proposal), { from: "2026-11-16", to: "2026-11-22" });
    assert.deepEqual(judgedWeek(line("pause_creative"), { run_day: "2026-11-12" }), { from: "2026-11-16", to: "2026-11-22" }, "a Thursday shadow run is judged on the next full week");
    assert.deepEqual(judgedWeek(line("add_creative", { state: "applied", applied_at: "2026-11-18T09:00:00Z" }), proposal), { from: "2026-11-23", to: "2026-11-29" });
  });

  it("due once the week's last day is in ad_daily_insights; a right / wrong is never re-judged; an unknown is retried for 14 days", () => {
    const proposals = new Map([["p1", proposal]]);
    const l = line("pause_creative");
    assert.equal(dueLines([l], proposals, new Map(), "2026-11-21", "2026-11-25").length, 0, "the week isn't complete");
    assert.equal(dueLines([l], proposals, new Map(), "2026-11-22", "2026-11-25").length, 1);
    assert.equal(dueLines([l], proposals, new Map([[l.id, { line_id: l.id, outcome: "right", week_to: "2026-11-22" }]]), "2026-11-30", "2026-11-30").length, 0);
    assert.equal(dueLines([l], proposals, new Map([[l.id, { line_id: l.id, outcome: "unknown", week_to: "2026-11-22" }]]), "2026-11-30", "2026-12-06").length, 1);
    assert.equal(dueLines([l], proposals, new Map([[l.id, { line_id: l.id, outcome: "unknown", week_to: "2026-11-22" }]]), "2026-12-10", "2026-12-07").length, 0, "past the 14 days");
  });

  it("scoreOnsaleRefresh writes one row per line, and re-scoring never adds a second", async () => {
    const mem = memoryDb({
      ad_daily_insights: [
        { meta_ad_id: "x1", meta_adset_id: "s9", meta_campaign_id: "c1", date: "2026-11-17", ad_name: "Other", spend: 60, landing_page_views: 0, actions: [{ action_type: "omni_initiated_checkout", value: 6 }] },
        { meta_ad_id: "x2", meta_adset_id: "s1", meta_campaign_id: "c1", date: "2026-11-22", ad_name: "Weak", spend: 40, landing_page_views: 0, actions: [{ action_type: "omni_initiated_checkout", value: 2 }] },
      ],
      onsale_refresh_proposals: [proposal],
      onsale_refresh_lines: [line("pause_creative", { target: { creative: "Weak" }, evidence: { campaignCpr: 12, cprRatio: 1.8 } }), line("claim_ready")],
      onsale_refresh_outcomes: [],
      events: [{ id: "e1", client_id: "client-a" }],
      creative_scores: [],
    });
    const first = await scoreOnsaleRefresh(mem.db, { now: new Date("2026-11-25T03:30:00Z") });
    assert.deepEqual([first.scored, first.right, first.unknown], [2, 1, 1]);
    const outcomes = mem.tables.onsale_refresh_outcomes!;
    assert.equal(outcomes.length, 2);
    const pause = outcomes.find((r) => r.kind === "pause_creative")!;
    assert.deepEqual([pause.outcome, pause.week_from, pause.week_to, pause.client_id, pause.rule_id, pause.applied], ["right", "2026-11-16", "2026-11-22", "client-a", "pause_creative.rule", false]);
    // The unknown claim is retried within 14 days; the pause isn't re-judged. Either way, one row per line.
    await scoreOnsaleRefresh(mem.db, { now: new Date("2026-11-26T03:30:00Z") });
    await scoreOnsaleRefresh(mem.db, { now: new Date("2026-11-27T03:30:00Z") });
    assert.equal(mem.tables.onsale_refresh_outcomes!.length, 2);
    assert.equal(new Set(mem.tables.onsale_refresh_outcomes!.map((r) => r.line_id)).size, 2);
  });

  it("a dry run judges and writes nothing; with no ad-days at all nothing is due", async () => {
    const mem = memoryDb({ ad_daily_insights: [], onsale_refresh_proposals: [proposal], onsale_refresh_lines: [line("pause_creative")], onsale_refresh_outcomes: [] });
    assert.equal((await scoreOnsaleRefresh(mem.db, { now: new Date("2026-11-25T03:30:00Z") })).scored, 0);
    assert.equal(mem.writes.length, 0);
  });
});

// ── Track record ─────────────────────────────────────────────────────────────

const outcomes = (client: string, rule: string, right: number, wrong: number, unknown = 0) => [
  ...Array.from({ length: right }, () => ({ client_id: client, rule_id: rule, outcome: "right" })),
  ...Array.from({ length: wrong }, () => ({ client_id: client, rule_id: rule, outcome: "wrong" })),
  ...Array.from({ length: unknown }, () => ({ client_id: client, rule_id: rule, outcome: "unknown" })),
];

describe("P5 track record: per rule × client (R6)", () => {
  it("used from 10 judged outcomes; unknown doesn't count", () => {
    const nine = computeTrackRecords(outcomes("c", "r", 1, 8, 50)).get(trackKey("c", "r"))!;
    assert.deepEqual([nine.judged, nine.rate, nine.state], [9, null, "ok"], "9 judged, however many unknowns: not used");
    assert.equal(MIN_JUDGED, 10);
  });

  it("under 40 % from 10: low; at 40 %: ok", () => {
    assert.equal(computeTrackRecords(outcomes("c", "r", 3, 7)).get(trackKey("c", "r"))!.state, "low");
    assert.equal(computeTrackRecords(outcomes("c", "r", 4, 6)).get(trackKey("c", "r"))!.state, "ok");
  });

  it("under 25 % over 20: stopped; under 25 % over 19 is only low", () => {
    const stopped = computeTrackRecords(outcomes("c", "r", 4, 17)).get(trackKey("c", "r"))!;
    assert.deepEqual([stopped.state, stopped.stoppedBy, stopped.judged], ["stopped", "rate", 21]);
    assert.equal(computeTrackRecords(outcomes("c", "r", 4, 15)).get(trackKey("c", "r"))!.state, "low", "19 judged");
    assert.equal(computeTrackRecords(outcomes("c", "r", 4, 16)).get(trackKey("c", "r"))!.state, "stopped", "20 judged, 20 %");
    assert.equal(computeTrackRecords(outcomes("c", "r", 5, 15)).get(trackKey("c", "r"))!.state, "low", "20 judged at exactly 25 % isn't under 25 %");
    assert.equal(STOP_JUDGED, 20);
  });

  it("records are per client: one client's misses don't touch another's", () => {
    const records = computeTrackRecords([...outcomes("c1", "r", 0, 20), ...outcomes("c2", "r", 15, 5)]);
    assert.equal(records.get(trackKey("c1", "r"))!.state, "stopped");
    assert.equal(records.get(trackKey("c2", "r"))!.state, "ok");
  });

  it("a rejection streak: the same reason 5 times in a row stops the rule; 4, mixed reasons or an accept in between don't", () => {
    const decided = (states: [string, string | null][]) => states.map(([state, reason], i) => ({ client_id: "c", rule_id: "r", state, reject_reason: reason, decided_at: `2026-11-${String(10 + i).padStart(2, "0")}T09:00:00Z` }));
    const streak = computeTrackRecords([], decided([["accepted", null], ...Array.from({ length: 5 }, () => ["rejected", "too_early"] as [string, string])])).get(trackKey("c", "r"))!;
    assert.deepEqual([streak.state, streak.stoppedBy, streak.streakReason], ["stopped", "streak", "too_early"]);
    assert.equal(computeTrackRecords([], decided(Array.from({ length: 4 }, () => ["rejected", "too_early"] as [string, string]))).get(trackKey("c", "r")), undefined);
    assert.equal(computeTrackRecords([], decided([["rejected", "too_early"], ["rejected", "too_early"], ["rejected", "wrong_creative"], ["rejected", "too_early"], ["rejected", "too_early"]])).get(trackKey("c", "r")), undefined);
    assert.equal(computeTrackRecords([], decided([["rejected", "too_early"], ["rejected", "too_early"], ["rejected", "too_early"], ["accepted", null], ["rejected", "too_early"], ["rejected", "too_early"]])).get(trackKey("c", "r")), undefined, "the last five include an accept");
    assert.equal(REJECT_STREAK, 5);
  });

  it("the record's words, and the proposed stop sentences (OR10's)", () => {
    assert.equal(LOW_TRACK_RECORD, "low track record");
    assert.equal(stoppedText("pause.significant_bottom_third", { right: 4, wrong: 17, judged: 21, rate: 4 / 21, state: "stopped", stoppedBy: "rate" }), OR10_STOPPED[0]!.text);
    assert.equal(stoppedText("bring_back.client_cluster", { right: 0, wrong: 0, judged: 0, rate: null, state: "stopped", stoppedBy: "streak", streakReason: "too_early" }), OR10_STOPPED[1]!.text);
  });
});

// ── The generator reads them; off is today's ─────────────────────────────────

function input(overrides: Partial<CampaignInput> = {}): CampaignInput {
  const set = (adsetId: string, name: string, weekSpend: number, weekResults: number) => ({ adsetId, adsetIds: [adsetId], name, firstDay: "2026-10-30", lastDay: "2026-11-11", weekSpend, weekResults, totalSpend: weekSpend * 2, totalResults: weekResults * 2, delivering: true });
  return {
    eventId: "e1",
    eventCode: "P26-BDAY",
    eventName: "Puzzle",
    campaignKey: "On Sale",
    campaignIds: ["c1"],
    clientId: "client-a",
    adAccountId: "act_9",
    draft: { draftId: "d1", adAccountId: "act_9", copy: null, budgetLevel: "ad_set" },
    onSaleDay: "2026-10-30",
    plan: planRun({ day: "2026-11-16", eventDate: "2026-12-27", config: ONSALE_PHASE, shadow: false }),
    resultEvent: IC,
    weekSpend: 214,
    weekResults: 26,
    totalSpend: 650,
    totalResults: 75,
    totalFirstDay: "2026-10-30",
    ads: [],
    adSets: [set("s1", "Lineup — Primary", 70, 4), set("s2", "Adv+", 41, 7), set("s3", "Retargeting", 30, 5), set("s4", "1% LL", 30, 5)],
    clusters: [],
    supply: [],
    claims: [],
    budgetGbp: 4500,
    spendToDateGbp: 1994.15,
    ticketingLinked: false,
    ticketingProvider: null,
    last14: { ic: 99, purchases: 1, lpv: 0 },
    sinceOnSale: { ic: 75, purchases: 1, fromDay: "2026-10-30" },
    ...overrides,
  };
}

describe("P5 generator: track records order and filter; with scoring off, today's proposal exactly", () => {
  it("no records → the same proposal, byte for byte", () => {
    const today = buildProposal(input(), ONSALE_PHASE);
    assert.equal(JSON.stringify(buildProposal(input(), ONSALE_PHASE, undefined)), JSON.stringify(today));
    assert.equal(JSON.stringify(buildProposal(input(), ONSALE_PHASE, new Map())), JSON.stringify(today), "on, with no record yet: also unchanged");
    assert.ok(!("stopped" in today.notes));
  });

  it("a stopped rule proposes nothing and the notes say so; a low one sorts last and is marked", () => {
    const today = buildProposal(input(), ONSALE_PHASE);
    const move = today.lines.find((l) => l.kind === "move_budget")!;
    assert.ok(move, "the fixture proposes a move");
    const firstRule = today.lines[0]!.ruleId;
    const records = computeTrackRecords([...outcomes("client-a", move.ruleId, 3, 7), ...outcomes("client-a", firstRule, 2, 18)]);
    const tracked = buildProposal(input(), ONSALE_PHASE, records);
    assert.ok(!tracked.lines.some((l) => l.ruleId === firstRule), "stopped");
    assert.deepEqual(tracked.notes.stopped?.map((s) => s.ruleId), [firstRule]);
    assert.equal(tracked.lines.at(-1)!.ruleId, move.ruleId, "low sorts last");
    assert.deepEqual(tracked.lines.at(-1)!.trackRecord, { state: "low", right: 3, judged: 10, rate: 0.3 });
    assert.deepEqual((tracked.lines.at(-1)!.evidence as { trackRecord: unknown }).trackRecord, { state: "low", right: 3, judged: 10, rate: 0.3 }, "kept with the line's evidence");
    // Another client's record leaves this client's proposal alone.
    assert.equal(JSON.stringify(buildProposal(input({ clientId: "client-b" }), ONSALE_PHASE, records)), JSON.stringify(buildProposal(input({ clientId: "client-b" }), ONSALE_PHASE)));
  });

  it("applyTrackRecords keeps the order of the lines it doesn't touch", () => {
    const lines = ["a", "b", "c", "d"].map((ruleId) => ({ ruleId, evidence: {} }) as unknown as ProposalLine);
    const records = computeTrackRecords(outcomes("x", "b", 1, 9));
    assert.deepEqual(applyTrackRecords(lines, "x", records).lines.map((l) => l.ruleId), ["a", "c", "d", "b"]);
    assert.deepEqual(applyTrackRecords(lines, "x", undefined), { lines, stopped: null });
  });

  it("the run reads track records only while ENABLE_ONSALE_REFRESH_SCORING is \"1\"", async () => {
    const event = { id: "e1", name: "Puzzle", event_code: "P26-BDAY", event_date: "2026-12-27", general_sale_at: "2026-10-30T12:00:00Z", status: "on_sale", client_id: "client-a", budget_marketing: 4500, drive_folder_id: "f" };
    let reads = 0;
    const loaders = {
      events: async () => [event],
      insights: async () => ({ rows: [], context: { launchedAds: new Map(), launchedAdSets: new Map(), codedEvents: [] } }),
      aux: async () => ({ scores: [], clusters: [], launchedAdSets: [], warnings: [], ticketing: [], driveFolders: [], renderDriveIds: new Set<string>() }),
      purchases: async () => ({ reads: new Map(), metaCalls: 0, cirqlinReads: 0, notes: [] }),
      inputs: async () => ({ event, plan: input().plan, campaigns: [input()], driveCalls: 0, driveReason: null }),
      trackRecords: async () => ((reads += 1), computeTrackRecords(outcomes("client-a", "move.within_campaign", 0, 25))),
    } as unknown as NonNullable<RunRefreshInput["loaders"]>;
    const off = await runOnsaleRefresh({ env: {}, db: fakeDb(() => ({ data: [], error: null })).db, dryRun: true, shadowDay: "2026-11-16", loaders });
    assert.equal(reads, 0);
    const on = await runOnsaleRefresh({ env: { ENABLE_ONSALE_REFRESH_SCORING: "1" }, db: fakeDb(() => ({ data: [], error: null })).db, dryRun: true, shadowDay: "2026-11-16", loaders });
    assert.equal(reads, 1);
    if ("skippedReason" in off || "skippedReason" in on) throw new Error("dry runs");
    assert.ok(off.proposals[0]!.proposal.lines.some((l) => l.ruleId === "move.within_campaign"));
    assert.ok(!on.proposals[0]!.proposal.lines.some((l) => l.ruleId === "move.within_campaign"), "stopped while on");
    assert.equal(isScoringEnabled({ ENABLE_ONSALE_REFRESH_SCORING: "true" }), false, "exactly \"1\"");
  });
});

// ── learning-refresh wiring ──────────────────────────────────────────────────

function learningInputs(): LearningInputs {
  return {
    clients: CLIENTS,
    shows: new Map(),
    archivedClientIds: new Set(["client-archived"]),
    facts: [fact({ meta_ad_id: "a1", meta_adset_id: "s1", ad_name: "Motion 1", spend: 10, registrations: 5, impressions: 100, reach: 80, link_clicks: 4, landing_page_views: 3 }, { clientId: "client-a", eventId: "e1", tagIds: ["t-motion"] })],
    dropped: { noClient: 0, archived: 0 },
    adSets: [{ meta_adset_id: "s1", client_id: "client-a", event_id: "e1", phase_at_launch: null, interest_ids: ["1"] }],
    tags: TAGS,
    currency: currencyResolver(new Map()),
  };
}

describe("P5 learning-refresh: the scoring job", () => {
  const db = () => fakeDb((call) => (call.table === "interest_clusters" ? { data: [{ id: "k1", name: "One", interests: [{ id: "1" }] }], error: null } : { data: [], error: null })).db;

  it("off: not run, no entry, the seven jobs as today", async () => {
    let called = 0;
    const result = await runLearningRefresh({ env: { ENABLE_LEARNING_REFRESH: "1" }, db: db(), now: NOW, operatorUserId: "op", inputs: learningInputs(), confirm: null, scoreRefresh: async () => ((called += 1), { scored: 0, right: 0, wrong: 0, unknown: 0, due: 0, latestDay: null, rows: [] }) });
    if ("skippedReason" in result) throw new Error("on");
    assert.equal(called, 0);
    assert.deepEqual(Object.keys(result.jobs), [...LEARNING_JOBS]);
  });

  it("on: runs after the others and logs its rows", async () => {
    const result = await runLearningRefresh({ env: { ENABLE_LEARNING_REFRESH: "1", ENABLE_ONSALE_REFRESH_SCORING: "1" }, db: db(), now: NOW, operatorUserId: "op", inputs: learningInputs(), confirm: null, scoreRefresh: async () => ({ scored: 3, right: 1, wrong: 1, unknown: 1, due: 3, latestDay: "2026-11-22", rows: [] }) });
    if ("skippedReason" in result) throw new Error("on");
    assert.deepEqual(Object.keys(result.jobs), [...LEARNING_JOBS, "onsale_refresh_scoring"]);
    assert.deepEqual(result.jobs.onsale_refresh_scoring, { ok: true, rows: 3, detail: { due: 3, right: 1, wrong: 1, unknown: 1, latestDay: "2026-11-22" } });
  });

  it("a scoring failure doesn't stop the other jobs: they run exactly as with scoring off", async () => {
    const off = await runLearningRefresh({ env: { ENABLE_LEARNING_REFRESH: "1" }, db: db(), now: NOW, operatorUserId: "op", inputs: learningInputs(), confirm: null });
    const failing = await runLearningRefresh({ env: { ENABLE_LEARNING_REFRESH: "1", ENABLE_ONSALE_REFRESH_SCORING: "1" }, db: db(), now: NOW, operatorUserId: "op", inputs: learningInputs(), confirm: null, scoreRefresh: async () => { throw new Error("outcomes table missing"); } });
    if ("skippedReason" in off || "skippedReason" in failing) throw new Error("on");
    for (const name of LEARNING_JOBS) assert.deepEqual(failing.jobs[name], off.jobs[name], name);
    assert.equal(failing.jobs.onsale_refresh_scoring!.ok, false);
    assert.match(failing.jobs.onsale_refresh_scoring!.error ?? "", /outcomes table missing/);
    assert.equal(failing.ok, false);
  });

  it("DB-only: scoring and track records call nothing outside the database", () => {
    for (const file of ["lib/onsale-refresh/scoring.ts", "lib/onsale-refresh/track-record.ts"]) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /graph\.facebook|graphGet|graphPost|\bfetch\(|from "\.\.\/meta\//, file);
    }
  });
});

describe("P5: migration 241", () => {
  it("one outcome per line, right / wrong / unknown, the week judged, owner read RLS, service-role writes", () => {
    const sql = readFileSync("supabase/migrations/241_onsale_refresh_outcomes.sql", "utf8");
    assert.match(sql, /create table if not exists public\.onsale_refresh_outcomes/);
    assert.match(sql, /line_id\s+uuid not null unique references public\.onsale_refresh_lines/);
    assert.match(sql, /check \(outcome in \('right', 'wrong', 'unknown'\)\)/);
    assert.match(sql, /week_from\s+date not null/);
    assert.match(sql, /week_to\s+date not null/);
    assert.match(sql, /figures\s+jsonb/);
    assert.match(sql, /for select using \(auth\.uid\(\) = user_id\)/);
    assert.doesNotMatch(sql, /for (all|insert|update|delete)/i);
  });
});
