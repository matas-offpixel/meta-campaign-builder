/**
 * Ad set budget wire shape. Daily ABO stays the payload this tool has
 * always sent. Lifetime and CBO follow the paused probes in
 * lib/meta/__fixtures__/budget-probes/zz-budget-probe.json.
 *
 * Run: node --test lib/meta/__tests__/adset-budget.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAdSetPayload } from "../adset.ts";
import type { AdSetSuggestion, AudienceSettings, BudgetScheduleSettings } from "../../types.ts";

function adSet(overrides: Partial<AdSetSuggestion> = {}): AdSetSuggestion {
  return {
    id: "s1",
    name: "Prospecting",
    sourceType: "blank",
    sourceId: "",
    sourceName: "No audience source",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 20,
    advantagePlus: true,
    enabled: true,
    ...overrides,
  } as AdSetSuggestion;
}

const audiences = {
  interestGroups: [],
  customAudienceGroups: [],
  pageGroups: [],
  savedAudiences: { audienceIds: [] },
  selectedPagesLookalikeGroups: [],
} as unknown as AudienceSettings;

function schedule(overrides: Partial<BudgetScheduleSettings> = {}): BudgetScheduleSettings {
  return {
    budgetLevel: "ad_set",
    budgetType: "daily",
    budgetAmount: 20,
    currency: "GBP",
    startDate: "2026-10-01",
    endDate: "2026-10-08",
    timezone: "Europe/London",
    ...overrides,
  } as BudgetScheduleSettings;
}

function build(row: AdSetSuggestion, budget: BudgetScheduleSettings) {
  return buildAdSetPayload(row, "camp_1", audiences, budget, "link_clicks", "traffic", undefined, false, undefined, "PAUSED");
}

describe("ad set budget payload", () => {
  it("daily ABO is unchanged: daily_budget and bid_strategy, no lifetime_budget", () => {
    const payload = build(adSet(), schedule());
    assert.equal(payload.daily_budget, 2000);
    assert.equal(payload.lifetime_budget, undefined);
    assert.equal(payload.bid_strategy, "LOWEST_COST_WITHOUT_CAP");
    assert.equal(payload.status, "PAUSED");
  });

  it("lifetime ABO sends lifetime_budget and end_time and no daily_budget", () => {
    const payload = build(
      adSet({ budgetPerDay: 20, budgetLifetime: 50 }),
      schedule({ budgetType: "lifetime", budgetAmount: 50 }),
    );
    assert.equal(payload.lifetime_budget, 5000);
    assert.equal(payload.daily_budget, undefined);
    assert.equal(payload.bid_strategy, "LOWEST_COST_WITHOUT_CAP");
    // Date-only end is midnight in Europe/London. 8 Oct 2026 is still BST.
    assert.equal(payload.end_time, Math.floor(Date.parse("2026-10-07T23:00:00Z") / 1000));
  });

  it("CBO sends no budget and no bid_strategy on the ad set", () => {
    const payload = build(
      adSet({ budgetPerDay: 20, budgetLifetime: 50 }),
      schedule({ budgetLevel: "campaign", budgetType: "daily", budgetAmount: 20 }),
    );
    assert.equal(payload.daily_budget, undefined);
    assert.equal(payload.lifetime_budget, undefined);
    assert.equal(payload.bid_strategy, undefined);
    assert.equal(payload.end_time, Math.floor(Date.parse("2026-10-07T23:00:00Z") / 1000));
  });
});
