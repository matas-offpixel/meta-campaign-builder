/**
 * CT6 / TT1 / CT12: a plan's order, one test at a time per test ad set,
 * Test 3's control, the canvas chip, and the names.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COPY_PLAN, DEFAULT_PLAN, canApprove, canvasChip, chooseControl, openTest, variantCountOk, type TestRow } from "../plan.ts";
import { KIND_NAME, promoteEvidenceText, testAdSetName, testName, testsCampaignName, waitingForStaticsText } from "../words.ts";

const t = (n: number, state: TestRow["state"], extra: Partial<TestRow> = {}): TestRow => ({ id: `t${n}`, n, kind: "tracks", format: "video", runsIn: "tests_adset", state, ...extra });

describe("CT6 / TT1: the plan", () => {
  it("the default plan is Tracks, Statics, Together, all in the Video ad set", () => {
    assert.deepEqual(DEFAULT_PLAN.map((p) => testName(p.n, p.kind)), ["Test 1 · Tracks", "Test 2 · Statics", "Test 3 · Together"]);
    assert.ok(DEFAULT_PLAN.every((p) => p.format === "video" && p.runsIn === "tests_adset"));
  });

  it("CT12: the copy test is one test, measured in place in the main ad sets", () => {
    assert.equal(COPY_PLAN.length, 1);
    assert.equal(COPY_PLAN[0]!.kind, "copy");
    assert.equal(COPY_PLAN[0]!.runsIn, "main_adsets");
    assert.equal(KIND_NAME.copy, "Copy");
  });

  it("names: the Tests campaign and its two ad sets", () => {
    assert.equal(testsCampaignName("P26-BDAY"), "P26-BDAY · Tests");
    assert.equal(testAdSetName("P26-BDAY", "video"), "P26-BDAY · Tests · Video");
    assert.equal(testAdSetName("NX26-LOCKLEAD", "statics"), "NX26-LOCKLEAD · Tests · Statics");
  });

  it("variants: 2 to 5 tracks or statics; Test 3 is the winner and the control", () => {
    assert.equal(variantCountOk("tracks", 1), false);
    assert.equal(variantCountOk("tracks", 5), true);
    assert.equal(variantCountOk("statics", 6), false);
    assert.equal(variantCountOk("together", 2), true);
    assert.equal(variantCountOk("together", 3), false);
  });
});

describe("TT1: one test at a time per test ad set", () => {
  it("a test waits for the one before it", () => {
    assert.deepEqual(canApprove([t(1, "running"), t(2, "making")], 2), { ok: false, text: "Waiting for Test 1" });
    assert.deepEqual(canApprove([t(1, "called"), t(2, "making")], 2), { ok: true });
  });

  it("plan order comes first: a later test waits for the open one before it", () => {
    const tests = [t(1, "called"), t(2, "running", { id: "video-running" }), t(3, "making", { kind: "statics", format: "statics" })];
    // Test 3 is behind Test 2 in the plan, so it waits on order first.
    assert.deepEqual(canApprove(tests, 3), { ok: false, text: "Waiting for Test 2" });
  });

  it("an approved (paused) test holds its ad set too", () => {
    const tests: TestRow[] = [t(1, "approved", { id: "a", n: 1 }), { ...t(2, "making"), id: "b" }];
    assert.deepEqual(canApprove(tests, 2), { ok: false, text: "Waiting for Test 1" });
  });

  it("a second test of the same format waits; another format can run at once", () => {
    const busy: TestRow = { id: "other-plan", n: 9, kind: "tracks", format: "video", runsIn: "tests_adset", state: "running" };
    const mine: TestRow = { id: "mine", n: 1, kind: "statics", format: "video", runsIn: "tests_adset", state: "making" };
    assert.deepEqual(canApprove([mine, busy], 1), { ok: false, text: "Waiting for Test 9" });
    assert.deepEqual(canApprove([{ ...mine, format: "statics" }, busy], 1), { ok: true });
  });

  it("a test measured in place holds no ad set", () => {
    const busy: TestRow = { id: "x", n: 5, kind: "tracks", format: "statics", runsIn: "tests_adset", state: "running" };
    const copy: TestRow = { id: "c", n: 1, kind: "copy", format: "statics", runsIn: "main_adsets", state: "making" };
    assert.deepEqual(canApprove([copy, busy], 1), { ok: true });
  });

  it("CT8's words after a call", () => {
    assert.equal(waitingForStaticsText(1), "Waiting for Test 1's statics");
  });
});

describe("CT9: the open card and the canvas chip", () => {
  it("opens the running test, else the first not ended", () => {
    assert.equal(openTest([t(1, "called"), t(2, "running"), t(3, "waiting")])?.n, 2);
    assert.equal(openTest([t(1, "called"), t(2, "making"), t(3, "waiting")])?.n, 2);
    assert.equal(openTest([t(1, "called")]), null);
  });

  it("reads Test {n} running or Test {n} ready to call", () => {
    assert.equal(canvasChip([t(1, "called"), t(2, "running")], new Set()), "Test 2 running");
    assert.equal(canvasChip([t(1, "called"), t(2, "running")], new Set(["t2"])), "Test 2 ready to call");
    assert.equal(canvasChip([t(1, "approved")], new Set()), null);
  });
});

describe("TT1: Test 3's control", () => {
  it("is the lowest cost per result over 14 days among ads with 10 results or more", () => {
    const control = chooseControl([
      { adId: "1", name: "cheap but thin", spend: 9, results: 9 },
      { adId: "2", name: "best", spend: 30, results: 20 },
      { adId: "3", name: "dear", spend: 50, results: 25 },
    ]);
    assert.equal(control?.name, "best");
    assert.equal(chooseControl([{ adId: "1", name: "thin", spend: 9, results: 9 }]), null);
  });
});

describe("TF4: the Promote line's evidence", () => {
  it("reads {share} % of spend · £{cost} per {result} · {results} {result}s", () => {
    assert.equal(promoteEvidenceText("66", 1.65, 8, "initiate_checkout"), "66 % of spend · £1.65 per checkout · 8 checkouts");
    assert.equal(promoteEvidenceText("61", 2, 1, "landing_page_view"), "61 % of spend · £2.00 per landing-page view · 1 landing-page view");
  });
});
