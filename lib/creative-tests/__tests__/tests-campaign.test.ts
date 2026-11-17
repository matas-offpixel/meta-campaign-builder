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
  londonEndOfDay,
  testAdSetEndTime,
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
    assert.throws(() => findTestsCampaign([{ id: "a", name: "X · Tests" }, { id: "b", name: "X · Tests", effective_status: "ACTIVE" }], "X"), (err: unknown) => err instanceof TestsCampaignProblem && /exists 2 times \(a, b\)/.test(err.message));
    assert.throws(() => findTestsCampaign([{ id: "a", name: "X · Tests", lifetime_budget: "10000" }], "X"), /has a campaign budget/);
    assert.throws(() => findTestsCampaign([{ id: "a", name: "X · Tests", daily_budget: 2000 }], "X"), /has a campaign budget/);
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

  it("copies a Meta objective as it is when given one", () => {
    const p = testsCampaignPayload("NX26-LOCKLEAD", { metaObjective: "OUTCOME_LEADS", status: "ACTIVE" });
    assert.equal(p.objective, "OUTCOME_LEADS");
    assert.equal("daily_budget" in p, false);
    assert.equal(p.is_adset_budget_sharing_enabled, false);
  });
});

describe("a test ad set's end", () => {
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
