/**
 * Integration tests for lib/optimisation/tick-runner.ts — task #120 PR A.
 * Exercises the full dry-run flow with a stub Meta fetcher and a stub DB,
 * verifying decisions are written and NO Meta write is ever attempted
 * (there is no write seam at all in this module — only `fetchInsights` and
 * `insertDecision`, both injected — so "zero Meta writes" is structural,
 * not just tested).
 *
 * Run: node --test lib/optimisation/__tests__/tick-runner.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runOptimisationTick, type CampaignAutomationInput, type DecisionToInsert, type OptimisationTickDeps } from "../tick-runner.ts";
import type { AdSetInsightRow } from "../insights-fetch.ts";
import type { BudgetGuardrails, OptimisationRule } from "../../types.ts";

function tid(): string {
  return Math.random().toString(36).slice(2);
}

const GUARDRAILS: BudgetGuardrails = {
  baseCampaignBudget: 100,
  maxExpansionPercent: 100,
  hardBudgetCeiling: 500,
  ceilingBehaviour: "stop",
};

const CPR_RULE: OptimisationRule = {
  id: tid(),
  name: "Primary",
  metric: "cpr",
  timeWindow: "24h",
  enabled: true,
  thresholds: [
    { id: tid(), operator: "below", value: 1, action: "increase_budget", actionValue: 30, label: "scale" },
    { id: tid(), operator: "above", value: 5, action: "pause", label: "pause" },
  ],
};

function campaign(overrides: Partial<CampaignAutomationInput> = {}): CampaignAutomationInput {
  return {
    draftId: "draft-1",
    campaignId: "camp_1",
    adAccountId: "act_123",
    objective: "registration",
    optimisationStrategy: { mode: "custom", rules: [CPR_RULE], guardrails: GUARDRAILS },
    ...overrides,
  };
}

function insightRow(overrides: Partial<AdSetInsightRow> = {}): AdSetInsightRow {
  return {
    adsetId: "adset_1",
    adsetName: "Ad Set 1",
    dailyBudgetPence: 10000,
    effectiveStatus: "ACTIVE",
    impressions: 1000,
    cpc: null,
    cpm: null,
    ctr: null,
    costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 0.5 },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<OptimisationTickDeps> = {}): OptimisationTickDeps {
  return {
    loadOptedInCampaigns: async () => [campaign()],
    hasRecentDecision: async () => false,
    insertDecision: async () => {},
    fetchInsights: async () => [insightRow()],
    now: new Date("2026-08-07T12:00:00Z"),
    ...overrides,
  };
}

describe("runOptimisationTick — killswitch / quota", () => {
  it("killswitch off — no campaigns loaded, no Meta calls, no inserts", async () => {
    let loadCalled = false;
    let fetchCalled = false;
    let insertCalled = false;
    const deps = makeDeps({
      loadOptedInCampaigns: async () => {
        loadCalled = true;
        return [];
      },
      fetchInsights: async () => {
        fetchCalled = true;
        return [];
      },
      insertDecision: async () => {
        insertCalled = true;
      },
    });
    const summary = await runOptimisationTick(false, false, deps);
    assert.equal(summary.skippedReason, "killswitch");
    assert.equal(loadCalled, false);
    assert.equal(fetchCalled, false);
    assert.equal(insertCalled, false);
  });

  it("quota-throttled — skips the tick entirely", async () => {
    const deps = makeDeps();
    const summary = await runOptimisationTick(true, true, deps);
    assert.equal(summary.skippedReason, "quota_throttled");
    assert.equal(summary.decisionsInserted, 0);
  });
});

describe("runOptimisationTick — dry-run decisions", () => {
  it("writes exactly one decision row per opted-in ad set and never mutates Meta", async () => {
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps({ insertDecision: async (row) => void inserted.push(row) });

    const summary = await runOptimisationTick(true, false, deps);

    assert.equal(summary.ok, true);
    assert.equal(summary.campaignsConsidered, 1);
    assert.equal(summary.adSetsConsidered, 1);
    assert.equal(summary.decisionsInserted, 1);
    assert.equal(inserted.length, 1);

    const decision = inserted[0];
    assert.equal(decision.campaignId, "camp_1");
    assert.equal(decision.adsetId, "adset_1");
    assert.equal(decision.adAccountId, "act_123");
    assert.equal(decision.draftId, "draft-1");
    assert.equal(decision.metric, "cpr");
    assert.equal(decision.metricValue, 0.5);
    assert.equal(decision.actionRecommended, "scale_up");
    assert.equal(decision.actionDelta, 30);
    assert.equal(decision.budgetBeforePence, 10000);
    assert.equal(decision.budgetAfterPence, 13000);
  });

  it("skips (no insert) an ad set with a decision inside the 24h lookback", async () => {
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps({
      hasRecentDecision: async () => true,
      insertDecision: async (row) => void inserted.push(row),
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(summary.adSetsSkippedRecentDecision, 1);
    assert.equal(summary.decisionsInserted, 0);
    assert.equal(inserted.length, 0);
  });

  it("dormant ad set (0 impressions) still gets a skip_dormant decision row", async () => {
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps({
      fetchInsights: async () => [insightRow({ impressions: 0 })],
      insertDecision: async (row) => void inserted.push(row),
    });
    await runOptimisationTick(true, false, deps);
    assert.equal(inserted[0].actionRecommended, "skip_dormant");
    assert.equal(inserted[0].budgetAfterPence, inserted[0].budgetBeforePence);
  });

  it("CBO ad set (no per-adset daily_budget) gets a maintain decision, not a crash", async () => {
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps({
      fetchInsights: async () => [insightRow({ dailyBudgetPence: null })],
      insertDecision: async (row) => void inserted.push(row),
    });
    await runOptimisationTick(true, false, deps);
    assert.equal(inserted[0].actionRecommended, "maintain");
    assert.match(inserted[0].reasonText, /campaign budget optimisation/);
  });

  it("no live metric data yet → maintain with an honest reason, not a false 0", async () => {
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps({
      fetchInsights: async () => [insightRow({ costPerActionType: {} })],
      insertDecision: async (row) => void inserted.push(row),
    });
    await runOptimisationTick(true, false, deps);
    assert.equal(inserted[0].actionRecommended, "maintain");
    assert.equal(inserted[0].metricValue, null);
    assert.match(inserted[0].reasonText, /No cpr data/);
  });

  it("one campaign throwing does not stop other campaigns from being evaluated", async () => {
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps({
      loadOptedInCampaigns: async () => [
        campaign({ campaignId: "camp_bad", draftId: "draft-bad" }),
        campaign({ campaignId: "camp_good", draftId: "draft-good" }),
      ],
      fetchInsights: async (campaignId) => {
        if (campaignId === "camp_bad") throw new Error("Meta 500");
        return [insightRow()];
      },
      insertDecision: async (row) => void inserted.push(row),
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(summary.ok, false);
    assert.equal(summary.campaignsErrored.length, 1);
    assert.equal(summary.campaignsErrored[0].campaignId, "camp_bad");
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].campaignId, "camp_good");
  });

  it("multiple ad sets in one campaign each get their own decision", async () => {
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps({
      fetchInsights: async () => [
        insightRow({ adsetId: "adset_a" }),
        insightRow({ adsetId: "adset_b", costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 6 } }),
      ],
      insertDecision: async (row) => void inserted.push(row),
    });
    await runOptimisationTick(true, false, deps);
    assert.equal(inserted.length, 2);
    assert.equal(inserted.find((d) => d.adsetId === "adset_a")?.actionRecommended, "scale_up");
    assert.equal(inserted.find((d) => d.adsetId === "adset_b")?.actionRecommended, "pause");
  });
});
