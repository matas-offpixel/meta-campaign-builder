/**
 * Campaign budget wire shape. ABO has no budget key. CBO follows probes
 * b and c in lib/meta/__fixtures__/budget-probes/zz-budget-probe.json.
 *
 * Run: node --test lib/meta/__tests__/campaign-budget.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCampaignPayload } from "../campaign.ts";

describe("campaign budget payload", () => {
  it("ABO has no budget key and keeps ad set budget sharing off", () => {
    const payload = buildCampaignPayload({
      name: "Show",
      objective: "traffic",
      status: "PAUSED",
      budget: { level: "ad_set", type: "daily", amountMajor: 20 },
    });
    assert.equal(payload.daily_budget, undefined);
    assert.equal(payload.lifetime_budget, undefined);
    assert.equal(payload.bid_strategy, undefined);
    assert.equal(payload.is_adset_budget_sharing_enabled, false);
    assert.equal("stop_time" in payload, false);
  });

  it("CBO daily sends daily_budget and LOWEST_COST_WITHOUT_CAP", () => {
    const payload = buildCampaignPayload({
      name: "Show",
      objective: "traffic",
      status: "PAUSED",
      budget: { level: "campaign", type: "daily", amountMajor: 20 },
    });
    assert.equal(payload.daily_budget, 2000);
    assert.equal(payload.lifetime_budget, undefined);
    assert.equal(payload.bid_strategy, "LOWEST_COST_WITHOUT_CAP");
    assert.equal(payload.is_adset_budget_sharing_enabled, undefined);
    assert.deepEqual(payload.special_ad_categories, []);
  });

  it("CBO lifetime sends lifetime_budget and LOWEST_COST_WITHOUT_CAP", () => {
    const payload = buildCampaignPayload({
      name: "Show",
      objective: "traffic",
      status: "PAUSED",
      budget: { level: "campaign", type: "lifetime", amountMajor: 50 },
    });
    assert.equal(payload.lifetime_budget, 5000);
    assert.equal(payload.daily_budget, undefined);
    assert.equal(payload.bid_strategy, "LOWEST_COST_WITHOUT_CAP");
    assert.equal("stop_time" in payload, false);
  });
});
