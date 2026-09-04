/**
 * M.4 — cross-channel Optimisation Strategy shadow.
 * Run: node --test lib/optimisation/__tests__/cross-channel.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { BudgetGuardrails, OptimisationRule } from "../../types.ts";
import {
  CHANNEL_METRIC_AVAILABILITY,
  CROSS_CHANNEL_SHADOW_GATES,
  METRIC_UNAVAILABLE,
  aggregateChannelRollup,
  evaluateCrossChannelSubject,
  type CrossChannelSubject,
} from "../cross-channel.ts";
import { runOptimisationTick, type DecisionToInsert } from "../tick-runner.ts";
import type { AdSetInsightRow } from "../insights-fetch.ts";
import type { CampaignAutomationInput } from "../tick-runner.ts";

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

function subject(overrides: Partial<CrossChannelSubject> = {}): CrossChannelSubject {
  return {
    planId: "plan-1",
    eventId: "event-1",
    metaDraftId: "draft-1",
    channel: "tiktok",
    campaignId: "tt_camp",
    adAccountId: "act_123",
    dailyBudgetMajor: 40,
    optimisationStrategy: { mode: "custom", rules: [CPR_RULE], guardrails: GUARDRAILS },
    objective: "registration",
    campaignName: "Plan · tiktok",
    ...overrides,
  };
}

function metaCampaign(overrides: Partial<CampaignAutomationInput> = {}): CampaignAutomationInput {
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

function insightRow(): AdSetInsightRow {
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
  };
}

describe("channel metric inventory is honest", () => {
  it("names the real spend and result columns per channel", () => {
    const byChannel = Object.fromEntries(
      CHANNEL_METRIC_AVAILABILITY.map((row) => [row.channel, row]),
    );
    assert.equal(byChannel.tiktok.spendColumn, "tiktok_spend");
    assert.equal(byChannel.tiktok.resultColumn, "tiktok_results");
    assert.equal(byChannel.tiktok.grain, "event_daily_rollups");
    assert.equal(byChannel.google.spendColumn, "google_ads_spend");
    assert.equal(byChannel.google.resultColumn, "google_ads_conversions");
    assert.equal(byChannel.google.grain, "event_daily_rollups");
    assert.equal(byChannel.meta.grain, "adset_insights");
  });
});

describe("aggregateChannelRollup — absent columns are not zero", () => {
  it("marks resultColumnPresent false when tiktok_results is missing from the fixture", () => {
    const rollup = aggregateChannelRollup(
      [{ tiktok_spend: 12.5, tiktok_impressions: 400 }],
      "tiktok",
    );
    assert.equal(rollup.spendColumnPresent, true);
    assert.equal(rollup.resultColumnPresent, false);
    assert.equal(rollup.spend, 12.5);
    assert.equal(rollup.results, null);
  });

  it("sums present result columns and treats explicit 0 as present", () => {
    const rollup = aggregateChannelRollup(
      [
        { google_ads_spend: 10, google_ads_conversions: 0, google_ads_impressions: 100 },
        { google_ads_spend: 5, google_ads_conversions: 0, google_ads_impressions: 50 },
      ],
      "google",
    );
    assert.equal(rollup.resultColumnPresent, true);
    assert.equal(rollup.results, 0);
    assert.equal(rollup.spend, 15);
  });
});

describe("evaluateCrossChannelSubject — metric_unavailable vs CPR", () => {
  const now = new Date("2026-08-26T12:00:00Z");

  it("records metric_unavailable when spend exists but the result column is absent", () => {
    const decision = evaluateCrossChannelSubject(
      subject(),
      {
        spend: 12.5,
        results: null,
        impressions: 400,
        spendColumnPresent: true,
        resultColumnPresent: false,
      },
      "24h",
      now,
      null,
      0,
    );
    assert.equal(decision.actionRecommended, METRIC_UNAVAILABLE);
    assert.equal(decision.metricValue, null);
    assert.equal(decision.channel, "tiktok");
    assert.equal(decision.dryRun, true);
    assert.equal(decision.applied, false);
    assert.match(decision.reasonText, /metric_unavailable/);
    assert.doesNotMatch(decision.reasonText, /Infinity|NaN/);
  });

  it("records metric_unavailable when results are 0 — never spend/0", () => {
    const decision = evaluateCrossChannelSubject(
      subject({ channel: "google", dailyBudgetMajor: 20 }),
      {
        spend: 8,
        results: 0,
        impressions: 200,
        spendColumnPresent: true,
        resultColumnPresent: true,
      },
      "24h",
      now,
      null,
      0,
    );
    assert.equal(decision.actionRecommended, METRIC_UNAVAILABLE);
    assert.equal(decision.metricValue, null);
    assert.equal(decision.budgetBeforePence, 2000);
    assert.equal(decision.budgetAfterPence, 2000);
  });

  it("evaluates CPR in the channel's own daily-split pence when results exist", () => {
    const decision = evaluateCrossChannelSubject(
      subject({ dailyBudgetMajor: 40 }),
      {
        spend: 10,
        results: 25,
        impressions: 800,
        spendColumnPresent: true,
        resultColumnPresent: true,
      },
      "24h",
      now,
      null,
      0,
    );
    assert.equal(decision.actionRecommended, "scale_up");
    assert.equal(decision.metricValue, 0.4);
    assert.equal(decision.budgetBeforePence, 4000);
    assert.equal(decision.budgetAfterPence, 5200);
    assert.equal(decision.dryRun, true);
    assert.equal(decision.applied, false);
  });
});

describe("cross-channel tick — always shadow, even when Meta is Live", () => {
  it("tags Meta rows meta and TikTok/Google rows by channel; cross-channel stays dry_run", async () => {
    const inserted: DecisionToInsert[] = [];
    const updates: string[] = [];
    const summary = await runOptimisationTick(true, false, {
      loadOptedInCampaigns: async () => [metaCampaign({ optimisationAutomationLive: true })],
      getAdSetState: async () => ({
        lastAppliedAt: null,
        lastDecidedAt: null,
        appliedIncreasePercentLast24h: 0,
      }),
      insertDecision: async (row) => void inserted.push(row),
      fetchInsights: async () => [insightRow()],
      fetchCampaignInsights: async () => {
        throw new Error("ABO path");
      },
      readAdSetDailyBudget: async () => 10000,
      updateAdSetDailyBudget: async (id) => {
        updates.push(id);
        return { ok: true };
      },
      readCampaignDailyBudget: async () => {
        throw new Error("ABO path");
      },
      updateCampaignDailyBudget: async () => {
        throw new Error("ABO path");
      },
      notify: async () => ({ sent: true }),
      now: new Date("2026-08-26T12:00:00Z"),
      writesEnabled: true,
      loadCrossChannelSubjects: async () => [
        subject({ channel: "tiktok" }),
        subject({
          channel: "google",
          planId: "plan-1",
          dailyBudgetMajor: 20,
          campaignName: "Plan · google",
        }),
      ],
      fetchChannelRollup: async (sub) =>
        sub.channel === "tiktok"
          ? {
              spend: 12,
              results: null,
              impressions: 100,
              spendColumnPresent: true,
              resultColumnPresent: false,
            }
          : {
              spend: 6,
              results: 20,
              impressions: 300,
              spendColumnPresent: true,
              resultColumnPresent: true,
            },
    });

    const metaRow = inserted.find((row) => row.channel === "meta");
    const tiktokRow = inserted.find((row) => row.channel === "tiktok");
    const googleRow = inserted.find((row) => row.channel === "google");
    assert.ok(metaRow);
    assert.ok(tiktokRow);
    assert.ok(googleRow);
    assert.equal(metaRow?.applied, true);
    assert.equal(metaRow?.dryRun, false);
    assert.equal(tiktokRow?.actionRecommended, METRIC_UNAVAILABLE);
    assert.equal(tiktokRow?.dryRun, true);
    assert.equal(tiktokRow?.applied, false);
    assert.equal(googleRow?.dryRun, true);
    assert.equal(googleRow?.applied, false);
    assert.equal(googleRow?.budgetBeforePence, 2000);
    assert.deepEqual(updates, ["adset_1"]);
    assert.equal(summary.crossChannelDecisionsInserted, 2);
    assert.equal(CROSS_CHANNEL_SHADOW_GATES.dryRun, true);
  });

  it("does not load cross-channel subjects when the optional deps are omitted", async () => {
    const inserted: DecisionToInsert[] = [];
    await runOptimisationTick(true, false, {
      loadOptedInCampaigns: async () => [metaCampaign()],
      getAdSetState: async () => ({
        lastAppliedAt: null,
        lastDecidedAt: null,
        appliedIncreasePercentLast24h: 0,
      }),
      insertDecision: async (row) => void inserted.push(row),
      fetchInsights: async () => [insightRow()],
      fetchCampaignInsights: async () => {
        throw new Error("ABO path");
      },
      readAdSetDailyBudget: async () => {
        throw new Error("no Meta write in shadow");
      },
      updateAdSetDailyBudget: async () => {
        throw new Error("no Meta write in shadow");
      },
      readCampaignDailyBudget: async () => {
        throw new Error("no Meta write in shadow");
      },
      updateCampaignDailyBudget: async () => {
        throw new Error("no Meta write in shadow");
      },
      notify: async () => ({ sent: true }),
      now: new Date("2026-08-26T12:00:00Z"),
      writesEnabled: false,
    });
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].channel, "meta");
  });
});

describe("M.4 grep-guards — no new rules UI, migration 162 unapplied", () => {
  it("plan surfaces do not grow an Optimisation Strategy editor", () => {
    const files = [
      "components/plan/plan-workspace.tsx",
      "app/(dashboard)/plans/page.tsx",
      "app/(dashboard)/plan/[id]/page.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /AutomationArmControl|optimisation-strategy|evaluateAdSet/);
    }
    // The decisions surface is a `◐ n ▸` handle now, and its label is copy.
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(workspace, /decisionCount/);
    assert.match(readFileSync("lib/plan/canvas.ts", "utf8"), /Automation decisions/);
  });

  it("decisions list renders a channel badge", () => {
    const list = readFileSync("components/plan/decisions-sheet.tsx", "utf8");
    assert.match(list, /row\.channel/);
    assert.match(list, /PlatformGlyph/);
  });

  it("migration 162 adds channel with a meta default and is not applied from this PR", () => {
    const sql = readFileSync(
      "supabase/migrations/162_campaign_automation_decisions_channel.sql",
      "utf8",
    );
    assert.match(sql, /add column if not exists channel/);
    assert.match(sql, /default 'meta'/);
    assert.match(sql, /check \(channel in \('meta', 'tiktok', 'google'\)\)/);
    assert.match(sql, /Do not apply in this run/);
    const notes = readFileSync("supabase/migrations/MIGRATIONS_NOTES.md", "utf8");
    assert.doesNotMatch(notes, /162_campaign_automation_decisions_channel applied/);
  });

  it("tick route wires cross-channel loaders and forces shadow gates in the runner", () => {
    const route = readFileSync("app/api/cron/optimisation-tick/route.ts", "utf8");
    assert.match(route, /loadPlanLinkedChannelSubjects/);
    assert.match(route, /fetchEventChannelRollup/);
    const runner = readFileSync("lib/optimisation/tick-runner.ts", "utf8");
    assert.match(runner, /CROSS_CHANNEL_SHADOW_GATES/);
    assert.doesNotMatch(runner, /tiktok.*updateAdSet|google.*write/i);
  });
});
