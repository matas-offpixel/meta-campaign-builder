/** The show's one "{code} · Tests" campaign: the exact-name match, no campaign budget, ACTIVE, 4-day ad sets. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasCampaignBudget, pickTestsCampaign, testAdSetEndTime, testsCampaignPayload } from "../tests-campaign.ts";

describe("pickTestsCampaign", () => {
  it("takes the exact name only, never one that merely contains it or another show's", () => {
    const listed = [
      { id: "1", name: "P26-BDAY · Tests · Video" },
      { id: "2", name: "[P26-BDAY] Tests" },
      { id: "3", name: "XP26-BDAY · Tests" },
      { id: "4", name: "P26-BDAY · Tests " },
    ];
    assert.equal(pickTestsCampaign(listed, "P26-BDAY")?.id, "4");
    assert.equal(pickTestsCampaign(listed.slice(0, 3), "P26-BDAY"), null);
  });

  it("skips deleted and archived campaigns, and takes the oldest of two live ones", () => {
    const listed = [
      { id: "9", name: "P26-BDAY · Tests", effective_status: "DELETED", created_time: "2026-09-01T00:00:00+0000" },
      { id: "8", name: "P26-BDAY · Tests", effective_status: "PAUSED", created_time: "2026-11-17T00:00:00+0000" },
      { id: "7", name: "P26-BDAY · Tests", effective_status: "ACTIVE", created_time: "2026-11-16T00:00:00+0000" },
    ];
    assert.equal(pickTestsCampaign(listed, "P26-BDAY")?.id, "7");
  });
});

describe("the Tests campaign payload", () => {
  it("is ACTIVE with no campaign budget, so each ad set keeps its own", () => {
    const payload = testsCampaignPayload("NX26-LOCKLEAD", "OUTCOME_SALES");
    assert.deepEqual(payload, { name: "NX26-LOCKLEAD · Tests", objective: "OUTCOME_SALES", buying_type: "AUCTION", status: "ACTIVE", special_ad_categories: [], is_adset_budget_sharing_enabled: false });
    assert.equal(hasCampaignBudget(payload as never), false);
  });

  it("reads a daily or lifetime campaign budget as CBO", () => {
    assert.equal(hasCampaignBudget({ daily_budget: "1000" }), true);
    assert.equal(hasCampaignBudget({ lifetime_budget: 5000 }), true);
    assert.equal(hasCampaignBudget({ daily_budget: null, lifetime_budget: "0" }), false);
  });
});

describe("testAdSetEndTime", () => {
  it("ends four days after the start, across the clocks change too", () => {
    assert.equal(testAdSetEndTime("2026-11-17T08:00:00.000Z"), "2026-11-21T08:00:00.000Z");
    assert.equal(testAdSetEndTime("2026-10-23T07:00:00.000Z"), "2026-10-27T07:00:00.000Z");
    assert.throws(() => testAdSetEndTime("not a date"));
  });
});
