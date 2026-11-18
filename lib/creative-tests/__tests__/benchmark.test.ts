/**
 * Creative testing issue 6 (docs/design-record/2026-11-18-creative-testing-6.html):
 * TF5's benchmark, TF6's extension and stop, TF7's words, and HT3's unit tests,
 * on variant pairs (TF8). The panel and the share link draw TF-D.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { tfdExtendedView, tfdStoppedView } from "../../../scripts/plan-frames/variant-pair-fixtures.ts";
import { isBenchmarkCampaign, showBenchmark } from "../benchmark.ts";
import {
  benchmarkApplies,
  benchmarkCell,
  benchmarkFigure,
  benchmarkTail,
  extendedAgainText,
  extendedText,
  readWithBenchmark,
  stoppedBothText,
  stoppedCameDownText,
  type BenchmarkInput,
} from "../benchmark-call.ts";
import type { VariantFigures } from "../fast-call.ts";
import { buildPanel, buildShareCards, type TestInput } from "../panel-view.ts";

const START = "2026-11-18T08:00:00.000Z";
const at = (hours: number) => new Date(Date.parse(START) + hours * 3_600_000).toISOString();
const v = (id: string, spend: number, results: number): VariantFigures => ({ id, label: id === "a" ? "Get Hard · payoff drop" : id === "b" ? "Get Hard · earlier drop" : `Variant ${id}`, spend, results });

function input(hours: number, variants: VariantFigures[], extra: Partial<BenchmarkInput> = {}): BenchmarkInput {
  return { firstDeliveryAt: START, startedAt: START, readAt: at(hours), variants, result: "initiate_checkout", benchmark: 3, extensions: 0, dailyMinor: 100, currency: "GBP", ...extra };
}

describe("TF5: the benchmark", () => {
  it("is the show's main campaigns' summed spend ÷ summed results on the test's event over its days", () => {
    const row = (date: string, name: string, spend: number, ic: number) => ({ date, campaign_name: name, spend, landing_page_views: 0, registrations: 0, actions: ic ? [{ action_type: "omni_initiated_checkout", value: String(ic) }] : [] });
    const rows = [
      row("2026-11-17", "[P26-BDAY] Puzzle - On Sale", 100, 10), // before the test's days
      row("2026-11-18", "[P26-BDAY] Puzzle - On Sale", 30, 10),
      row("2026-11-19", "[P26-BDAY] Puzzle - Lineup", 15, 5),
      row("2026-11-19", "P26-BDAY · Tests", 4, 1),
      row("2026-11-19", "P26-BDAY · AB copy test", 4, 1),
      row("2026-11-19", "[P26-BDAY] Puzzle - 27 Dec - Purchase", 50, 1),
      row("2026-11-19", "P26-BDAY · Retargeting", 20, 1),
      row("2026-11-19", "[P26-BDAY] Retargeting", 20, 1),
    ];
    assert.deepEqual(showBenchmark(rows, { eventCode: "P26-BDAY", result: "initiate_checkout", fromDay: "2026-11-18", toDay: "2026-11-22" }), { cost: 3, spend: 45, results: 15 });
    assert.deepEqual(showBenchmark(rows, { eventCode: "P26-BDAY", result: "complete_registration", fromDay: "2026-11-18", toDay: "2026-11-22" }), { cost: null, spend: 45, results: 0 });
    assert.equal(isBenchmarkCampaign("[P26-BDAY] Puzzle - On Sale", "P26-BDAY"), true);
    assert.equal(isBenchmarkCampaign("P26-BDAY · Tests", "P26-BDAY"), false);
  });

  it("applies to every creative test TF2 calls: CT6's, the clip test and pairs, not the in-place copy test", () => {
    for (const kind of ["tracks", "statics", "together", "clip", "pair"] as const) assert.equal(benchmarkApplies(kind), true, kind);
    assert.equal(benchmarkApplies("copy"), false);
  });
});

describe("TF5 / TF6: the call (HT3)", () => {
  it("a TF2 winner above the benchmark isn't called", () => {
    // £5.00 per checkout: TF2's winner at 71 % of spend (its rival dearer), but above £3.00.
    const r = readWithBenchmark(input(60, [v("a", 15, 3), v("b", 6, 0)]));
    assert.notEqual(r.state, "ready_to_call");
    assert.equal(r.winnerId, null);
    assert.equal(r.text, "Running · 60 h · 71 % of spend on Get Hard · payoff drop");
    assert.equal(readWithBenchmark(input(60, [v("a", 15, 3), v("b", 6, 0)], { benchmark: null })).state, "ready_to_call");
  });

  it("a winner at or under it is", () => {
    // £3.00 per checkout: at the benchmark counts.
    const r = readWithBenchmark(input(60, [v("a", 9, 3), v("b", 4, 0)]));
    assert.equal(r.state, "ready_to_call");
    assert.equal(r.winnerId, "a");
  });

  it("with no benchmark, TF2 decides alone", () => {
    const r = readWithBenchmark(input(60, [v("a", 15, 3), v("b", 6, 0)], { benchmark: null }));
    assert.equal(r.state, "ready_to_call");
    assert.equal(benchmarkTail(null), " · no show benchmark for these days");
  });

  it("day 4, all above: extended to 23:59 London on day 8, holding the daily budget × 4 more", () => {
    const r = readWithBenchmark(input(96, [v("a", 2.52, 0), v("b", 1.48, 0)]));
    assert.equal(r.text, "Extended to 26 Nov: both above the show's £3.00 per checkout");
    assert.deepEqual(r.action, { kind: "extend", extension: 1, endTime: "2026-11-26T23:59:00+0000", endDay: "2026-11-26", extraHoldMinor: 400 });
    assert.equal(r.winnerId, null);
  });

  it("no room in the cap: it stops at day 4 instead", () => {
    const r = readWithBenchmark(input(96, [v("a", 2.52, 0), v("b", 1.48, 0)], { capLeftMinor: 399 }));
    assert.deepEqual(r.action, { kind: "stop", line: "Stopped: both above the show's £3.00 per checkout" });
  });

  it("extended, then won during the extension", () => {
    const r = readWithBenchmark(input(150, [v("a", 8.4, 3), v("b", 3, 0)], { extensions: 1, evidence: { day4: [{ variantId: "a", cost: 5, results: 1 }, { variantId: "b", cost: null, results: 0 }] } }));
    assert.equal(r.state, "ready_to_call");
    assert.equal(r.winnerId, "a");
  });

  it("during the extension the line says so", () => {
    const r = readWithBenchmark(input(120, [v("a", 3, 0), v("b", 2, 0)], { extensions: 1 }));
    assert.equal(r.text, "Extended to 26 Nov: both above the show's £3.00 per checkout");
    assert.equal(r.action.kind, "none");
  });

  it("day 8, neither improved: stopped, Matas's line (the example)", () => {
    const r = readWithBenchmark(input(192, [v("a", 5.04, 0), v("b", 2.96, 0)], { extensions: 1, evidence: { day4: [{ variantId: "a", cost: null, results: 0 }, { variantId: "b", cost: null, results: 0 }] } }));
    assert.deepEqual(r.action, { kind: "stop", line: "Stopped: both above the show's £3.00 per checkout" });
  });

  const day4 = { day4: [{ variantId: "a", cost: 5, results: 1 }, { variantId: "b", cost: 6, results: 1 }] };

  it("day 8, improved 28 % and within 30 %: extended again to day 12 (the worked case, £5.00 → £3.60)", () => {
    const r = readWithBenchmark(input(192, [v("a", 10.8, 3), v("b", 7.2, 1)], { extensions: 1, evidence: day4 }));
    assert.equal(r.text, "Extended again to 30 Nov: Get Hard · payoff drop came down to £3.60, within 30 % of the show's £3.00 per checkout");
    assert.deepEqual(r.action, { kind: "extend", extension: 2, endTime: "2026-11-30T23:59:00+0000", endDay: "2026-11-30", extraHoldMinor: 400 });
  });

  it("day 8, improved but only 16 % and 40 % above (£4.20): stopped with the came-down line", () => {
    const r = readWithBenchmark(input(192, [v("a", 12.6, 3), v("b", 7.2, 1)], { extensions: 1, evidence: day4 }));
    assert.deepEqual(r.action, { kind: "stop", line: "Stopped: Get Hard · payoff drop came down to £4.20, still above the show's £3.00 per checkout" });
  });

  it("day 8, 20 % lower but more than 30 % above: stopped at day 8", () => {
    // £6.00 → £4.00: 33 % lower, 33 % above the benchmark.
    const r = readWithBenchmark(input(192, [v("a", 12, 3), v("b", 7.2, 1)], { extensions: 1, evidence: { day4: [{ variantId: "a", cost: 6, results: 1 }, { variantId: "b", cost: 9, results: 1 }] } }));
    assert.deepEqual(r.action, { kind: "stop", line: stoppedCameDownText("Get Hard · payoff drop", 4, 3, "initiate_checkout", "GBP") });
  });

  it("day 8, within 30 % but under 20 % lower: stopped at day 8", () => {
    // £4.50 → £3.75: 17 % lower, 25 % above.
    const r = readWithBenchmark(input(192, [v("a", 11.25, 3), v("b", 7.2, 1)], { extensions: 1, evidence: { day4: [{ variantId: "a", cost: 4.5, results: 1 }, { variantId: "b", cost: 9, results: 1 }] } }));
    assert.deepEqual(r.action, { kind: "stop", line: stoppedCameDownText("Get Hard · payoff drop", 3.75, 3, "initiate_checkout", "GBP") });
  });

  it("no results at day 4, then within 30 % at day 8: extended again on the 30 % test alone", () => {
    const r = readWithBenchmark(input(192, [v("a", 11.4, 3), v("b", 6, 0)], { extensions: 1, evidence: { day4: [{ variantId: "a", cost: null, results: 0 }, { variantId: "b", cost: null, results: 0 }] } }));
    assert.equal(r.action.kind, "extend");
    assert.equal(r.text, "Extended again to 30 Nov: Get Hard · payoff drop came down to £3.80, within 30 % of the show's £3.00 per checkout");
  });

  it("no room in the cap for the second: stopped at day 8 with the came-down line", () => {
    const r = readWithBenchmark(input(192, [v("a", 10.8, 3), v("b", 7.2, 1)], { extensions: 1, evidence: day4, capLeftMinor: 0 }));
    assert.deepEqual(r.action, { kind: "stop", line: stoppedCameDownText("Get Hard · payoff drop", 3.6, 3, "initiate_checkout", "GBP") });
  });

  const second = { ...day4, day8: [{ variantId: "a", cost: 3.6, results: 3 }], second: { variantId: "a", cost: 3.6 } };

  it("extended twice, the line during the second, then won", () => {
    const during = readWithBenchmark(input(240, [v("a", 14, 4), v("b", 8, 1)], { extensions: 2, evidence: second }));
    assert.equal(during.text, "Extended again to 30 Nov: Get Hard · payoff drop came down to £3.60, within 30 % of the show's £3.00 per checkout");
    const won = readWithBenchmark(input(260, [v("a", 17.5, 6), v("b", 8, 1)], { extensions: 2, evidence: second }));
    assert.equal(won.state, "ready_to_call");
  });

  it("extended twice then stopped at day 12, the most it runs", () => {
    const lower = readWithBenchmark(input(288, [v("a", 16, 5), v("b", 9, 1)], { extensions: 2, evidence: second }));
    assert.deepEqual(lower.action, { kind: "stop", line: "Stopped: Get Hard · payoff drop came down to £3.20, still above the show's £3.00 per checkout" });
    const notLower = readWithBenchmark(input(288, [v("a", 30, 5), v("b", 9, 1)], { extensions: 2, evidence: second }));
    assert.deepEqual(notLower.action, { kind: "stop", line: "Stopped: both above the show's £3.00 per checkout" });
  });

  it("three variants: \"all 3\"", () => {
    const r = readWithBenchmark(input(96, [v("a", 2, 0), v("b", 1.5, 0), v("c", 1.5, 0)]));
    assert.equal(r.text, "Extended to 26 Nov: all 3 above the show's £3.00 per checkout");
    assert.equal(stoppedBothText(3, 3, "initiate_checkout"), "Stopped: all 3 above the show's £3.00 per checkout");
  });
});

describe("TF7: the words", () => {
  it("figures and cells carry the show's benchmark", () => {
    assert.equal(benchmarkFigure(0.84, 3, "initiate_checkout"), "£0.84 per checkout · show £3.00");
    assert.equal(benchmarkFigure(null, 3, "initiate_checkout"), "— per checkout · show £3.00");
    assert.equal(benchmarkFigure(0.84, null, "initiate_checkout"), "£0.84 per checkout");
    assert.equal(benchmarkCell(null, 3), "— · show £3.00");
    assert.equal(extendedText("2026-11-26", 2, 3, "initiate_checkout"), "Extended to 26 Nov: both above the show's £3.00 per checkout");
    assert.equal(extendedAgainText("2026-11-30", "Get Hard · payoff drop", 3.6, 3, "initiate_checkout"), "Extended again to 30 Nov: Get Hard · payoff drop came down to £3.60, within 30 % of the show's £3.00 per checkout");
  });

  it("TF-D 1280: extended at day 4, the rows with \"— · show £3.00\"", () => {
    const card = tfdExtendedView().cards[0]!;
    assert.equal(card.name, "Test 2 · Track pair · Get Hard");
    assert.equal(card.state, "Extended to 26 Nov: both above the show's £3.00 per checkout");
    assert.deepEqual(card.rows.map((r) => [r.label, r.sharePct, r.spend, r.results, r.cost]), [
      ["Get Hard · payoff drop", "63", "£2.52", 0, "— · show £3.00"],
      ["Get Hard · earlier drop", "37", "£1.48", 0, "— · show £3.00"],
    ]);
    assert.equal(card.budgetLine, "In P26-BDAY · Tests · Track pair · 18 Nov · 2 · £1 a day · 10 % of current daily spend (cap £10) · read at day 4, £4.00 spent");
  });

  it("TF-D 393: stopped at day 8", () => {
    const card = tfdStoppedView().cards[0]!;
    assert.equal(card.open, true);
    assert.equal(card.state, "Stopped: both above the show's £3.00 per checkout");
    assert.deepEqual(card.rows.map((r) => r.phone), ["63 % of spend · Get Hard · payoff drop · — per checkout · show £3.00 · 0", "37 % of spend · Get Hard · earlier drop · — per checkout · show £3.00 · 0"]);
  });

  it("the stop line shows on the share link too; CT6's tests take the benchmark, the copy test doesn't", () => {
    const pair: TestInput = { id: "p", n: 1, kind: "pair", format: "video", runs_in: "tests_adset", state: "stopped", result_event: "initiate_checkout", currency: "GBP", daily_budget_minor: 100, budget_pct: 10, at_minimum: false, first_delivery_at: START, winner_variant_id: null, extensions: 1, held: { pair: "track", asset: "Get Hard", windows: [] } };
    const variants = [
      { id: "a", test_id: "p", position: 1, role: "variant" as const, label: "Get Hard · payoff drop", state: "live" },
      { id: "b", test_id: "p", position: 2, role: "variant" as const, label: "Get Hard · earlier drop", state: "live" },
    ];
    const reads = [{ test_id: "p", read_at: at(192), benchmark_cost: 3, variants: [{ variantId: "a", spend: 5.04, results: 0 }, { variantId: "b", spend: 2.96, results: 0 }] }];
    const share = buildShareCards({ tests: [pair], variants, reads, now: at(193) });
    assert.equal(share[0]!.state, "Stopped: both above the show's £3.00 per checkout");
    assert.deepEqual(share[0]!.rows.map((r) => r.cost), ["— · show £3.00", "— · show £3.00"]);
    const tracks = buildPanel({ eventCode: "P26-BDAY", tests: [{ ...pair, kind: "tracks", state: "running", held: {}, extensions: 1 }], variants, reads, now: at(193) });
    assert.equal(tracks.cards[0]!.state, "Stopped: both above the show's £3.00 per checkout");
    assert.match(JSON.stringify(tracks), /show £3\.00/);
    const copy = buildPanel({ eventCode: "P26-BDAY", tests: [{ ...pair, kind: "copy", runs_in: "main_adsets", state: "running", held: {} }], variants, reads, now: at(193) });
    assert.doesNotMatch(JSON.stringify(copy), /show £/);
  });
});
