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

import { isBudgetChangeAction, lastChangeDecidedAt, skipNoRulesReason } from "../evaluate.ts";
import { generateRulesForObjective } from "../../optimisation-rules.ts";
import { whyForDecision } from "../../plan/decisions-sheet.ts";
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

describe("runOptimisationTick — skip_no_rules", () => {
  it("mode=none writes one campaign-level skip and never fetches ad sets", async () => {
    const inserted: DecisionToInsert[] = [];
    let fetchCalled = false;
    const notifyCalls: NotifyOptions[] = [];
    const deps = makeDeps({
      loadOptedInCampaigns: async () => [
        campaign({
          optimisationStrategy: { mode: "none", rules: [], guardrails: GUARDRAILS },
        }),
      ],
      fetchInsights: async () => {
        fetchCalled = true;
        return [insightRow(), insightRow({ adsetId: "adset_2" })];
      },
      insertDecision: async (row) => void inserted.push(row),
      notify: async (opts) => {
        notifyCalls.push(opts);
        return { sent: true };
      },
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(fetchCalled, false);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].actionRecommended, "skip_no_rules");
    assert.equal(inserted[0].scope, "campaign");
    assert.equal(inserted[0].adsetId, "camp_1");
    assert.equal(inserted[0].dryRun, true);
    assert.equal(inserted[0].applied, false);
    assert.equal(summary.decisionsInserted, 1);
    assert.equal(notifyCalls.length, 0);
  });

  it("zero enabled rules is the same named skip — not 13 maintains", async () => {
    const inserted: DecisionToInsert[] = [];
    let fetchCalled = false;
    const notifyCalls: NotifyOptions[] = [];
    const disabled = { ...CPR_RULE, enabled: false };
    const deps = makeDeps({
      loadOptedInCampaigns: async () => [
        campaign({
          optimisationStrategy: { mode: "custom", rules: [disabled], guardrails: GUARDRAILS },
        }),
      ],
      fetchInsights: async () => {
        fetchCalled = true;
        return [insightRow(), insightRow({ adsetId: "b" })];
      },
      insertDecision: async (row) => void inserted.push(row),
      notify: async (opts) => {
        notifyCalls.push(opts);
        return { sent: true };
      },
    });
    await runOptimisationTick(true, false, deps);
    assert.equal(fetchCalled, false);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].actionRecommended, "skip_no_rules");
    assert.equal(notifyCalls.length, 0);
  });

  it("enabled cpic rule with zero bands is skip_no_rules, not in-band maintain", async () => {
    const inserted: DecisionToInsert[] = [];
    const rules = generateRulesForObjective("initiate_checkout");
    const deps = makeDeps({
      loadOptedInCampaigns: async () => [
        campaign({
          objective: "initiate_checkout",
          optimisationStrategy: { mode: "benchmarks", rules, guardrails: GUARDRAILS },
        }),
      ],
      fetchInsights: async () => [
        insightRow({
          costPerActionType: {
            "offsite_conversion.fb_pixel_initiate_checkout": 4.2,
          },
          actionCountByType: {
            "offsite_conversion.fb_pixel_initiate_checkout": 9,
          },
        }),
      ],
      insertDecision: async (row) => void inserted.push(row),
    });
    await runOptimisationTick(true, false, deps);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0]!.actionRecommended, "skip_no_rules");
    assert.notEqual(inserted[0]!.reasonText, skipNoRulesReason("none"));
    assert.notEqual(inserted[0]!.reasonText, skipNoRulesReason("benchmarks"));
    assert.match(inserted[0]!.reasonText, /no threshold bands/);
    assert.match(inserted[0]!.reasonText, /campaign target/);
    assert.notEqual(
      whyForDecision({
        action: inserted[0]!.actionRecommended,
        decidedAt: "2026-09-13T12:00:00.000Z",
        metric: inserted[0]!.metric,
        metricValue: inserted[0]!.metricValue,
        resultCount: inserted[0]!.resultCount ?? null,
        metricWindow: inserted[0]!.metricWindow,
        ruleMatched: inserted[0]!.ruleMatched ?? "",
        budgetBeforePence: inserted[0]!.budgetBeforePence,
        budgetAfterPence: inserted[0]!.budgetAfterPence,
        applied: false,
        dryRun: true,
        reasonText: inserted[0]!.reasonText,
        kind: "dry_run",
        channel: "meta",
        scope: "ad_set",
        adsetId: inserted[0]!.adsetId,
        adsetName: null,
      }),
      "in band",
    );
  });

  it("CBO checkout with zero bands is the same named skip, not in-band maintain", async () => {
    const inserted: DecisionToInsert[] = [];
    const rules = generateRulesForObjective("initiate_checkout");
    const deps = makeDeps({
      loadOptedInCampaigns: async () => [
        campaign({
          objective: "initiate_checkout",
          optimisationStrategy: { mode: "benchmarks", rules, guardrails: GUARDRAILS },
        }),
      ],
      fetchInsights: async () => [
        insightRow({ adsetId: "a", dailyBudgetPence: null }),
        insightRow({ adsetId: "b", dailyBudgetPence: null }),
      ],
      fetchCampaignInsights: async () => ({
        campaignId: "camp_1",
        dailyBudgetPence: 15000,
        lifetimeBudgetPence: null,
        impressions: 8000,
        cpc: null,
        cpm: null,
        ctr: null,
        costPerActionType: {
          "offsite_conversion.fb_pixel_initiate_checkout": 4.2,
        },
        actionCountByType: {
          "offsite_conversion.fb_pixel_initiate_checkout": 9,
        },
      }),
      insertDecision: async (row) => void inserted.push(row),
    });
    await runOptimisationTick(true, false, deps);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0]!.scope, "campaign");
    assert.equal(inserted[0]!.actionRecommended, "skip_no_rules");
    assert.notEqual(inserted[0]!.reasonText, skipNoRulesReason("none"));
    assert.match(inserted[0]!.reasonText, /no threshold bands/);
  });

  it("a rule with bands whose value falls in a gap stays maintain, not skip_no_rules", async () => {
    // Awareness CPM: below 3 scale, 3–6 maintain, above 8 reduce. £7 is
    // a real gap on eight live drafts. nameEmptyMatchingLadder must not
    // reclassify it just because ruleMatched is null.
    const inserted: DecisionToInsert[] = [];
    const rules = generateRulesForObjective("awareness");
    const deps = makeDeps({
      loadOptedInCampaigns: async () => [
        campaign({
          objective: "awareness",
          optimisationStrategy: { mode: "benchmarks", rules, guardrails: GUARDRAILS },
        }),
      ],
      fetchInsights: async () => [
        insightRow({
          cpm: 7,
          costPerActionType: {},
          actionCountByType: {},
        }),
      ],
      insertDecision: async (row) => void inserted.push(row),
    });
    await runOptimisationTick(true, false, deps);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0]!.actionRecommended, "maintain");
    assert.equal(inserted[0]!.ruleMatched, null);
    assert.equal(inserted[0]!.metricValue, 7);
    assert.match(inserted[0]!.reasonText, /matched no threshold band/);
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

