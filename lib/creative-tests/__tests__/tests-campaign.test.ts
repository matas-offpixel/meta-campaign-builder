import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { findTestsCampaign, hasCampaignBudget, isTestsCampaign, testsCampaignPayload } from "../tests-campaign.ts";

describe("the show's Tests campaign: one helper for the copy tests and the creative tests", () => {
  it("matches the exact name only", () => {
    assert.equal(isTestsCampaign("P26-BDAY · Tests", "P26-BDAY"), true);
    assert.equal(isTestsCampaign("  P26-BDAY · Tests ", "P26-BDAY"), true);
    for (const other of ["P26-BDAY · Tests · Video", "P26-BDAY · AB copy test", "[P26-BDAY] Puzzle - On Sale V2", "P26-BDAY - Tests", "p26-bday · tests"]) {
      assert.equal(isTestsCampaign(other, "P26-BDAY"), false, other);
    }
  });
  it("finds the live one, skips archived and deleted, and is null when there is none", () => {
    const rows = [
      { id: "old", name: "P26-BDAY · Tests", status: "ARCHIVED" },
      { id: "main", name: "[P26-BDAY] Puzzle - On Sale V2", status: "ACTIVE", lifetime_budget: "0", daily_budget: "0" },
      { id: "t", name: "P26-BDAY · Tests", status: "PAUSED", daily_budget: "0", lifetime_budget: "0" },
    ];
    assert.equal(findTestsCampaign(rows, "P26-BDAY")?.id, "t");
    assert.equal(findTestsCampaign(rows.slice(0, 2), "P26-BDAY"), null);
  });
  it("two live Tests campaigns, or one with a campaign budget: refused, never picked", () => {
    assert.throws(() => findTestsCampaign([{ id: "a", name: "X · Tests" }, { id: "b", name: "X · Tests" }], "X"), /exists 2 times/);
    assert.throws(() => findTestsCampaign([{ id: "a", name: "X · Tests", lifetime_budget: "10000" }], "X"), /has a campaign budget/);
    assert.equal(hasCampaignBudget({ daily_budget: "0", lifetime_budget: null }), false);
  });
  it("a new Tests campaign never carries a campaign budget", () => {
    for (const status of ["ACTIVE", "PAUSED"] as const) {
      const p = testsCampaignPayload("P26-BDAY", { status });
      assert.deepEqual(p, { name: "P26-BDAY · Tests", objective: "OUTCOME_SALES", buying_type: "AUCTION", status, special_ad_categories: [], is_adset_budget_sharing_enabled: false });
    }
  });
});
