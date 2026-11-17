/** The show's one "{code} · Tests" campaign: one helper for the copy tests and the creative tests. */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  TestsCampaignProblem,
  findTestsCampaign,
  hasCampaignBudget,
  isGoneCampaign,
  isShowTestCampaign,
  isTestsCampaign,
  londonDayLabel,
  londonEndOfDay,
  TEST_AD_SET_DAYS,
  TEST_AD_SET_KINDS,
  creativeTestKind,
  testAdSetEndTime,
  testsAdSetName,
  testsCampaignPayload,
} from "../tests-campaign.ts";

describe("the show's Tests campaign", () => {
  it("matches the exact name only", () => {
    assert.equal(isTestsCampaign("P26-BDAY · Tests", "P26-BDAY"), true);
    assert.equal(isTestsCampaign("  P26-BDAY · Tests ", "P26-BDAY"), true);
    for (const other of ["P26-BDAY · Tests · Video", "P26-BDAY · AB copy test", "[P26-BDAY] Puzzle - On Sale V2", "P26-BDAY - Tests", "p26-bday · tests", "XP26-BDAY · Tests"]) {
      assert.equal(isTestsCampaign(other, "P26-BDAY"), false, other);
    }
  });

  it("finds the live one, skips archived and deleted (either status field), and is null when there is none", () => {
    const rows = [
      { id: "old", name: "P26-BDAY · Tests", status: "ARCHIVED" },
      { id: "gone", name: "P26-BDAY · Tests", effective_status: "DELETED" },
      { id: "main", name: "[P26-BDAY] Puzzle - On Sale V2", status: "ACTIVE", lifetime_budget: "0", daily_budget: "0" },
      { id: "t", name: "P26-BDAY · Tests", status: "PAUSED", daily_budget: "0", lifetime_budget: "0" },
    ];
    assert.equal(findTestsCampaign(rows, "P26-BDAY")?.id, "t");
    assert.equal(findTestsCampaign(rows.slice(0, 3), "P26-BDAY"), null);
  });

  it("two live Tests campaigns, or one with a campaign budget: refused, never picked", () => {
    // Design's words, 17 Nov.
    assert.throws(
      () => findTestsCampaign([{ id: "a", name: "P26-BDAY · Tests" }, { id: "b", name: "P26-BDAY · Tests", effective_status: "ACTIVE" }], "P26-BDAY"),
      (err: unknown) => err instanceof TestsCampaignProblem && err.message === "P26-BDAY · Tests is in Ads Manager 2 times (a, b). Keep one and archive the rest. Nothing was made.",
    );
    const budgetWords = { message: "P26-BDAY · Tests has a campaign budget, and tests need budgets on their ad sets. Remove the campaign budget in Ads Manager. Nothing was made." };
    assert.throws(() => findTestsCampaign([{ id: "a", name: "P26-BDAY · Tests", lifetime_budget: "10000" }], "P26-BDAY"), budgetWords);
    assert.throws(() => findTestsCampaign([{ id: "a", name: "P26-BDAY · Tests", daily_budget: 2000 }], "P26-BDAY"), budgetWords);
    assert.equal(hasCampaignBudget({ daily_budget: "0", lifetime_budget: null }), false);
  });

  it("reads deleted and archived from effective_status first, else status", () => {
    assert.equal(isGoneCampaign({ effective_status: "DELETED" }), true);
    assert.equal(isGoneCampaign({ status: "archived" }), true);
    assert.equal(isGoneCampaign({ status: "DELETED", effective_status: "ACTIVE" }), false);
    assert.equal(isGoneCampaign({ status: "PAUSED" }), false);
    assert.equal(isGoneCampaign(null), false);
  });

  it("knows this round's test campaigns by exact name, so they're never main campaigns", () => {
    for (const name of ["EBR26-KREAM · Tests", "EBR26-KREAM · AB copy test", "EBR26-KREAM · Artist cards test", " EBR26-KREAM · AB copy test "]) {
      assert.equal(isShowTestCampaign(name, "EBR26-KREAM"), true, name);
    }
    for (const name of ["[EBR26-KREAM] Kream - On Sale", "EBR26-KREAM · AB copy test 2", "P26-BDAY · AB copy test", "EBR26-KREAM AB copy test"]) {
      assert.equal(isShowTestCampaign(name, "EBR26-KREAM"), false, name);
    }
  });
});