describe("runOptimisationTick — eligibility before evaluate", () => {
  const DOD_PAUSE_RULE: OptimisationRule = {
    id: tid(),
    name: "Primary",
    metric: "cpr",
    timeWindow: "7d",
    enabled: true,
    thresholds: [
      { id: tid(), operator: "below", value: 0.85, action: "increase_budget", actionValue: 30, label: "Below £0.85 CPR → scale" },
      { id: tid(), operator: "above", value: 1.75, action: "pause", label: "Above £1.75 CPR → pause" },
    ],
  };

  it("PAUSED ad set inside an ACTIVE campaign is skip_not_delivering — the roll-down trap", async () => {
    const inserted: DecisionToInsert[] = [];
    let evaluateReached = false;
    const deps = makeDeps({
      fetchInsights: async () => [
        insightRow({
          effectiveStatus: "PAUSED",
          costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 0.4 },
        }),
      ],
      insertDecision: async (row) => {
        evaluateReached = row.actionRecommended === "scale_up";
        inserted.push(row);
      },
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(inserted[0]?.actionRecommended, "skip_not_delivering");
    assert.equal(evaluateReached, false);
    assert.equal(summary.decisionsByAction.skip_not_delivering, 1);
    assert.equal(summary.pausesRecommended, 0);
  });

  it("a campaign past campaign_end_at is skip_campaign_ended", async () => {
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps({
      loadOptedInCampaigns: async () => [
        campaign({
          eligibility: { campaignEndAt: "2026-09-01T00:00:00Z" },
        }),
      ],
      now: new Date("2026-09-09T20:01:05Z"),
      insertDecision: async (row) => void inserted.push(row),
    });
    await runOptimisationTick(true, false, deps);
    assert.equal(inserted[0]?.actionRecommended, "skip_campaign_ended");
  });

  it("an event in the past is skip_event_passed", async () => {
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps({
      loadOptedInCampaigns: async () => [
        campaign({ eligibility: { eventDate: "2026-09-01" } }),
      ],
      now: new Date("2026-09-09T20:01:05Z"),
      insertDecision: async (row) => void inserted.push(row),
    });
    await runOptimisationTick(true, false, deps);
    assert.equal(inserted[0]?.actionRecommended, "skip_event_passed");
  });

  it("D.O.D 2026-09-09 20:01 — presale after general sale is skip_phase_ended, not pause", async () => {
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps({
      now: new Date("2026-09-09T20:01:05Z"),
      loadOptedInCampaigns: async () => [
        campaign({
          campaignName: "[NX26-DOD] DOD - Signup - Artist",
          optimisationStrategy: {
            mode: "custom",
            rules: [DOD_PAUSE_RULE],
            guardrails: GUARDRAILS,
          },
          eligibility: {
            planPhase: "presale",
            generalSaleAt: "2026-09-01T10:00:00Z",
            eventDate: "2026-11-26",
          },
        }),
      ],
      fetchInsights: async () => [
        insightRow({
          effectiveStatus: "ACTIVE",
          impressions: 12000,
          costPerActionType: {
            "offsite_conversion.fb_pixel_complete_registration": 2.773,
          },
          actionCountByType: {
            "offsite_conversion.fb_pixel_complete_registration": 40,
          },
        }),
      ],
      insertDecision: async (row) => void inserted.push(row),
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(inserted[0]?.actionRecommended, "skip_phase_ended");
    assert.notEqual(inserted[0]?.actionRecommended, "pause");
    assert.equal(summary.pausesRecommended, 0);
  });

  it("a live in-window campaign still scales", async () => {
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps({
      now: new Date("2026-09-09T20:01:05Z"),
      loadOptedInCampaigns: async () => [
        campaign({
          eligibility: {
            campaignEndAt: "2026-12-01",
            eventDate: "2026-12-15",
          },
        }),
      ],
      insertDecision: async (row) => void inserted.push(row),
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(inserted[0]?.actionRecommended, "scale_up");
    assert.equal(summary.decisionsByAction.scale_up, 1);
  });

  it("an eligibility skip does not read cooldown state", async () => {
    let stateReads = 0;
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps({
      fetchInsights: async () => [insightRow({ effectiveStatus: "PAUSED" })],
      getAdSetState: async () => {
        stateReads += 1;
        return {
          lastAppliedAt: new Date("2026-09-09T18:00:00Z"),
          lastDecidedAt: new Date("2026-09-09T18:00:00Z"),
          appliedIncreasePercentLast24h: 30,
        };
      },
      insertDecision: async (row) => void inserted.push(row),
      now: new Date("2026-09-09T20:01:05Z"),
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(stateReads, 0);
    assert.equal(inserted[0]?.actionRecommended, "skip_not_delivering");
    assert.equal(summary.adSetsSkippedRecentDecision, 0);
    assert.equal(isBudgetChangeAction(inserted[0]?.actionRecommended ?? ""), false);
  });
});

describe("runOptimisationTick — campaign daily ceiling", () => {
  const campaignCeilingGuardrails: BudgetGuardrails = {
    ...GUARDRAILS,
    hardBudgetCeiling: 500,
    ceilingBehaviour: "partial",
    budgetCeilingScope: "campaign",
    campaignDailyCeilingSource: "derived",
  };

  function campaignWithPlan(
    guardrails: BudgetGuardrails,
    overrides: Partial<CampaignAutomationInput> = {},
  ): CampaignAutomationInput {
    return campaign({
      optimisationStrategy: { mode: "custom", rules: [CPR_RULE], guardrails },
      enabledDailyBudgetsMajor: [125],
      startDate: "2026-08-01",
      endDate: "2026-08-13",
      ...overrides,
    });
  }

  it("£256/day with a £300/day derived ceiling grants one +30% and caps the rest", async () => {
    const rows: DecisionToInsert[] = [];
    const deps = makeDeps({
      loadOptedInCampaigns: async () => [campaignWithPlan(campaignCeilingGuardrails)],
      fetchCampaignSpendPence: async () => 0,
      fetchInsights: async () => [
        insightRow({
          adsetId: "cheap",
          adsetName: "Cheap",
          dailyBudgetPence: 10000,
          costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 0.3 },
        }),
        insightRow({
          adsetId: "mid",
          adsetName: "Mid",
          dailyBudgetPence: 5200,
          costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 0.4 },
        }),
        insightRow({
          adsetId: "dear",
          adsetName: "Dear",
          dailyBudgetPence: 5200,
          costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 0.5 },
        }),
        insightRow({
          adsetId: "dearest",
          adsetName: "Dearest",
          dailyBudgetPence: 5200,
          costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 0.6 },
        }),
      ],
      insertDecision: async (row) => {
        rows.push(row);
      },
    });
    await runOptimisationTick(true, false, deps);
    const byId = Object.fromEntries(rows.map((r) => [r.adsetId, r]));
    assert.equal(byId.cheap.actionRecommended, "scale_up");
    assert.equal(byId.cheap.budgetAfterPence, 13000);
    assert.equal(byId.cheap.guardrailNote, null);
    assert.equal(byId.mid.actionRecommended, "scale_up");
    assert.equal(byId.mid.budgetAfterPence, 6600);
    assert.equal(byId.mid.guardrailNote, "capped_by_campaign_ceiling");
    assert.equal(byId.dear.actionRecommended, "maintain");
    assert.equal(byId.dear.guardrailNote, "capped_by_campaign_ceiling");
    assert.equal(byId.dearest.actionRecommended, "maintain");
    assert.equal(byId.dearest.guardrailNote, "capped_by_campaign_ceiling");
  });

  it("the same campaign at £300/day grants nothing", async () => {
    const rows: DecisionToInsert[] = [];
    const deps = makeDeps({
      loadOptedInCampaigns: async () => [campaignWithPlan(campaignCeilingGuardrails)],
      fetchCampaignSpendPence: async () => 0,
      fetchInsights: async () => [
        insightRow({ adsetId: "a", dailyBudgetPence: 10000 }),
        insightRow({ adsetId: "b", dailyBudgetPence: 10000 }),
        insightRow({ adsetId: "c", dailyBudgetPence: 10000 }),
      ],
      insertDecision: async (row) => {
        rows.push(row);
      },
    });
    await runOptimisationTick(true, false, deps);
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.actionRecommended, "maintain");
      assert.equal(row.budgetAfterPence, row.budgetBeforePence);
      assert.equal(row.guardrailNote, "capped_by_campaign_ceiling");
    }
  });

  it("headroom decrements — thirteen ad sets cannot each take the full amount", async () => {
    const rows: DecisionToInsert[] = [];
    const deps = makeDeps({
      loadOptedInCampaigns: async () => [campaignWithPlan(campaignCeilingGuardrails)],
      fetchCampaignSpendPence: async () => 0,
      fetchInsights: async () =>
        Array.from({ length: 13 }, (_, i) =>
          insightRow({
            adsetId: `as_${i}`,
            adsetName: `Set ${i}`,
            dailyBudgetPence: 2000,
            costPerActionType: {
              "offsite_conversion.fb_pixel_complete_registration": 0.2 + i * 0.01,
            },
          }),
        ),
      insertDecision: async (row) => {
        rows.push(row);
      },
    });
    await runOptimisationTick(true, false, deps);
    const increases = rows.map((r) => r.budgetAfterPence - r.budgetBeforePence);
    const totalIncrease = increases.reduce((s, n) => s + n, 0);
    assert.equal(totalIncrease, 4000);
    assert.equal(increases.filter((n) => n === 600).length < 13, true);
    assert.equal(rows.some((r) => r.guardrailNote === "capped_by_campaign_ceiling"), true);
  });

  it("no plan and no typed ceiling behaves exactly as today, with the absence named", async () => {
    const rows: DecisionToInsert[] = [];
    const deps = makeDeps({
      loadOptedInCampaigns: async () => [
        campaign({
          optimisationStrategy: {
            mode: "custom",
            rules: [CPR_RULE],
            guardrails: {
              ...GUARDRAILS,
              budgetCeilingScope: "campaign",
              campaignDailyCeilingSource: "derived",
            },
          },
        }),
      ],
      fetchInsights: async () => [insightRow({ adsetId: "only" })],
      insertDecision: async (row) => {
        rows.push(row);
      },
    });
    await runOptimisationTick(true, false, deps);
    assert.equal(rows[0]!.actionRecommended, "scale_up");
    assert.equal(rows[0]!.budgetAfterPence, 13000);
    assert.equal(rows[0]!.guardrailNote, "campaign_ceiling_absent");
  });

  it("an unreadable plan is named, not treated as unlimited", async () => {
    const rows: DecisionToInsert[] = [];
    const deps = makeDeps({
      loadOptedInCampaigns: async () => [campaignWithPlan(campaignCeilingGuardrails)],
      fetchCampaignSpendPence: async () => {
        throw new Error("insights 500");
      },
      fetchInsights: async () => [insightRow({ adsetId: "only" })],
      insertDecision: async (row) => {
        rows.push(row);
      },
    });
    await runOptimisationTick(true, false, deps);
    assert.equal(rows[0]!.actionRecommended, "scale_up");
    assert.equal(rows[0]!.budgetAfterPence, 13000);
    assert.equal(rows[0]!.guardrailNote, "campaign_ceiling_unreadable");
  });

  it("per-ad-set and campaign ceilings together bind on the tighter", async () => {
    const rows: DecisionToInsert[] = [];
    const deps = makeDeps({
      loadOptedInCampaigns: async () => [
        campaignWithPlan({
          ...campaignCeilingGuardrails,
          budgetCeilingScope: "both",
          maxSingleAdSetBudget: 105,
          maxSingleAdSetBudgetType: "fixed",
        }),
      ],
      fetchCampaignSpendPence: async () => 0,
      fetchInsights: async () => [
        insightRow({
          adsetId: "a",
          dailyBudgetPence: 10000,
          costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 0.3 },
        }),
        insightRow({
          adsetId: "b",
          dailyBudgetPence: 10000,
          costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 0.4 },
        }),
        insightRow({
          adsetId: "idle",
          dailyBudgetPence: 9200,
          costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 3 },
        }),
      ],
      insertDecision: async (row) => {
        rows.push(row);
      },
    });
    await runOptimisationTick(true, false, deps);
    const byId = Object.fromEntries(rows.map((r) => [r.adsetId, r]));
    assert.equal(byId.a.budgetAfterPence, 10500);
    assert.equal(byId.a.guardrailNote, "capped_by_max_single_adset_budget");
    assert.equal(byId.b.budgetAfterPence, 10300);
    assert.equal(byId.b.guardrailNote, "capped_by_campaign_ceiling");
    assert.equal(byId.idle.actionRecommended, "maintain");
  });
});

