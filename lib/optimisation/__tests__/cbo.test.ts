/**
 * Task #120 CBO follow-on — campaign-level evaluation.
 * Run: node --test lib/optimisation/__tests__/cbo.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { BudgetGuardrails, OptimisationRule } from "../../types.ts";
import { LIFETIME_BUDGET_SKIP_REASON } from "../evaluate.ts";
import { resolvePrimaryLiveMetric } from "../live-metric.ts";
import {
  runOptimisationTick,
  type CampaignAutomationInput,
  type DecisionToInsert,
  type OptimisationTickDeps,
} from "../tick-runner.ts";
import type { AdSetInsightRow, CampaignBudgetInsight } from "../insights-fetch.ts";
import { presentDecisionRow } from "../automation-ui.ts";
import { applyOptimisationDecision } from "../apply.ts";

function tid(): string {
  return Math.random().toString(36).slice(2);
}

const PARENT = "6eed75b";

const GUARDRAILS: BudgetGuardrails = {
  baseCampaignBudget: 150,
  maxExpansionPercent: 100,
  hardBudgetCeiling: 400,
  ceilingBehaviour: "stop",
};

const LPV_RULE: OptimisationRule = {
  id: tid(),
  name: "LPV",
  metric: "lpv_cost",
  timeWindow: "24h",
  enabled: true,
  thresholds: [
    {
      id: tid(),
      operator: "between",
      value: 0.14,
      valueTo: 0.23,
      action: "increase_budget",
      actionValue: 15,
      label: "£0.14–£0.23 CPLPV → scale moderately (+15%)",
    },
  ],
};

const CPR_RULE: OptimisationRule = {
  id: tid(),
  name: "CPR",
  metric: "cpr",
  timeWindow: "24h",
  enabled: true,
  thresholds: [
    {
      id: tid(),
      operator: "below",
      value: 1,
      action: "increase_budget",
      actionValue: 30,
      label: "Below £1 CPR → scale aggressively (+30%)",
    },
  ],
};

function campaign(overrides: Partial<CampaignAutomationInput> = {}): CampaignAutomationInput {
  return {
    draftId: "draft-dod",
    campaignId: "camp_dod",
    adAccountId: "act_606252931141334",
    objective: "traffic",
    optimisationStrategy: { mode: "custom", rules: [LPV_RULE], guardrails: GUARDRAILS },
    optimisationAutomationLive: false,
    campaignName: "[NX26-DOD] DOD - Signup - Artist",
    ...overrides,
  };
}

function cboAdSet(name: string, id: string): AdSetInsightRow {
  return {
    adsetId: id,
    adsetName: name,
    dailyBudgetPence: null,
    lifetimeBudgetPence: null,
    effectiveStatus: "ACTIVE",
    impressions: 2000,
    cpc: null,
    cpm: null,
    ctr: null,
    costPerActionType: { landing_page_view: 0.18 },
    actionCountByType: { landing_page_view: 150 },
  };
}

function campaignInsight(overrides: Partial<CampaignBudgetInsight> = {}): CampaignBudgetInsight {
  return {
    campaignId: "camp_dod",
    dailyBudgetPence: 15000,
    lifetimeBudgetPence: null,
    impressions: 12000,
    cpc: null,
    cpm: null,
    ctr: null,
    costPerActionType: { landing_page_view: 0.18 },
    actionCountByType: { landing_page_view: 200 },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<OptimisationTickDeps> = {}): OptimisationTickDeps {
  return {
    loadOptedInCampaigns: async () => [campaign()],
    getAdSetState: async () => ({
      lastAppliedAt: null,
      lastDecidedAt: null,
      appliedIncreasePercentLast24h: 0,
    }),
    insertDecision: async () => {},
    fetchInsights: async () => [
      cboAdSet("Disco Pages", "as_disco"),
      cboAdSet("WIDE", "as_wide"),
      cboAdSet("Fashion", "as_fashion"),
    ],
    fetchCampaignInsights: async () => campaignInsight(),
    readAdSetDailyBudget: async () => {
      throw new Error("ABO write must not run on CBO");
    },
    updateAdSetDailyBudget: async () => {
      throw new Error("ABO write must not run on CBO");
    },
    readCampaignDailyBudget: async () => {
      throw new Error("shadow must not re-read");
    },
    updateCampaignDailyBudget: async () => {
      throw new Error("shadow must not write");
    },
    notify: async () => ({ sent: true }),
    now: new Date("2026-09-01T12:00:00Z"),
    writesEnabled: false,
    ...overrides,
  };
}

describe("CBO DOD/IPC shape — one campaign decision, real metric + rule", () => {
  it("3 CBO ad sets → 1 campaign-level scale_up on lpv_cost, dry_run", async () => {
    const inserted: DecisionToInsert[] = [];
    const summary = await runOptimisationTick(true, false, {
      ...makeDeps(),
      insertDecision: async (row) => void inserted.push(row),
    });
    assert.equal(summary.decisionsInserted, 1);
    assert.equal(summary.adSetsConsidered, 1);
    assert.equal(inserted.length, 1);
    const row = inserted[0]!;
    assert.equal(row.scope, "campaign");
    assert.equal(row.adsetId, "camp_dod");
    assert.equal(row.metric, "lpv_cost");
    assert.equal(row.metricValue, 0.18);
    assert.equal(row.ruleMatched, "£0.14–£0.23 CPLPV → scale moderately (+15%)");
    assert.equal(row.actionRecommended, "scale_up");
    assert.equal(row.actionDelta, 15);
    assert.equal(row.budgetBeforePence, 15000);
    assert.equal(row.budgetAfterPence, 17250);
    assert.equal(row.dryRun, true);
    assert.equal(row.applied, false);
    assert.doesNotMatch(row.reasonText, /PR A does not propose CBO/);
  });
});

describe("CBO insufficient data — M.4 metric_unavailable vocabulary", () => {
  it("no campaign-grain results → metric_unavailable, never a guessed rate", async () => {
    const inserted: DecisionToInsert[] = [];
    await runOptimisationTick(true, false, {
      ...makeDeps(),
      fetchCampaignInsights: async () =>
        campaignInsight({ impressions: 4000, costPerActionType: {} }),
      insertDecision: async (row) => void inserted.push(row),
    });
    assert.equal(inserted[0]!.actionRecommended, "metric_unavailable");
    assert.equal(inserted[0]!.metricValue, null);
    assert.equal(inserted[0]!.ruleMatched, null);
    assert.match(inserted[0]!.reasonText, /metric_unavailable, not a guessed rate/);
    assert.doesNotMatch(inserted[0]!.reasonText, /scale/);
  });
});

describe("lifetime budget is a named skip, never a scaled proposal", () => {
  it("campaign lifetime_budget yields LIFETIME_BUDGET_SKIP_REASON", async () => {
    const inserted: DecisionToInsert[] = [];
    await runOptimisationTick(true, false, {
      ...makeDeps(),
      fetchCampaignInsights: async () =>
        campaignInsight({ dailyBudgetPence: null, lifetimeBudgetPence: 500000 }),
      insertDecision: async (row) => void inserted.push(row),
    });
    assert.equal(inserted[0]!.actionRecommended, "maintain");
    assert.equal(inserted[0]!.ruleMatched, null);
    assert.equal(inserted[0]!.actionDelta, null);
    assert.equal(inserted[0]!.budgetAfterPence, inserted[0]!.budgetBeforePence);
    assert.equal(inserted[0]!.reasonText, LIFETIME_BUDGET_SKIP_REASON);
    assert.doesNotMatch(inserted[0]!.reasonText, /PR A does not propose CBO/);
  });
});

describe("result-type isolation", () => {
  it("a traffic campaign never matches a registration ladder", async () => {
    const trafficMetric = resolvePrimaryLiveMetric(
      "traffic",
      { impressions: 1000, cpc: null, cpm: null, ctr: null, costPerActionType: { landing_page_view: 0.18 }, actionCountByType: { landing_page_view: 100 } },
      "24h",
    );
    assert.equal(trafficMetric?.name, "lpv_cost");
    assert.notEqual(trafficMetric?.name, "cpr");

    const inserted: DecisionToInsert[] = [];
    await runOptimisationTick(true, false, {
      ...makeDeps({
        loadOptedInCampaigns: async () => [
          campaign({
            optimisationStrategy: { mode: "custom", rules: [CPR_RULE], guardrails: GUARDRAILS },
          }),
        ],
      }),
      insertDecision: async (row) => void inserted.push(row),
    });
    assert.equal(inserted[0]!.metric, "lpv_cost");
    assert.equal(inserted[0]!.actionRecommended, "maintain");
    assert.equal(inserted[0]!.ruleMatched, null);
    assert.match(inserted[0]!.reasonText, /No enabled rule configured for metric "lpv_cost"/);
    assert.doesNotMatch(inserted[0]!.reasonText, /CPR|scale aggressively/);
  });
});

describe("CBO apply + gates", () => {
  it("live gates write the campaign object; shadow stays dry_run", async () => {
    const campaignUpdates: Array<{ id: string; pence: number }> = [];
    const live = await applyOptimisationDecision(
      {
        decision: {
          campaignId: "camp_dod",
          adsetId: "camp_dod",
          adAccountId: "act_1",
          draftId: "draft-dod",
          scope: "campaign",
          metric: "lpv_cost",
          metricValue: 0.18,
          metricWindow: "24h",
          ruleMatched: "£0.14–£0.23 CPLPV → scale moderately (+15%)",
          actionRecommended: "scale_up",
          actionDelta: 15,
          budgetBeforePence: 15000,
          budgetAfterPence: 17250,
          guardrailNote: null,
          reasonText: "lpv_cost=0.18 matched scale → scale_up +15%.",
        },
        campaignName: "DOD",
        adsetName: "DOD",
        gates: { dryRun: false, reason: null },
        writesRemaining: 25,
      },
      {
        readAdSetDailyBudget: async () => {
          throw new Error("ad set");
        },
        updateAdSetDailyBudget: async () => {
          throw new Error("ad set");
        },
        readCampaignDailyBudget: async () => 15000,
        updateCampaignDailyBudget: async (id, pence) => {
          campaignUpdates.push({ id, pence });
          return { ok: true };
        },
        insertDecision: async () => {},
        notify: async () => ({ sent: true }),
      },
    );
    assert.equal(live.kind, "applied");
    assert.deepEqual(campaignUpdates, [{ id: "camp_dod", pence: 17250 }]);

    const shadow = await applyOptimisationDecision(
      {
        decision: {
          campaignId: "camp_dod",
          adsetId: "camp_dod",
          adAccountId: "act_1",
          draftId: "draft-dod",
          scope: "campaign",
          metric: "lpv_cost",
          metricValue: 0.18,
          metricWindow: "24h",
          ruleMatched: "scale",
          actionRecommended: "scale_up",
          actionDelta: 15,
          budgetBeforePence: 15000,
          budgetAfterPence: 17250,
          guardrailNote: null,
          reasonText: "scale",
        },
        campaignName: "DOD",
        adsetName: "DOD",
        gates: { dryRun: true, reason: "not_live" },
        writesRemaining: 25,
      },
      {
        readAdSetDailyBudget: async () => {
          throw new Error("ad set");
        },
        updateAdSetDailyBudget: async () => {
          throw new Error("ad set");
        },
        readCampaignDailyBudget: async () => {
          throw new Error("shadow");
        },
        updateCampaignDailyBudget: async () => {
          throw new Error("shadow");
        },
        insertDecision: async () => {},
        notify: async () => ({ sent: true }),
      },
    );
    assert.equal(shadow.kind, "shadow");
    assert.equal(shadow.decision.dryRun, true);
    assert.equal(shadow.decision.applied, false);
  });
});

describe("UI scope + parent-sha falsify + grep-guards", () => {
  it("presentDecisionRow names campaign vs ad_set", () => {
    const campaignRow = presentDecisionRow({
      decided_at: "2026-09-01T12:00:00.000Z",
      metric: "lpv_cost",
      metric_value: 0.18,
      rule_matched: "scale",
      action_recommended: "scale_up",
      budget_before_pence: 15000,
      budget_after_pence: 17250,
      applied: false,
      dry_run: true,
      reason_text: "scale",
      scope: "campaign",
      campaign_id: "camp_dod",
      adset_id: "camp_dod",
    });
    assert.equal(campaignRow.scope, "campaign");
    const inferred = presentDecisionRow({
      decided_at: "2026-09-01T12:00:00.000Z",
      metric: "lpv_cost",
      metric_value: 0.18,
      rule_matched: "scale",
      action_recommended: "scale_up",
      budget_before_pence: 15000,
      budget_after_pence: 17250,
      applied: false,
      dry_run: true,
      reason_text: "scale",
      campaign_id: "camp_dod",
      adset_id: "camp_dod",
    });
    assert.equal(inferred.scope, "campaign");
  });

  it("parent sha early-returned CBO as PR A no-op and never fetched campaign daily_budget", () => {
    const parentTick = execFileSync("git", ["show", `${PARENT}:lib/optimisation/tick-runner.ts`], {
      encoding: "utf8",
    });
    assert.match(parentTick, /PR A does not propose CBO changes/);
    assert.doesNotMatch(parentTick, /fetchCampaignInsights/);
    const parentFetch = execFileSync("git", ["show", `${PARENT}:lib/optimisation/insights-fetch.ts`], {
      encoding: "utf8",
    });
    assert.doesNotMatch(parentFetch, /fetchCampaignBudgetInsights/);
  });

  it("this tree evaluates CBO, names lifetime, and does not invent a killswitch", () => {
    const tick = readFileSync("lib/optimisation/tick-runner.ts", "utf8");
    assert.match(tick, /buildCampaignDecision/);
    assert.match(tick, /evaluateCampaign/);
    assert.doesNotMatch(tick, /does not propose CBO changes/);
    const apply = readFileSync("lib/optimisation/apply.ts", "utf8");
    assert.match(apply, /updateCampaignDailyBudget/);
    assert.match(apply, /scope === "campaign"/);
    const list = readFileSync("components/optimisation/automation-decisions-list.tsx", "utf8");
    assert.match(list, /ScopeGlyph/);
    const sql = readFileSync("supabase/migrations/164_campaign_automation_decisions_scope.sql", "utf8");
    assert.match(sql, /add column if not exists scope/);
    assert.match(sql, /Do not apply in this run/);
    const notes = readFileSync("supabase/migrations/MIGRATIONS_NOTES.md", "utf8");
    assert.doesNotMatch(notes, /164_campaign_automation_decisions_scope applied/);
    const gates = readFileSync("lib/optimisation/gates.ts", "utf8");
    assert.doesNotMatch(gates, /ENABLE_OPTIMISATION_CBO|CBO_WRITES/);
    const evaluate = readFileSync("lib/optimisation/evaluate.ts", "utf8");
    assert.match(evaluate, /export function evaluateCampaign/);
    assert.match(evaluate, /lifetime_budget/);
    assert.doesNotMatch(apply, /evaluateAdSet|evaluateCampaign/);
  });
});
