/**
 * The Test plan panel (CT9, TT6, TF3) and the share link's "What we're
 * testing" (CT11, TT6, TF3) against the records' frames: TF-A, TF-B, TT-D
 * and TF-C.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { TEST_PLAN_FIXTURES, testPlanFixtureView, testPlanShareFixture } from "../../../scripts/plan-frames/test-plan-fixtures.ts";
import { buildPanel, buildShareCards, cardName, headers, shareHeaders, shareRunningText, type TestInput } from "../panel-view.ts";

describe("TF-A: the panel at the 48-hour read", () => {
  const view = testPlanFixtureView("TFA");
  const card = view.cards[0]!;

  it("opens the called test with its winner, budget line and table", () => {
    assert.equal(card.name, "Test 1 · Tracks");
    assert.equal(card.open, true);
    assert.equal(card.state, "Winner: Track two · 66 % of spend · £1.65 per checkout");
    assert.equal(card.budgetLine, "In P26-BDAY · Tests · Video · £10 a day · 6 % of current daily spend (cap £10) · read at 48 h, £20.00 spent");
    assert.equal(card.budgetLineShort, "£10 a day · 6 % of current daily spend (cap £10)");
    assert.deepEqual(card.headers, { results: "Checkouts", cost: "Cost per checkout" });
  });

  it("puts spend share first, sorted, the leader marked; barely served rows say so", () => {
    assert.deepEqual(
      card.rows.map((r) => [r.label, r.sharePct, r.spend, r.results, r.cost, r.leader]),
      [
        ["Track two", "66", "£13.20", 8, "£1.65", true],
        ["Track one", "21", "£4.20", 2, "£2.10", false],
        ["Track five", "9", "£1.80", 1, "Not enough spend to judge", false],
        ["Track three", "4", "£0.80", 0, "Not enough spend to judge", false],
      ],
    );
  });

  it("393: each row starts with the share (TF3)", () => {
    assert.deepEqual(card.rows.map((r) => r.phone), [
      "66 % of spend · Track two · £1.65 per checkout · 8",
      "21 % of spend · Track one · £2.10 per checkout · 2",
      "9 % of spend · Track five · Not enough spend to judge",
      "4 % of spend · Track three · Not enough spend to judge",
    ]);
  });

  it("folds the waiting tests to one line", () => {
    assert.equal(view.cards[1]!.open, false);
    assert.equal(view.cards[1]!.folded, "Test 2 · Statics · Waiting for Test 1's statics");
    assert.equal(view.cards[2]!.folded, "Test 3 · Together · Waiting for Test 2");
    assert.equal(view.chip, null);
  });
});

describe("TF-B: no clear winner at Meta's minimum", () => {
  const card = testPlanFixtureView("TFB").cards[0]!;

  it("reads the record's words and offers the pause line", () => {
    assert.equal(card.name, "Test 1 · Statics");
    assert.equal(card.state, "No clear winner by day 4");
    assert.equal(card.budgetLineShort, "£1.00 a day · 15 % of current daily spend (cap £10) · Meta's minimum");
    assert.deepEqual(card.rows.map((r) => r.phone), [
      "48 % of spend · Static A · £0.48 per signup · 4",
      "41 % of spend · Static B · £0.41 per signup · 4",
      "11 % of spend · Static C · £0.44 per signup · 1",
    ]);
    assert.deepEqual(card.pause, { title: "Pause NX26-LOCKLEAD · Tests · Statics", detail: "Test 1 had no clear winner" });
  });
});

describe("TT-D: a rights mute mid-test, with TF2's words and TF4's sums", () => {
  const view = testPlanFixtureView("TTD");
  const card = view.cards[0]!;

  it("takes the muted variant out of the share sums and says so on its row", () => {
    assert.equal(card.open, true);
    assert.equal(card.state, "Running · 72 h · 59 % of spend on Track two");
    assert.deepEqual(card.rows.map((r) => r.phone), [
      "59 % of spend · Track two · £1.81 per checkout · 24",
      "41 % of spend · Track one · £2.30 per checkout · 13",
      "Track six · Meta muted the audio (rights) · paused, out of the test",
    ]);
    assert.equal(card.rows[2]!.cost, "Meta muted the audio (rights)");
    assert.equal(view.chip, "Test 1 running");
  });
});

describe("TF-C: the share link, figures only", () => {
  const cards = testPlanShareFixture();

  it("shows the name, the winner by cost, and results and cost per result", () => {
    assert.equal(cards.length, 1);
    assert.equal(cards[0]!.name, "Test 1 · Tracks");
    assert.equal(cards[0]!.state, "Winner: Track two · £1.65 per checkout");
    assert.deepEqual(cards[0]!.headers, { variant: "Track", results: "Checkouts", cost: "Per checkout" });
    assert.deepEqual(cards[0]!.rows.map((r) => [r.label, r.results, r.cost]), [
      ["Track two", 8, "£1.65"],
      ["Track one", 2, "£2.10"],
      ["Track five", null, "Not enough spend to judge"],
      ["Track three", null, "Not enough spend to judge"],
    ]);
  });

  it("never carries spend share, spend, budgets, lines or calling", () => {
    const json = JSON.stringify(cards);
    assert.doesNotMatch(json, /share|of spend|spent|£\d+ a day|budget|Pause|Promote|Call the winner|Ready to call|Meta favours|%/i);
    for (const card of cards) {
      assert.deepEqual(Object.keys(card).sort(), ["headers", "id", "name", "rows", "state"]);
      for (const row of card.rows) assert.deepEqual(Object.keys(row).sort(), ["cost", "id", "label", "results"]);
    }
  });

  it("muted rows read Audio muted by Meta; tests not started are left out; running lines drop the share", () => {
    const f = TEST_PLAN_FIXTURES.TTD;
    const share = buildShareCards({ tests: [...f.tests], variants: [...f.variants], reads: [...f.reads], now: f.now });
    assert.equal(share[0]!.state, "Running · 72 h");
    assert.equal(share[0]!.rows[2]!.cost, "Audio muted by Meta");
    assert.equal(shareRunningText(49.9), "Running · 49 h");
    const a = TEST_PLAN_FIXTURES.TFA;
    assert.equal(buildShareCards({ tests: [...a.tests], variants: [...a.variants], reads: [...a.reads], now: a.now }).length, 1);
  });

  it("the share section's component and loader never import spend share or the panel's table", () => {
    const component = readFileSync(path.join(process.cwd(), "components/dashboard/creative-section/what-we-are-testing.tsx"), "utf8");
    assert.doesNotMatch(component, /sharePct|budgetLine|pause|PanelCard/);
    const loader = readFileSync(path.join(process.cwd(), "lib/dashboard/creative-section-server.ts"), "utf8");
    assert.match(loader, /surface === "share" \? await loadTestInputs/);
  });
});

describe("CT9 / CT12: names, headers, chip", () => {
  it("names a copy test by what it compares (CT-D)", () => {
    assert.equal(cardName({ n: 1, kind: "copy", runs_in: "main_adsets" }, ["Artist voice", "venue voice"]), "Copy · Artist voice vs venue voice");
    assert.equal(cardName({ n: 2, kind: "statics", runs_in: "tests_adset" }, []), "Test 2 · Statics");
  });

  it("headers follow the result", () => {
    assert.deepEqual(headers("landing_page_view"), { results: "Landing-page views", cost: "Cost per landing-page view" });
    assert.deepEqual(shareHeaders("statics", "complete_registration"), { variant: "Static", results: "Signups", cost: "Per signup" });
  });

  it("the chip reads Test {n} ready to call when the read finds a winner", () => {
    const f = TEST_PLAN_FIXTURES.TFA;
    const running: TestInput[] = f.tests.map((t) => (t.n === 1 ? { ...t, state: "running", winner_variant_id: null } : t));
    const view = buildPanel({ eventCode: "P26-BDAY", tests: running, variants: [...f.variants], reads: [...f.reads], now: f.now });
    assert.equal(view.chip, "Test 1 ready to call");
    assert.equal(view.cards[0]!.state, "Ready to call");
  });

  it("an event with no plan has no cards and no chip", () => {
    assert.deepEqual(buildPanel({ eventCode: "P26-BDAY", tests: [], variants: [], reads: [], now: "2026-11-17T08:00:00Z" }), { cards: [], chip: null });
  });

  it("a running test with no read yet waits for the 48-hour read", () => {
    const f = TEST_PLAN_FIXTURES.TTD;
    const view = buildPanel({ eventCode: "P26-BDAY", tests: [...f.tests], variants: [...f.variants], reads: [], now: "2026-11-17T20:00:00Z" });
    assert.equal(view.cards[0]!.state, "Running · first read at 48 h");
  });
});