const PAUSE_FLOOR_GUARDRAILS: BudgetGuardrails = {
  ...GUARDRAILS,
  pauseFloorBudget: 20,
};

function pauseInsight(overrides: Partial<AdSetInsightRow> = {}): AdSetInsightRow {
  return insightRow({
    costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 6 },
    actionCountByType: { "offsite_conversion.fb_pixel_complete_registration": 20 },
    dailyBudgetPence: 2000,
    ...overrides,
  });
}

describe("runOptimisationTick — pause writes", () => {
  it("fourth gate closed — live campaign still only recommends pause", async () => {
    const pauses: string[] = [];
    const deps = makeDeps({
      writesEnabled: true,
      pauseWritesEnabled: false,
      loadOptedInCampaigns: async () => [
        campaign({
          optimisationAutomationLive: true,
          optimisationStrategy: { mode: "custom", rules: [CPR_RULE], guardrails: PAUSE_FLOOR_GUARDRAILS },
        }),
      ],
      fetchInsights: async () => [
        pauseInsight({ adsetId: "adset_a" }),
        pauseInsight({ adsetId: "adset_b" }),
      ],
      insertDecision: async () => {},
      readAdSetDailyBudget: async () => 2000,
      pauseAdSet: async (id) => {
        pauses.push(id);
        return { id, status: "PAUSED" };
      },
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(pauses.length, 0);
    assert.equal(summary.pausesRecommended, 2);
    assert.equal(summary.pauseLadderWrites, 0);
  });

  it("campaign-wide breach — N of N, no pause write", async () => {
    const pauses: string[] = [];
    const notifyCalls: NotifyOptions[] = [];
    const deps = makeDeps({
      writesEnabled: true,
      pauseWritesEnabled: true,
      loadOptedInCampaigns: async () => [
        campaign({
          optimisationAutomationLive: true,
          optimisationStrategy: { mode: "custom", rules: [CPR_RULE], guardrails: PAUSE_FLOOR_GUARDRAILS },
        }),
      ],
      fetchInsights: async () => [
        pauseInsight({ adsetId: "adset_a" }),
        pauseInsight({ adsetId: "adset_b" }),
      ],
      insertDecision: async () => {},
      readAdSetDailyBudget: async () => 2000,
      pauseAdSet: async (id) => {
        pauses.push(id);
        return { id, status: "PAUSED" };
      },
      notify: async (opts) => {
        notifyCalls.push(opts);
        return { sent: true };
      },
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(pauses.length, 0);
    assert.equal(summary.pauseLadderWrites, 0);
    assert.ok(
      notifyCalls.some((n) => /campaign-wide breach — 2 of 2 ad sets over threshold/.test(n.text)),
    );
  });

  it("three of four breaching is campaign-wide — no floor cut, no pause", async () => {
    const pauses: string[] = [];
    const updates: string[] = [];
    const deps = makeDeps({
      writesEnabled: true,
      pauseWritesEnabled: true,
      loadOptedInCampaigns: async () => [
        campaign({
          optimisationAutomationLive: true,
          optimisationStrategy: { mode: "custom", rules: [CPR_RULE], guardrails: PAUSE_FLOOR_GUARDRAILS },
        }),
      ],
      fetchInsights: async () => [
        pauseInsight({ adsetId: "adset_a", dailyBudgetPence: 10000 }),
        pauseInsight({ adsetId: "adset_b", dailyBudgetPence: 10000 }),
        pauseInsight({ adsetId: "adset_c", dailyBudgetPence: 10000 }),
        insightRow({
          adsetId: "adset_ok",
          costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 3 },
          actionCountByType: { "offsite_conversion.fb_pixel_complete_registration": 20 },
        }),
      ],
      insertDecision: async () => {},
      readAdSetDailyBudget: async () => 10000,
      updateAdSetDailyBudget: async (id) => {
        updates.push(id);
        return { ok: true };
      },
      pauseAdSet: async (id) => {
        pauses.push(id);
        return { id, status: "PAUSED" };
      },
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(pauses.length, 0);
    assert.equal(updates.length, 0);
    assert.equal(summary.pauseLadderWrites, 0);
    assert.equal(summary.writesApplied, 0);
  });

  it("a pause with resultCount 5 writes nothing", async () => {
    const pauses: string[] = [];
    const updates: string[] = [];
    const deps = makeDeps({
      writesEnabled: true,
      pauseWritesEnabled: true,
      loadOptedInCampaigns: async () => [
        campaign({
          optimisationAutomationLive: true,
          optimisationStrategy: { mode: "custom", rules: [CPR_RULE], guardrails: PAUSE_FLOOR_GUARDRAILS },
        }),
      ],
      fetchInsights: async () => [
        insightRow({
          adsetId: "adset_ok",
          costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 3 },
          actionCountByType: { "offsite_conversion.fb_pixel_complete_registration": 20 },
        }),
        pauseInsight({
          adsetId: "adset_thin",
          dailyBudgetPence: 10000,
          actionCountByType: { "offsite_conversion.fb_pixel_complete_registration": 5 },
        }),
      ],
      insertDecision: async () => {},
      readAdSetDailyBudget: async () => 10000,
      updateAdSetDailyBudget: async (id) => {
        updates.push(id);
        return { ok: true };
      },
      pauseAdSet: async (id) => {
        pauses.push(id);
        return { id, status: "PAUSED" };
      },
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(pauses.length, 0);
    assert.equal(updates.length, 0);
    assert.equal(summary.pauseLadderWrites, 0);
  });

  it("the only active ad set is not cut to floor", async () => {
    const pauses: string[] = [];
    const updates: string[] = [];
    const deps = makeDeps({
      writesEnabled: true,
      pauseWritesEnabled: true,
      loadOptedInCampaigns: async () => [
        campaign({
          optimisationAutomationLive: true,
          optimisationStrategy: { mode: "custom", rules: [CPR_RULE], guardrails: PAUSE_FLOOR_GUARDRAILS },
        }),
      ],
      fetchInsights: async () => [pauseInsight({ dailyBudgetPence: 10000 })],
      insertDecision: async () => {},
      readAdSetDailyBudget: async () => 10000,
      updateAdSetDailyBudget: async (id) => {
        updates.push(id);
        return { ok: true };
      },
      pauseAdSet: async (id) => {
        pauses.push(id);
        return { id, status: "PAUSED" };
      },
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(pauses.length, 0);
    assert.equal(updates.length, 0);
    assert.equal(summary.pauseLadderWrites, 0);
  });

  it("floor cuts draw down the pause budget, not MAX_WRITES_PER_RUN", async () => {
    const pauses: string[] = [];
    const updates: string[] = [];
    const deps = makeDeps({
      writesEnabled: true,
      pauseWritesEnabled: true,
      maxPausesPerRun: 2,
      loadOptedInCampaigns: async () => [
        campaign({
          optimisationAutomationLive: true,
          optimisationStrategy: { mode: "custom", rules: [CPR_RULE], guardrails: PAUSE_FLOOR_GUARDRAILS },
        }),
      ],
      fetchInsights: async () => [
        pauseInsight({ adsetId: "adset_a", dailyBudgetPence: 10000 }),
        pauseInsight({ adsetId: "adset_b", dailyBudgetPence: 10000 }),
        pauseInsight({ adsetId: "adset_c", dailyBudgetPence: 10000 }),
        insightRow({
          adsetId: "ok_1",
          costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 3 },
          actionCountByType: { "offsite_conversion.fb_pixel_complete_registration": 20 },
        }),
        insightRow({
          adsetId: "ok_2",
          costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 3 },
          actionCountByType: { "offsite_conversion.fb_pixel_complete_registration": 20 },
        }),
        insightRow({
          adsetId: "ok_3",
          costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 3 },
          actionCountByType: { "offsite_conversion.fb_pixel_complete_registration": 20 },
        }),
      ],
      insertDecision: async () => {},
      readAdSetDailyBudget: async () => 10000,
      updateAdSetDailyBudget: async (id) => {
        updates.push(id);
        return { ok: true };
      },
      pauseAdSet: async (id) => {
        pauses.push(id);
        return { id, status: "PAUSED" };
      },
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(pauses.length, 0);
    assert.equal(updates.length, 2);
    assert.equal(summary.pauseLadderWrites, 2);
    assert.equal(summary.writesApplied, 0);
  });

  it("one breaching ad set at the floor is paused; a healthy sibling keeps the campaign alive", async () => {
    const pauses: string[] = [];
    const deps = makeDeps({
      writesEnabled: true,
      pauseWritesEnabled: true,
      loadOptedInCampaigns: async () => [
        campaign({
          optimisationAutomationLive: true,
          optimisationStrategy: { mode: "custom", rules: [CPR_RULE], guardrails: PAUSE_FLOOR_GUARDRAILS },
        }),
      ],
      fetchInsights: async () => [
        insightRow({ adsetId: "adset_healthy" }),
        pauseInsight({ adsetId: "adset_bad" }),
      ],
      insertDecision: async () => {},
      readAdSetDailyBudget: async (id) => (id === "adset_bad" ? 2000 : 10000),
      updateAdSetDailyBudget: async () => ({ ok: true }),
      pauseAdSet: async (id) => {
        pauses.push(id);
        return { id, status: "PAUSED" };
      },
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.deepEqual(pauses, ["adset_bad"]);
    assert.equal(summary.pauseLadderWrites, 1);
  });

  it("a cooldown breacher is not persisted and receives no Meta call", async () => {
    const pauses: string[] = [];
    const updates: string[] = [];
    const inserted: DecisionToInsert[] = [];
    const now = new Date("2026-08-07T12:00:00Z");
    const deps = makeDeps({
      writesEnabled: true,
      pauseWritesEnabled: true,
      now,
      loadOptedInCampaigns: async () => [
        campaign({
          optimisationAutomationLive: true,
          optimisationStrategy: { mode: "custom", rules: [CPR_RULE], guardrails: PAUSE_FLOOR_GUARDRAILS },
        }),
      ],
      getAdSetState: async (adsetId) => ({
        lastAppliedAt: adsetId === "adset_cool" ? new Date("2026-08-07T11:00:00Z") : null,
        lastDecidedAt: adsetId === "adset_cool" ? new Date("2026-08-07T11:00:00Z") : null,
        appliedIncreasePercentLast24h: 0,
      }),
      fetchInsights: async () => [
        pauseInsight({ adsetId: "adset_cool", dailyBudgetPence: 10000 }),
        pauseInsight({ adsetId: "adset_hot", dailyBudgetPence: 10000 }),
        insightRow({
          adsetId: "ok_1",
          costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 3 },
          actionCountByType: { "offsite_conversion.fb_pixel_complete_registration": 20 },
        }),
        insightRow({
          adsetId: "ok_2",
          costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 3 },
          actionCountByType: { "offsite_conversion.fb_pixel_complete_registration": 20 },
        }),
        insightRow({
          adsetId: "ok_3",
          costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 3 },
          actionCountByType: { "offsite_conversion.fb_pixel_complete_registration": 20 },
        }),
      ],
      insertDecision: async (row) => void inserted.push(row),
      readAdSetDailyBudget: async () => 10000,
      updateAdSetDailyBudget: async (id) => {
        updates.push(id);
        return { ok: true };
      },
      pauseAdSet: async (id) => {
        pauses.push(id);
        return { id, status: "PAUSED" };
      },
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(summary.adSetsSkippedRecentDecision, 1);
    assert.equal(inserted.filter((row) => row.adsetId === "adset_cool").length, 0);
    assert.equal(pauses.includes("adset_cool"), false);
    assert.equal(updates.includes("adset_cool"), false);
    assert.deepEqual(updates, ["adset_hot"]);
    assert.equal(pauses.length, 0);
    assert.equal(summary.pauseLadderWrites, 1);
  });

  it("cooldown on one breacher still counts in the same-set majority — no floor, no pause", async () => {
    const pauses: string[] = [];
    const updates: string[] = [];
    const now = new Date("2026-08-07T12:00:00Z");
    const deps = makeDeps({
      writesEnabled: true,
      pauseWritesEnabled: true,
      now,
      loadOptedInCampaigns: async () => [
        campaign({
          optimisationAutomationLive: true,
          optimisationStrategy: { mode: "custom", rules: [CPR_RULE], guardrails: PAUSE_FLOOR_GUARDRAILS },
        }),
      ],
      getAdSetState: async (adsetId) => ({
        lastAppliedAt: adsetId === "adset_a" ? new Date("2026-08-07T11:00:00Z") : null,
        lastDecidedAt: adsetId === "adset_a" ? new Date("2026-08-07T11:00:00Z") : null,
        appliedIncreasePercentLast24h: 0,
      }),
      fetchInsights: async () => [
        pauseInsight({ adsetId: "adset_a", dailyBudgetPence: 10000 }),
        pauseInsight({ adsetId: "adset_b", dailyBudgetPence: 10000 }),
        pauseInsight({ adsetId: "adset_c", dailyBudgetPence: 10000 }),
        insightRow({
          adsetId: "adset_ok",
          costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 3 },
          actionCountByType: { "offsite_conversion.fb_pixel_complete_registration": 20 },
        }),
      ],
      insertDecision: async () => {},
      readAdSetDailyBudget: async () => 10000,
      updateAdSetDailyBudget: async (id) => {
        updates.push(id);
        return { ok: true };
      },
      pauseAdSet: async (id) => {
        pauses.push(id);
        return { id, status: "PAUSED" };
      },
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.equal(summary.adSetsSkippedRecentDecision, 1);
    assert.equal(pauses.length, 0);
    assert.equal(updates.length, 0);
    assert.equal(summary.pauseLadderWrites, 0);
  });

  it("skip_campaign_ended is written before the pause ladder — no floor, no pause", async () => {
    const pauses: string[] = [];
    const updates: string[] = [];
    const inserted: DecisionToInsert[] = [];
    const deps = makeDeps({
      writesEnabled: true,
      pauseWritesEnabled: true,
      now: new Date("2026-09-09T20:01:05Z"),
      loadOptedInCampaigns: async () => [
        campaign({
          optimisationAutomationLive: true,
          eligibility: { campaignEndAt: "2026-09-01T00:00:00Z" },
          optimisationStrategy: { mode: "custom", rules: [CPR_RULE], guardrails: PAUSE_FLOOR_GUARDRAILS },
        }),
      ],
      fetchInsights: async () => [
        pauseInsight({ adsetId: "adset_a" }),
        pauseInsight({ adsetId: "adset_b" }),
      ],
      insertDecision: async (row) => void inserted.push(row),
      readAdSetDailyBudget: async () => 2000,
      updateAdSetDailyBudget: async (id) => {
        updates.push(id);
        return { ok: true };
      },
      pauseAdSet: async (id) => {
        pauses.push(id);
        return { id, status: "PAUSED" };
      },
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.ok(inserted.every((row) => row.actionRecommended === "skip_campaign_ended"));
    assert.equal(summary.decisionsByAction.skip_campaign_ended, 2);
    assert.equal(pauses.length, 0);
    assert.equal(updates.length, 0);
    assert.equal(summary.pauseLadderWrites, 0);
    assert.equal(summary.pausesRecommended, 0);
  });

  it("an empty checkout ladder cannot produce a pause even when the fourth gate is open", async () => {
    const pauses: string[] = [];
    const inserted: DecisionToInsert[] = [];
    const rules = generateRulesForObjective("initiate_checkout");
    const deps = makeDeps({
      writesEnabled: true,
      pauseWritesEnabled: true,
      loadOptedInCampaigns: async () => [
        campaign({
          objective: "initiate_checkout",
          optimisationAutomationLive: true,
          optimisationStrategy: { mode: "benchmarks", rules, guardrails: PAUSE_FLOOR_GUARDRAILS },
        }),
      ],
      fetchInsights: async () => [
        insightRow({
          costPerActionType: {
            "offsite_conversion.fb_pixel_initiate_checkout": 40,
          },
          actionCountByType: {
            "offsite_conversion.fb_pixel_initiate_checkout": 20,
          },
        }),
        insightRow({
          adsetId: "adset_ok",
          costPerActionType: {
            "offsite_conversion.fb_pixel_initiate_checkout": 1,
          },
          actionCountByType: {
            "offsite_conversion.fb_pixel_initiate_checkout": 20,
          },
        }),
      ],
      insertDecision: async (row) => void inserted.push(row),
      readAdSetDailyBudget: async () => 2000,
      pauseAdSet: async (id) => {
        pauses.push(id);
        return { id, status: "PAUSED" };
      },
    });
    const summary = await runOptimisationTick(true, false, deps);
    assert.ok(inserted.every((row) => row.actionRecommended === "skip_no_rules"));
    assert.equal(pauses.length, 0);
    assert.equal(summary.pauseLadderWrites, 0);
    assert.equal(summary.pausesRecommended, 0);
  });

  it("a floor cut does not credit pence back into #933 campaign headroom", async () => {
    const updates: Array<{ id: string; pence: number }> = [];
    const deps = makeDeps({
      writesEnabled: true,
      pauseWritesEnabled: true,
      loadOptedInCampaigns: async () => [
        campaign({
          optimisationAutomationLive: true,
          optimisationStrategy: {
            mode: "custom",
            rules: [CPR_RULE],
            guardrails: {
              ...PAUSE_FLOOR_GUARDRAILS,
              budgetCeilingScope: "campaign",
              campaignDailyCeilingSource: "typed",
              campaignDailyCeiling: 220,
            },
          },
        }),
      ],
      fetchInsights: async () => [
        pauseInsight({ adsetId: "adset_bad", dailyBudgetPence: 10000 }),
        insightRow({
          adsetId: "adset_good",
          dailyBudgetPence: 10000,
          costPerActionType: { "offsite_conversion.fb_pixel_complete_registration": 0.3 },
          actionCountByType: { "offsite_conversion.fb_pixel_complete_registration": 20 },
        }),
      ],
      insertDecision: async () => {},
      readAdSetDailyBudget: async () => 10000,
      updateAdSetDailyBudget: async (id, pence) => {
        updates.push({ id, pence });
        return { ok: true };
      },
      pauseAdSet: async () => {
        throw new Error("pause must not run — the breacher is above the floor");
      },
    });
    const summary = await runOptimisationTick(true, false, deps);
    const bad = updates.find((u) => u.id === "adset_bad");
    const good = updates.find((u) => u.id === "adset_good");
    assert.equal(bad?.pence, 2000);
    // Headroom is 22000 − 20000 = 2000. Crediting the 8000p floor cut
    // would let the scale-up take the full +30% (13000).
    assert.equal(good?.pence, 12000);
    assert.equal(summary.pauseLadderWrites, 1);
    assert.equal(summary.writesApplied, 1);
  });
});