describe("a new Tests campaign", () => {
  it("never carries a campaign budget, ACTIVE or PAUSED", () => {
    for (const status of ["ACTIVE", "PAUSED"] as const) {
      const p = testsCampaignPayload("P26-BDAY", { status });
      assert.deepEqual(p, { name: "P26-BDAY · Tests", objective: "OUTCOME_SALES", buying_type: "AUCTION", status, special_ad_categories: [], is_adset_budget_sharing_enabled: false });
    }
  });

  it("is objective Sales (TT8)", () => {
    assert.equal(testsCampaignPayload("NX26-LOCKLEAD", { status: "ACTIVE" }).objective, "OUTCOME_SALES");
  });
});

describe("a test ad set's name (TT10)", () => {
  it("is the record's five example names, from fixture days", () => {
    const nov17 = "2026-11-17T09:00:00Z";
    const nov24 = "2026-11-24T09:00:00Z";
    assert.equal(testsAdSetName("P26-BDAY", "Video", nov17), "P26-BDAY · Tests · Video · 17 Nov");
    assert.equal(testsAdSetName("P26-BDAY", "Statics", nov24), "P26-BDAY · Tests · Statics · 24 Nov");
    assert.equal(testsAdSetName("P26-BDAY", "Statics", nov24, ["P26-BDAY · Tests · Statics · 24 Nov"]), "P26-BDAY · Tests · Statics · 24 Nov · 2");
    assert.equal(testsAdSetName("P26-BDAY", "AB copy", nov17), "P26-BDAY · Tests · AB copy · 17 Nov");
    assert.equal(testsAdSetName("P26-BDAY", "Artist cards", nov17), "P26-BDAY · Tests · Artist cards · 17 Nov");
  });

  it("takes all four kinds, a creative test's by its format, and nothing else", () => {
    assert.deepEqual(TEST_AD_SET_KINDS, ["Video", "Statics", "AB copy", "Artist cards"]);
    assert.equal(creativeTestKind("video"), "Video");
    assert.equal(creativeTestKind("statics"), "Statics");
    assert.throws(() => testsAdSetName("P26-BDAY", "Copy" as never, "2026-11-17T09:00:00Z"));
  });

  it("counts a repeat per kind: another kind the same day doesn't make it \" · 2\"", () => {
    const existing = ["EBR26-KREAM · Tests · AB copy · 17 Nov", "EBR26-KREAM · Tests · Artist cards · 17 Nov"];
    assert.equal(testsAdSetName("EBR26-KREAM", "Artist cards", "2026-11-17T18:00:00Z", existing), "EBR26-KREAM · Tests · Artist cards · 17 Nov · 2");
    assert.equal(testsAdSetName("EBR26-KREAM", "Video", "2026-11-17T18:00:00Z", existing), "EBR26-KREAM · Tests · Video · 17 Nov");
  });

  it("turns over at London midnight, not UTC", () => {
    // 4 Dec 23:59 London (GMT) is still 4 Dec; 00:00 is 5 Dec.
    assert.equal(testsAdSetName("P26-BDAY", "Video", "2026-12-04T23:59:00Z"), "P26-BDAY · Tests · Video · 4 Dec");
    assert.equal(testsAdSetName("P26-BDAY", "Video", "2026-12-05T00:00:00Z"), "P26-BDAY · Tests · Video · 5 Dec");
    // In BST, 23:00 UTC on 30 Jun is already 1 Jul in London.
    assert.equal(testsAdSetName("P26-BDAY", "AB copy", "2027-06-30T23:00:00Z"), "P26-BDAY · Tests · AB copy · 1 Jul");
    assert.equal(testsAdSetName("P26-BDAY", "AB copy", "2027-06-30T22:59:00Z"), "P26-BDAY · Tests · AB copy · 30 Jun");
  });

  it("is \"{code} · Tests · {Video | Statics} · {d Mon}\", the London day it's made", () => {
    assert.equal(testsAdSetName("P26-BDAY", "Statics", "2026-11-24T10:00:00Z"), "P26-BDAY · Tests · Statics · 24 Nov");
    assert.equal(testsAdSetName("P26-BDAY", "Video", new Date("2026-11-17T08:00:00Z")), "P26-BDAY · Tests · Video · 17 Nov");
    // No leading zero; 23:30 UTC on 2 Sep is already 3 Sep in London (BST).
    assert.equal(testsAdSetName("NX26-LOCKLEAD", "Video", "2026-09-02T23:30:00Z"), "NX26-LOCKLEAD · Tests · Video · 3 Sep");
    assert.equal(londonDayLabel("2026-01-05T12:00:00Z"), "5 Jan");
  });

  it("a second one in the same format on the same day gets \" · 2\", a third \" · 3\"", () => {
    const taken = ["P26-BDAY · Tests · Statics · 24 Nov", "P26-BDAY · Tests · Video · 24 Nov", "P26-BDAY · Tests · Statics · 23 Nov"];
    assert.equal(testsAdSetName("P26-BDAY", "Statics", "2026-11-24T15:00:00Z", taken), "P26-BDAY · Tests · Statics · 24 Nov · 2");
    assert.equal(testsAdSetName("P26-BDAY", "Statics", "2026-11-24T15:00:00Z", [...taken, "P26-BDAY · Tests · Statics · 24 Nov · 2"]), "P26-BDAY · Tests · Statics · 24 Nov · 3");
    assert.equal(testsAdSetName("P26-BDAY", "Statics", "2026-11-25T09:00:00Z", taken), "P26-BDAY · Tests · Statics · 25 Nov");
  });
});

