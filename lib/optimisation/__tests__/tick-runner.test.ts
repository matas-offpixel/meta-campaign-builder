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

import { lastChangeDecidedAt } from "../evaluate.ts";
import { runOptimisationTick, type CampaignAutomationInput, type DecisionToInsert, type OptimisationTickDeps } from "../tick-runner.ts";
import type { AdSetInsightRow } from "../insights-fetch.ts";
import type { BudgetGuardrails, OptimisationRule } from "../../types.ts";
import type { NotifyOptions } from "../../notify/slack.ts";
import { DEFAULT_DEDUPE_WINDOW_MS } from "../../notify/slack.ts";

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
    optimisationAutomationLive: false,
    campaignName: "Test Campaign",
    ...overrides,
  };
}

function insightRow(overrides: Partial<AdSetInsightRow> = {}): AdSetInsightRow {
  return {
    adsetId: "adset_1",
    adsetName: "Ad Set 1",
    dailyBudgetPence: 10000,
    lifetimeBudgetPence: null,
    effectiveStatus: "ACTIVE",
    impressions: 1000,
    cpc: null,
    cpm: null,
    ctr: null,
    costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 0.5 },
    actionCountByType: { "offsite_conversion.fb_pixel_complete_registration": 20 },
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
    fetchInsights: async () => [insightRow()],
    fetchCampaignInsights: async () => {
      throw new Error("fetchCampaignInsights must not be called for ABO");
    },
    readAdSetDailyBudget: async () => {
      throw new Error("readAdSetDailyBudget must not be called in shadow mode");
    },
    updateAdSetDailyBudget: async () => {
      throw new Error("updateAdSetDailyBudget must not be called in shadow mode");
    },
    readCampaignDailyBudget: async () => {
      throw new Error("readCampaignDailyBudget must not be called in shadow mode");
    },
    updateCampaignDailyBudget: async () => {
      throw new Error("updateCampaignDailyBudget must not be called in shadow mode");
    },
    notify: async () => ({ sent: true }),
    now: new Date("2026-08-07T12:00:00Z"),
    writesEnabled: false,
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

  it("maintain 2h ago + scale_up 200h ago evaluates — cooldown reads last change", async () => {
    const now = new Date("2026-09-05T00:00:00Z");
    const lastDecidedAt = lastChangeDecidedAt([
      { action: "maintain", decidedAt: new Date(now.getTime() - 2 * 3600 * 1000) },
      { action: "scale_up", decidedAt: new Date(now.getTime() - 200 * 3600 * 1000) },
    ]);
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps({
      now,
      getAdSetState: async () => ({
        lastAppliedAt: null,
        lastDecidedAt,
        appliedIncreasePercentLast24h: 0,
      }),
      insertDecision: async (row) => void inserted.push(row),
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(summary.adSetsSkippedRecentDecision, 0);
    assert.equal(summary.decisionsInserted, 1);
    assert.notEqual(inserted[0]?.actionRecommended, "skip_recent_touch");
  });

  it("scale_up 100h ago is inside the 168h conversion cooldown — no insert", async () => {
    const now = new Date("2026-09-05T00:00:00Z");
    const lastDecidedAt = lastChangeDecidedAt([
      { action: "scale_up", decidedAt: new Date(now.getTime() - 100 * 3600 * 1000) },
    ]);
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps({
      now,
      getAdSetState: async () => ({
        lastAppliedAt: null,
        lastDecidedAt,
        appliedIncreasePercentLast24h: 0,
      }),
      insertDecision: async (row) => void inserted.push(row),
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(summary.adSetsSkippedRecentDecision, 1);
    assert.equal(summary.decisionsInserted, 0);
    assert.equal(inserted.length, 0);
  });

  it("skips (no insert) an ad set with a decision inside the 24h lookback", async () => {
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps({
      getAdSetState: async () => ({
        lastAppliedAt: null,
        lastDecidedAt: new Date("2026-08-07T06:00:00Z"),
        appliedIncreasePercentLast24h: 0,
      }),
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

  it("CBO roster evaluates once at campaign grain when daily_budget is present", async () => {
    const lpvRule: OptimisationRule = {
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
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps({
      loadOptedInCampaigns: async () => [
        campaign({
          objective: "traffic",
          campaignName: "[NX26-DOD] DOD - Signup - Artist",
          optimisationStrategy: { mode: "custom", rules: [lpvRule], guardrails: GUARDRAILS },
        }),
      ],
      fetchInsights: async () => [
        insightRow({ adsetId: "disco", adsetName: "Disco Pages", dailyBudgetPence: null }),
        insightRow({ adsetId: "wide", adsetName: "WIDE", dailyBudgetPence: null }),
      ],
      fetchCampaignInsights: async () => ({
        campaignId: "camp_1",
        dailyBudgetPence: 15000,
        lifetimeBudgetPence: null,
        impressions: 8000,
        cpc: null,
        cpm: null,
        ctr: null,
        costPerActionType: { landing_page_view: 0.18 },
        actionCountByType: { landing_page_view: 120 },
      }),
      insertDecision: async (row) => void inserted.push(row),
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(summary.decisionsInserted, 1);
    assert.equal(inserted[0].scope, "campaign");
    assert.equal(inserted[0].adsetId, "camp_1");
    assert.equal(inserted[0].metric, "lpv_cost");
    assert.equal(inserted[0].metricValue, 0.18);
    assert.equal(inserted[0].actionRecommended, "scale_up");
    assert.equal(inserted[0].actionDelta, 15);
    assert.equal(inserted[0].budgetBeforePence, 15000);
    assert.equal(inserted[0].budgetAfterPence, 17250);
    assert.doesNotMatch(inserted[0].reasonText, /PR A does not propose CBO/);
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

  it("campaign evaluation throw notifies ads_automation with 24h dedupe (2026-08-18 visibility)", async () => {
    const notifyCalls: NotifyOptions[] = [];
    const deps = makeDeps({
      loadOptedInCampaigns: async () => [campaign({ campaignId: "camp_bad", draftId: "draft-bad" })],
      fetchInsights: async () => {
        throw new Error("(#100) For field 'insights': date_preset must be one of: ...");
      },
      notify: async (opts) => {
        notifyCalls.push(opts);
        return { sent: true };
      },
    });
    await runOptimisationTick(true, false, deps);
    assert.equal(notifyCalls.length, 1);
    assert.equal(notifyCalls[0].channel, "ads_automation");
    assert.equal(notifyCalls[0].dedupeKey, "optimisation_tick_error:camp_bad");
    assert.equal(notifyCalls[0].dedupeWindowMs, DEFAULT_DEDUPE_WINDOW_MS);
    assert.match(notifyCalls[0].text, /camp_bad/);
    assert.match(notifyCalls[0].text, /draft-bad/);
    assert.match(notifyCalls[0].text, /date_preset/);
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

describe("runOptimisationTick — PR B live writes", () => {
  it("cooldown prefers last applied_at — a recent write skips evaluation", async () => {
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps({
      writesEnabled: true,
      loadOptedInCampaigns: async () => [campaign({ optimisationAutomationLive: true })],
      getAdSetState: async () => ({
        lastAppliedAt: new Date("2026-08-07T06:00:00Z"),
        lastDecidedAt: new Date("2026-08-01T00:00:00Z"),
        appliedIncreasePercentLast24h: 0,
      }),
      insertDecision: async (row) => void inserted.push(row),
      readAdSetDailyBudget: async () => 10000,
      updateAdSetDailyBudget: async () => ({ ok: true }),
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(summary.adSetsSkippedRecentDecision, 1);
    assert.equal(inserted.length, 0);
    assert.equal(summary.writesApplied, 0);
  });

  it("never-written ad set: recent shadow decided_at does not block a live write", async () => {
    const updates: number[] = [];
    const deps = makeDeps({
      writesEnabled: true,
      loadOptedInCampaigns: async () => [campaign({ optimisationAutomationLive: true })],
      getAdSetState: async () => ({
        lastAppliedAt: null,
        lastDecidedAt: new Date("2026-08-07T10:00:00Z"), // 2h ago shadow row
        appliedIncreasePercentLast24h: 0,
      }),
      insertDecision: async () => {},
      readAdSetDailyBudget: async () => 10000,
      updateAdSetDailyBudget: async (_id, pence) => {
        updates.push(pence);
        return { ok: true };
      },
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(summary.adSetsSkippedRecentDecision, 0);
    assert.equal(summary.writesApplied, 1);
    assert.deepEqual(updates, [13000]);
  });

  it("MAX_WRITES_PER_RUN shadows remaining scale actions after the cap", async () => {
    const updates: string[] = [];
    const notifyCalls: NotifyOptions[] = [];
    const deps = makeDeps({
      writesEnabled: true,
      maxWritesPerRun: 1,
      loadOptedInCampaigns: async () => [campaign({ optimisationAutomationLive: true })],
      fetchInsights: async () => [
        insightRow({ adsetId: "adset_a", adsetName: "A" }),
        insightRow({ adsetId: "adset_b", adsetName: "B" }),
      ],
      insertDecision: async () => {},
      readAdSetDailyBudget: async () => 10000,
      updateAdSetDailyBudget: async (id) => {
        updates.push(id);
        return { ok: true };
      },
      notify: async (opts) => {
        notifyCalls.push(opts);
        return { sent: true };
      },
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(summary.writesApplied, 1);
    assert.equal(summary.writesCapReached, true);
    assert.equal(updates.length, 1);
    assert.ok(notifyCalls.some((n) => n.channel === "ads_automation" && /MAX_WRITES_PER_RUN/.test(n.text)));
  });

  it("one ad set 500s and the rest still process (failure isolation)", async () => {
    const updates: string[] = [];
    const deps = makeDeps({
      writesEnabled: true,
      loadOptedInCampaigns: async () => [campaign({ optimisationAutomationLive: true })],
      fetchInsights: async () => [
        insightRow({ adsetId: "adset_bad", adsetName: "Bad" }),
        insightRow({ adsetId: "adset_good", adsetName: "Good" }),
      ],
      insertDecision: async () => {},
      readAdSetDailyBudget: async () => 10000,
      updateAdSetDailyBudget: async (id) => {
        if (id === "adset_bad") {
          throw Object.assign(new Error("Meta 500"), { name: "MetaApiError", code: 2 });
        }
        updates.push(id);
        return { ok: true };
      },
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(summary.writesFailed, 1);
    assert.equal(summary.writesApplied, 1);
    assert.deepEqual(updates, ["adset_good"]);
    assert.equal(summary.ok, true);
  });
});
