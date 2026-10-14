/**
 * Step 6 outlet split and TikTok ad groups.
 * Run: node --test lib/plan/__tests__/mml-budget.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TIKTOK_MIN_CAMPAIGN_DAILY_BUDGET_BY_CURRENCY,
  TIKTOK_MIN_DAILY_BUDGET_BY_CURRENCY,
  tikTokCampaignBudgetIssue,
} from "../../tiktok/write/mapping.ts";
import { formatTikTokAdGroupReviewLine } from "../../tiktok-wizard/budget-schedule.ts";
import { applyPlanBudgetToGoogle } from "../adapters/google.ts";
import { applyTikTokAdGroupPlan, planToTikTokDraft } from "../adapters/tiktok.ts";
import { applyPreset } from "../budget-split.ts";
import { planToGoogleDraft } from "../adapters/google.ts";
import {
  TIKTOK_MIN_ADGROUP_DAILY_GBP,
  TIKTOK_MIN_CAMPAIGN_DAILY_GBP,
  mmlTikTokCampaignBudget,
  applyDisplayedPreset,
  channelDisplayAmount,
  editDisplayedShare,
  editSharePercent,
  mmlBudgetBlockers,
  planTikTokAdGroups,
  raiseTikTokToMinimum,
  setDisplayedTotal,
  tikTokGroupLines,
  tikTokMinimumMessage,
  turnChannelOff,
} from "../mml-budget.ts";
import { readyPlan } from "./canvas-fixtures.ts";

const ALL = { meta: true, tiktok: true, google: true };

function pence(value: number): number {
  return Math.round(value * 100);
}

function sumPence(budget: { metaDaily: number; tiktokDaily: number; googleDaily: number }): number {
  return pence(budget.metaDaily) + pence(budget.tiktokDaily) + pence(budget.googleDaily);
}

describe("outlet split", () => {
  it("sums a preset exactly, and a locked edit rebalances the others", () => {
    const selected = ALL;
    const preset = applyDisplayedPreset(
      { totalDaily: 100, metaDaily: 0, tiktokDaily: 0, googleDaily: 0 },
      "80-15-5",
      selected,
    );
    assert.equal(sumPence(preset), pence(preset.totalDaily));
    assert.equal(preset.totalDaily, 100);
    assert.equal(preset.metaDaily, 80);
    assert.equal(preset.tiktokDaily, 15);
    assert.equal(preset.googleDaily, 5);

    const locked = editDisplayedShare(preset, selected, "tiktok", 40, "daily", null);
    assert.equal(locked.tiktokDaily, 40);
    assert.equal(sumPence(locked), pence(locked.totalDaily));
    assert.equal(locked.totalDaily, 100);
    assert.ok(locked.metaDaily > locked.googleDaily);
    assert.ok(locked.metaDaily < 80);

    const byPercent = editSharePercent(preset, selected, "google", 10);
    assert.equal(byPercent.googleDaily, 10);
    assert.equal(sumPence(byPercent), 10000);
  });

  it("keeps the daily figures when the on-screen total is the whole run", () => {
    const start = applyPreset(100, "80-15-5", ALL);
    const lifetime = setDisplayedTotal(start, ALL, "lifetime", 10, 1000);
    assert.equal(lifetime.totalDaily, 100);
    assert.equal(sumPence(lifetime), 10000);
    assert.equal(channelDisplayAmount(lifetime.tiktokDaily, "lifetime", 10), 150);
  });

  it("round-trips an edit, which is the shape a reload reads back", () => {
    const start = applyPreset(100, "50-40-10", ALL);
    const edited = editDisplayedShare(start, ALL, "meta", 55, "daily", null);
    const restored = JSON.parse(JSON.stringify(edited)) as typeof edited;
    assert.deepEqual(restored, edited);
    assert.equal(sumPence(restored), pence(restored.totalDaily));
  });
});

describe("TikTok ad groups", () => {
  it("uses TikTok's £20 ad-group floor and £50 campaign floor", () => {
    assert.equal(TIKTOK_MIN_DAILY_BUDGET_BY_CURRENCY.GBP, 20);
    assert.equal(TIKTOK_MIN_ADGROUP_DAILY_GBP, TIKTOK_MIN_DAILY_BUDGET_BY_CURRENCY.GBP);
    assert.equal(TIKTOK_MIN_CAMPAIGN_DAILY_GBP, 50);
    assert.equal(TIKTOK_MIN_CAMPAIGN_DAILY_BUDGET_BY_CURRENCY.GBP, 50);
    assert.equal(
      tikTokMinimumMessage(TIKTOK_MIN_ADGROUP_DAILY_GBP),
      "TikTok needs at least £20/day per ad group",
    );
  });

  it("follows the regional-then-nationwide rule at an injected £20 floor", () => {
    const floor = 20;
    const blocked = planTikTokAdGroups({
      share: 15,
      mode: "daily",
      days: null,
      venueLabel: "Newcastle",
      minimumDaily: floor,
    });
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.groups.length, 0);
    assert.equal(blocked.message, "TikTok needs at least £20/day per ad group");

    const regional = planTikTokAdGroups({
      share: 30,
      mode: "daily",
      days: 10,
      venueLabel: "Newcastle",
      minimumDaily: floor,
    });
    assert.equal(regional.blocked, false);
    assert.deepEqual(
      regional.groups.map((group) => [group.role, group.amount]),
      [["regional", 30]],
    );
    assert.deepEqual(tikTokGroupLines(regional, "daily", 10), ["Regional · Newcastle £30/day"]);

    const both = planTikTokAdGroups({
      share: 55,
      mode: "daily",
      days: null,
      venueLabel: "Newcastle",
      minimumDaily: floor,
    });
    assert.deepEqual(
      both.groups.map((group) => [group.name, group.amount]),
      [
        ["Regional · Newcastle", 20],
        ["Nationwide UK", 35],
      ],
    );
    assert.equal(both.groups[0]!.amount + both.groups[1]!.amount, 55);
    assert.deepEqual(tikTokGroupLines(both, "daily", null), [
      "Regional · Newcastle £20/day",
      "Nationwide UK £35/day",
    ]);
  });

  it("uses £20 × days when the injected floor is lifetime", () => {
    const floor = 20;
    const days = 10;
    const under = planTikTokAdGroups({
      share: 150,
      mode: "lifetime",
      days,
      venueLabel: "Newcastle",
      minimumDaily: floor,
    });
    assert.equal(under.blocked, true);
    assert.equal(under.minimum, 200);

    const one = planTikTokAdGroups({
      share: 300,
      mode: "lifetime",
      days,
      venueLabel: "Newcastle",
      minimumDaily: floor,
    });
    assert.deepEqual(
      one.groups.map((group) => group.amount),
      [300],
    );

    const two = planTikTokAdGroups({
      share: 550,
      mode: "lifetime",
      days,
      venueLabel: "Newcastle",
      minimumDaily: floor,
    });
    assert.deepEqual(
      two.groups.map((group) => [group.role, group.amount]),
      [
        ["regional", 200],
        ["nationwide", 350],
      ],
    );
    assert.deepEqual(tikTokGroupLines(two, "lifetime", days), [
      "Regional · Newcastle £20/day",
      "Nationwide UK £35/day",
    ]);
  });

  it("blocks £15, keeps £30 regional, and splits £55 into £20 and £35", () => {
    const planned = (share: number) =>
      planTikTokAdGroups({ share, mode: "daily", days: null, venueLabel: "Newcastle" });
    assert.equal(planned(15).blocked, true);
    assert.equal(planned(15).groups.length, 0);
    assert.equal(planned(15).message, "TikTok needs at least £20/day per ad group");

    const regional = planned(30);
    assert.equal(regional.blocked, false);
    assert.deepEqual(
      regional.groups.map((group) => [group.role, group.amount]),
      [["regional", 30]],
    );

    const both = planned(55);
    assert.deepEqual(
      both.groups.map((group) => [group.name, group.amount]),
      [
        ["Regional · Newcastle", 20],
        ["Nationwide UK", 35],
      ],
    );
    assert.equal(both.groups[0]!.amount + both.groups[1]!.amount, 55);
  });

  it("blocks a campaign budget of £40, allows £50, and allows unset", () => {
    const base = {
      budgetMode: "DAILY" as const,
      startAt: "2026-10-01T00:00:00Z",
      endAt: "2026-10-10T00:00:00Z",
      currency: "GBP",
    };
    assert.match(tikTokCampaignBudgetIssue({ ...base, budgetAmount: 40 }) ?? "", /50/);
    assert.equal(tikTokCampaignBudgetIssue({ ...base, budgetAmount: 50 }), null);
    assert.equal(tikTokCampaignBudgetIssue({ ...base, budgetAmount: null }), null);
    assert.equal(mmlTikTokCampaignBudget({ dailyAmount: 40, mode: "DAILY", groupTotal: 40 }), null);
    assert.equal(mmlTikTokCampaignBudget({ dailyAmount: 50, mode: "DAILY", groupTotal: 50 }), 50);
    assert.equal(
      formatTikTokAdGroupReviewLine({
        index: 1,
        dailyAmount: 20,
        targetCost: 10,
        resultLabel: "purchase",
      }),
      "Ad group 1 · £20/day · target £10 per purchase",
    );
    assert.equal(
      formatTikTokAdGroupReviewLine({
        index: 1,
        dailyAmount: 20,
        targetCost: null,
        resultLabel: "purchase",
      }),
      "Ad group 1 · £20/day",
    );
  });

  it("blocks a lifetime share under £20 × days and writes nothing under the floor", () => {
    const days = 4;
    const under = planTikTokAdGroups({
      share: 70,
      mode: "lifetime",
      days,
      venueLabel: "Newcastle",
    });
    assert.equal(under.blocked, true);
    assert.equal(under.minimum, 80);
    assert.equal(under.groups.length, 0);

    const draft = planToTikTokDraft(readyPlan());
    const untouched = applyTikTokAdGroupPlan(draft, {
      mode: "DAILY",
      dailyAmount: 15,
      groups: under.groups,
      startDate: "2026-10-01",
      endDate: "2026-10-04",
      startTime: null,
      endTime: null,
    });
    assert.equal(untouched, draft);

    const legal = planTikTokAdGroups({
      share: 120,
      mode: "daily",
      days,
      venueLabel: "Newcastle",
    });
    const once = applyTikTokAdGroupPlan(draft, {
      mode: "DAILY",
      dailyAmount: 120,
      groups: legal.groups,
      startDate: "2026-10-01",
      endDate: "2026-10-10",
      startTime: "18:00",
      endTime: null,
    });
    const twice = applyTikTokAdGroupPlan(once, {
      mode: "DAILY",
      dailyAmount: 120,
      groups: legal.groups,
      startDate: "2026-10-01",
      endDate: "2026-10-10",
      startTime: "18:00",
      endTime: null,
    });
    assert.equal(once.budgetSchedule.adGroups.length, 2);
    assert.equal(once.budgetSchedule.adGroups[0]!.budget, 20);
    assert.equal(once.budgetSchedule.adGroups[1]!.budget, 100);
    assert.equal(once.budgetSchedule.budgetAmount, 120);
    assert.equal(once.budgetSchedule.dailyBudget, 120);
    assert.deepEqual(twice.budgetSchedule.adGroups, once.budgetSchedule.adGroups);
    assert.deepEqual(
      once.creativeAssignments.byAdGroupId[once.budgetSchedule.adGroups[1]!.id],
      once.creativeAssignments.byAdGroupId[once.budgetSchedule.adGroups[0]!.id],
    );
    assert.ok(once.budgetSchedule.scheduleStartAt?.startsWith("2026-10-01"));
  });
});

describe("step 6 blockers", () => {
  const base = {
    selected: ALL,
    mode: "daily" as const,
    startDate: "2026-10-01",
    endDate: "2026-10-10",
    venueLabel: "Newcastle",
  };

  it("names a missing total, a selected channel at £0, an early end, and Google with no budget", () => {
    assert.deepEqual(
      mmlBudgetBlockers({
        ...base,
        budget: { totalDaily: 0, metaDaily: 0, tiktokDaily: 0, googleDaily: 0 },
      }),
      [
        "Enter a budget total",
        "Meta is selected but has no budget",
        "Google has no budget",
        "TikTok is selected but has no budget",
      ],
    );
    assert.ok(
      mmlBudgetBlockers({
        ...base,
        startDate: "2026-10-10",
        endDate: "2026-10-01",
        budget: { totalDaily: 100, metaDaily: 80, tiktokDaily: 15, googleDaily: 5 },
      }).includes("The end date is before the start"),
    );
  });

  it("blocks TikTok under the live minimum and offers a raise that reaches it", () => {
    const budget = { totalDaily: 100, metaDaily: 80, tiktokDaily: 15, googleDaily: 5 };
    const errors = mmlBudgetBlockers({ ...base, budget });
    assert.deepEqual(errors, ["TikTok needs at least £20/day per ad group"]);
    const raised = raiseTikTokToMinimum(budget, ALL);
    assert.equal(raised.tiktokDaily, 20);
    assert.equal(sumPence(raised), pence(raised.totalDaily));
    assert.equal(
      mmlBudgetBlockers({ ...base, budget: raised }).some((line) => line.includes("TikTok needs")),
      false,
    );

    const tiny = raiseTikTokToMinimum({ totalDaily: 30, metaDaily: 20, tiktokDaily: 10, googleDaily: 0 }, {
      meta: true,
      tiktok: true,
      google: false,
    });
    assert.equal(tiny.tiktokDaily, 20);
    assert.equal(tiny.metaDaily, 10);
    assert.equal(tiny.totalDaily, 30);

    const off = turnChannelOff(budget, ALL, "tiktok");
    assert.equal(off.selected.tiktok, false);
    assert.equal(off.budget.tiktokDaily, 0);
    assert.equal(sumPence(off.budget), 10000);
  });
});

describe("Google share", () => {
  it("writes the 188/189 budget columns and only locations the geotarget list can name", () => {
    const tree = planToGoogleDraft(readyPlan());
    const next = applyPlanBudgetToGoogle(tree, {
      googleDaily: 12.5,
      startDate: "2026-10-01",
      endDate: "2026-10-10",
      locationLabels: ["London", "South East England"],
    });
    assert.equal(next.plan.total_budget, 125);
    assert.equal(next.plan.daily_budget, 12.5);
    assert.equal(next.campaigns[0]!.daily_budget, 12.5);
    assert.deepEqual(next.plan.date_range, { since: "2026-10-01", until: "2026-10-10" });
    assert.equal(next.plan.geo_targets.length, 1);
    assert.equal(next.plan.geo_targets[0]!.location, "London");
    assert.match(next.plan.geo_targets[0]!.resolved_resource_name ?? "", /^geoTargetConstants\//);

    const again = applyPlanBudgetToGoogle(next, {
      googleDaily: 12.5,
      startDate: "2026-10-01",
      endDate: "2026-10-10",
      locationLabels: ["London"],
    });
    assert.equal(again.plan.total_budget, next.plan.total_budget);
    assert.equal(again.campaigns[0]!.daily_budget, next.campaigns[0]!.daily_budget);
  });
});