describe("a test ad set's end", () => {
  it("runs TF1's four days, written out so this file never imports budget.ts", async () => {
    const { TF1 } = await import("../budget.ts");
    assert.equal(TEST_AD_SET_DAYS, TF1.holdDays);
    assert.equal(TEST_AD_SET_DAYS, 4);
    const source = (await import("node:fs")).readFileSync(new URL("../tests-campaign.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /from "\.\/budget\.ts"/, "tests-campaign.ts imports budget.ts again: plan-guard → load → tests-campaign → budget → plan-guard is a cycle");
  });

  it("is 23:59 London, four days after the London day it starts", () => {
    assert.equal(testAdSetEndTime("2026-11-17T08:00:00.000Z"), "2026-11-21T23:59:00+0000");
    // 23:30 UTC on 16 Nov is still 16 Nov in London (GMT).
    assert.equal(testAdSetEndTime(new Date("2026-11-16T23:30:00Z")), "2026-11-20T23:59:00+0000");
    // 23:30 UTC on 1 Jul is 2 Jul in London (BST), so it ends on 6 Jul at +0100.
    assert.equal(testAdSetEndTime("2027-07-01T23:30:00Z"), "2027-07-06T23:59:00+0100");
    assert.throws(() => testAdSetEndTime("not a date"));
  });

  it("takes each day's own offset across the clocks change", () => {
    assert.equal(londonEndOfDay("2026-10-24"), "2026-10-24T23:59:00+0100");
    assert.equal(londonEndOfDay("2026-10-25"), "2026-10-25T23:59:00+0000");
    assert.equal(testAdSetEndTime("2026-10-22T10:00:00Z"), "2026-10-26T23:59:00+0000");
  });
});
