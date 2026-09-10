import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BudgetGuardrails } from "../../types.ts";
import {
  applyCampaignHeadroom,
  compareCheapestMetricFirst,
  planFromDraftFields,
  readBaseAdSetBudget,
  remainingDailyAllowancePence,
  resolveCampaignCeiling,
} from "../campaign-ceiling.ts";

const GUARDRAILS: BudgetGuardrails = {
  baseCampaignBudget: 50,
  maxExpansionPercent: 100,
  hardBudgetCeiling: 100,
  ceilingBehaviour: "partial",
};

describe("readBaseAdSetBudget", () => {
  it("prefers baseAdSetBudget over the old key", () => {
    assert.equal(
      readBaseAdSetBudget({ ...GUARDRAILS, baseAdSetBudget: 40, baseCampaignBudget: 90 }),
      40,
    );
  });

  it("still reads the old key so existing drafts keep evaluating", () => {
    assert.equal(readBaseAdSetBudget(GUARDRAILS), 50);
  });
});

describe("remainingDailyAllowancePence", () => {
  it("is (planned − spent) / remaining days", () => {
    assert.equal(remainingDailyAllowancePence(300_000, 0, 10), 30_000);
  });

  it("uses at least one day so a ended schedule is not a divide-by-zero", () => {
    assert.equal(remainingDailyAllowancePence(3_000, 1_000, 0), 2_000);
    assert.equal(remainingDailyAllowancePence(3_000, 1_000, -2), 2_000);
  });

  it("does not go negative after overspend", () => {
    assert.equal(remainingDailyAllowancePence(10_000, 12_000, 4), 0);
  });
});

describe("resolveCampaignCeiling", () => {
  it("unset scope is today's ad-set-only behaviour", () => {
    assert.deepEqual(
      resolveCampaignCeiling({
        guardrails: GUARDRAILS,
        plan: { plannedTotalPence: 300_000, scheduledDays: 10, daysRemaining: 10 },
        spentPence: 0,
      }),
      { kind: "inactive" },
    );
  });

  it("derived with no plan is absent, not unlimited", () => {
    assert.deepEqual(
      resolveCampaignCeiling({
        guardrails: { ...GUARDRAILS, budgetCeilingScope: "campaign" },
        plan: null,
        spentPence: 0,
      }),
      { kind: "absent", note: "campaign_ceiling_absent" },
    );
  });

  it("derived with an unreadable spend is named, not treated as zero", () => {
    assert.deepEqual(
      resolveCampaignCeiling({
        guardrails: { ...GUARDRAILS, budgetCeilingScope: "both" },
        plan: { plannedTotalPence: 300_000, scheduledDays: 10, daysRemaining: 10 },
        spentPence: "unreadable",
      }),
      { kind: "unreadable", note: "campaign_ceiling_unreadable" },
    );
  });

  it("typed with no figure is absent", () => {
    assert.deepEqual(
      resolveCampaignCeiling({
        guardrails: {
          ...GUARDRAILS,
          budgetCeilingScope: "campaign",
          campaignDailyCeilingSource: "typed",
        },
        plan: null,
        spentPence: 0,
      }),
      { kind: "absent", note: "campaign_ceiling_absent" },
    );
  });

  it("derived remaining ÷ remaining days is the campaign-daily ceiling", () => {
    const now = new Date("2026-08-07T12:00:00Z");
    const plan = planFromDraftFields([125], "2026-08-01", "2026-08-13", now);
    assert.ok(plan);
    assert.deepEqual(
      resolveCampaignCeiling({
        guardrails: { ...GUARDRAILS, budgetCeilingScope: "campaign" },
        plan,
        spentPence: 0,
      }),
      { kind: "active", dailyCeilingPence: 30_000, source: "derived" },
    );
  });

  it("typed figure is the campaign-daily ceiling", () => {
    assert.deepEqual(
      resolveCampaignCeiling({
        guardrails: {
          ...GUARDRAILS,
          budgetCeilingScope: "campaign",
          campaignDailyCeilingSource: "typed",
          campaignDailyCeiling: 300,
        },
        plan: null,
        spentPence: 0,
      }),
      { kind: "active", dailyCeilingPence: 30_000, source: "typed" },
    );
  });
});

describe("applyCampaignHeadroom", () => {
  const scale = {
    actionRecommended: "scale_up",
    actionDelta: 30,
    budgetBeforePence: 10_000,
    budgetAfterPence: 13_000,
    guardrailNote: null,
    reasonText: "scale",
  };

  it("does not touch an inactive (today) campaign", () => {
    const out = applyCampaignHeadroom(scale, { kind: "inactive" }, 4_400);
    assert.equal(out.decision.actionRecommended, "scale_up");
    assert.equal(out.decision.budgetAfterPence, 13_000);
    assert.equal(out.usedPence, 0);
  });

  it("names an absent ceiling without changing the budget", () => {
    const out = applyCampaignHeadroom(
      scale,
      { kind: "absent", note: "campaign_ceiling_absent" },
      null,
    );
    assert.equal(out.decision.actionRecommended, "scale_up");
    assert.equal(out.decision.budgetAfterPence, 13_000);
    assert.equal(out.decision.guardrailNote, "campaign_ceiling_absent");
    assert.equal(out.usedPence, 0);
  });

  it("grants what fits and names the clamp", () => {
    const out = applyCampaignHeadroom(
      scale,
      { kind: "active", dailyCeilingPence: 30_000, source: "derived" },
      1_400,
    );
    assert.equal(out.decision.actionRecommended, "scale_up");
    assert.equal(out.decision.budgetAfterPence, 11_400);
    assert.equal(out.decision.guardrailNote, "capped_by_campaign_ceiling");
    assert.equal(out.usedPence, 1_400);
  });

  it("maintains when headroom is gone", () => {
    const out = applyCampaignHeadroom(
      scale,
      { kind: "active", dailyCeilingPence: 30_000, source: "derived" },
      0,
    );
    assert.equal(out.decision.actionRecommended, "maintain");
    assert.equal(out.decision.budgetAfterPence, 10_000);
    assert.equal(out.decision.guardrailNote, "capped_by_campaign_ceiling");
    assert.equal(out.usedPence, 0);
  });
});

describe("compareCheapestMetricFirst", () => {
  it("orders cheapest CPR first and nulls last", () => {
    const values = [0.8, null, 0.3, 0.5];
    const sorted = [...values].sort(compareCheapestMetricFirst);
    assert.deepEqual(sorted, [0.3, 0.5, 0.8, null]);
  });
});
