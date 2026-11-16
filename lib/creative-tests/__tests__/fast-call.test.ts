/**
 * TF2 (docs/design-record/2026-11-16-creative-testing-3.html): the fast
 * call, with TF4's mute rule and TT5's end. TF-A and TF-B are the record's
 * expected figures.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TF2, compareWithLeader, hoursSince, isLondonReadHour, londonDay, readTest, shareRows, sortByShare, type VariantFigures } from "../fast-call.ts";
import { phoneRow, pct, shareWinnerText, winnerText } from "../words.ts";

const START = "2026-11-17T08:00:00.000Z";
const at = (hours: number) => new Date(Date.parse(START) + hours * 3_600_000).toISOString();
const v = (id: string, spend: number, results: number, muted = false): VariantFigures => ({ id, label: id, spend, results, muted });
const read = (hours: number, variants: VariantFigures[]) => readTest({ firstDeliveryAt: START, readAt: at(hours), variants, result: "initiate_checkout" });

const TF_A = [v("Track two", 13.2, 8), v("Track one", 4.2, 2), v("Track five", 1.8, 1), v("Track three", 0.8, 0)];
const TF_B = [v("Static A", 1.92, 4), v("Static B", 1.64, 4), v("Static C", 0.44, 1)];

describe("TF2: shares", () => {
  it("TF-A at 48 h: £20.00 = 66 %, 21 %, 9 %, 4 %", () => {
    const { rows, total } = shareRows(TF_A);
    assert.equal(total, 20);
    assert.deepEqual(rows.map((r) => pct(r.share!)), ["66", "21", "9", "4"]);
    assert.deepEqual(rows.map((r) => r.judged), [true, true, false, false]);
  });

  it("TF4: a muted variant leaves the share sums from the moment it's paused", () => {
    const { rows, total } = shareRows([v("A", 43.44, 24), v("B", 29.9, 13), v("C", 10.66, 0, true)]);
    assert.equal(total, 73.34);
    assert.equal(rows[2]!.share, null);
    assert.equal(rows[2]!.judged, false);
    assert.equal(Math.round((rows[0]!.share! + rows[1]!.share!) * 1000) / 1000, 1);
  });

  it("TF3: rows by spend share, muted last", () => {
    const { rows } = shareRows([v("low", 1, 0), v("muted", 50, 0, true), v("high", 9, 3)]);
    assert.deepEqual(sortByShare(rows).map((r) => r.id), ["high", "low", "muted"]);
  });
});

describe("TF2: the call", () => {
  it("TF-A: a winner at the 48-hour read (66 %, 8 checkouts, £1.65 ≤ Track one's £2.10)", () => {
    const r = read(48, TF_A);
    assert.equal(r.state, "ready_to_call");
    assert.equal(r.text, "Ready to call");
    assert.equal(r.winnerId, "Track two");
    const winner = r.variants.find((x) => x.id === r.winnerId)!;
    assert.equal(winnerText(winner.label, pct(winner.share!), winner.cost!, "initiate_checkout"), "Winner: Track two · 66 % of spend · £1.65 per checkout");
    assert.equal(shareWinnerText(winner.label, winner.cost!, "initiate_checkout"), "Winner: Track two · £1.65 per checkout");
  });

  it("nothing can be called before 48 hours", () => {
    for (const hours of [0, 12, 47.9]) {
      const r = read(hours, TF_A);
      assert.equal(r.state, "first_read_pending");
      assert.equal(r.text, "Running · first read at 48 h");
      assert.equal(r.winnerId, null);
    }
    assert.equal(readTest({ firstDeliveryAt: null, readAt: at(60), variants: TF_A, result: "initiate_checkout" }).text, "Running · first read at 48 h");
  });

  it("a win needs 60 % of the spend", () => {
    const r = read(50, [v("A", 11.8, 8), v("B", 8.2, 2)]);
    assert.equal(r.state, "running");
    assert.equal(r.text, "Running · 50 h · 59 % of spend on A");
    assert.equal(read(50, [v("A", 12, 8), v("B", 8, 2)]).state, "ready_to_call");
  });

  it("a win needs 3 results", () => {
    assert.equal(read(72, [v("A", 15, 2), v("B", 5, 1)]).state, "running");
    assert.equal(read(72, [v("A", 15, 3), v("B", 5, 1)]).state, "ready_to_call");
  });

  it("Meta's favourite costs more: nothing wins, and the line names the cheaper variant", () => {
    const r = read(72, [v("Track two", 14, 4), v("Track one", 6, 3)]);
    assert.equal(r.state, "meta_favours");
    assert.equal(r.text, "Running · Meta favours Track two (70 % of spend), but Track one is cheaper per checkout");
    assert.equal(r.cheaperId, "Track one");
    assert.equal(r.winnerId, null);
  });

  it("names the cheapest when more than one judged variant is cheaper", () => {
    const r = read(72, [v("A", 13, 3), v("B", 3, 2), v("C", 4, 4)]);
    assert.equal(r.state, "meta_favours");
    assert.equal(r.cheaperId, "C");
  });

  it("a variant under 10 % is never compared on cost, so a cheap barely-served one doesn't block the win", () => {
    const r = read(48, [v("A", 18.2, 5), v("B", 1.8, 9)]);
    assert.equal(r.state, "ready_to_call");
    assert.equal(r.variants[1]!.judged, false);
    assert.equal(phoneRow({ label: "B", sharePct: "9", judged: false, muted: false, cost: 0.2, results: 9 }, "initiate_checkout"), "9 % of spend · B · Not enough spend to judge");
  });

  it("a judged variant with no results is worse once its spend passes the leader's cost per result", () => {
    assert.equal(compareWithLeader(1.5, { id: "x", label: "x", spend: 1.6, results: 0, share: 0.3, judged: true, cost: null }), "worse");
    assert.equal(compareWithLeader(1.5, { id: "x", label: "x", spend: 1.4, results: 0, share: 0.3, judged: true, cost: null }), "unknown");
    // Leader £13 / 8 = £1.625; B spent £7 with nothing: worse, so A wins.
    assert.equal(read(48, [v("A", 13, 8), v("B", 7, 0)]).state, "ready_to_call");
    // Leader £48 / 4 = £12; B spent £12 with nothing, not past £12: its cost is unknown, so nothing wins yet.
    const unknown = read(48, [v("A", 48, 4), v("B", 12, 0)]);
    assert.equal(unknown.state, "running");
    assert.equal(unknown.winnerId, null);
  });

  it("a cost equal to the leader's isn't cheaper, so the leader wins", () => {
    assert.equal(read(48, [v("A", 12, 6), v("B", 8, 4)]).state, "ready_to_call");
  });

  it("TF-B: no variant has 60 % by day 4 → No clear winner by day 4, and the test ends", () => {
    const r = read(96, TF_B);
    assert.deepEqual(r.variants.map((x) => pct(x.share!)), ["48", "41", "11"]);
    assert.equal(r.state, "no_clear_winner");
    assert.equal(r.text, "No clear winner by day 4");
    assert.equal(r.ends, true);
    assert.equal(r.winnerId, null);
  });

  it("day 4 is the first read at or after 96 hours; a winner at that read still wins", () => {
    assert.equal(read(95, TF_B).state, "running");
    assert.equal(read(110, TF_B).state, "no_clear_winner");
    assert.equal(read(100, TF_A).state, "ready_to_call");
    assert.equal(read(100, [v("Track two", 14, 4), v("Track one", 6, 3)]).state, "no_clear_winner");
  });

  it("TT5: fewer than 2 variants left ends the test", () => {
    const r = read(60, [v("A", 20, 5), v("B", 10, 2, true)]);
    assert.equal(r.state, "not_enough_variants");
    assert.equal(r.text, "Not enough variants left to test.");
    assert.equal(r.ends, true);
  });

  it("the phone rows (TF3, TT-D)", () => {
    assert.equal(phoneRow({ label: "Track two", sharePct: "66", judged: true, muted: false, cost: 1.65, results: 8 }, "initiate_checkout"), "66 % of spend · Track two · £1.65 per checkout · 8");
    assert.equal(phoneRow({ label: "Track six", sharePct: null, judged: false, muted: true, cost: null, results: 0 }, "initiate_checkout"), "Track six · Meta muted the audio (rights) · paused, out of the test");
    assert.equal(phoneRow({ label: "Static A", sharePct: "48", judged: true, muted: false, cost: 0.48, results: 4 }, "complete_registration"), "48 % of spend · Static A · £0.48 per signup · 4");
  });
});

describe("TF2: the 08:00 London read", () => {
  it("acts only at 08:00 London: 08:00 UTC in winter, 07:00 UTC in summer", () => {
    assert.equal(isLondonReadHour("2026-11-17T08:00:00Z"), true);
    assert.equal(isLondonReadHour("2026-11-17T07:00:00Z"), false);
    assert.equal(isLondonReadHour("2027-06-15T07:00:00Z"), true);
    assert.equal(isLondonReadHour("2027-06-15T08:00:00Z"), false);
    assert.equal(TF2.readHourLondon, 8);
  });

  it("read days and hours", () => {
    assert.equal(londonDay("2027-06-15T23:30:00Z"), "2027-06-16");
    assert.equal(hoursSince(START, at(49.5)), 49.5);
    assert.equal(hoursSince(null, at(1)), null);
  });
});
