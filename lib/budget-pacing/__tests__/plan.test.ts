import { test } from "node:test";
import assert from "node:assert/strict";

import { computeCampaignBudgetPlan } from "../plan.ts";

test("sums enabled daily budgets and multiplies by scheduled days", () => {
  const plan = computeCampaignBudgetPlan({
    enabledDailyBudgetsMajor: [20, 30],
    startDate: "2026-08-01",
    endDate: "2026-08-11", // 10 days per Math.ceil, no +1
    now: new Date("2026-08-05T00:00:00Z"),
  });
  assert.ok(plan);
  assert.equal(plan?.scheduledDays, 10);
  assert.equal(plan?.plannedTotalPence, 50 * 10 * 100);
});

test("daysRemaining is floored and counts down to the end date", () => {
  const plan = computeCampaignBudgetPlan({
    enabledDailyBudgetsMajor: [10],
    startDate: "2026-08-01",
    endDate: "2026-08-11",
    now: new Date("2026-08-09T12:00:00Z"),
  });
  assert.equal(plan?.daysRemaining, 1);
});

test("daysRemaining is zero or negative once the schedule has ended", () => {
  const plan = computeCampaignBudgetPlan({
    enabledDailyBudgetsMajor: [10],
    startDate: "2026-08-01",
    endDate: "2026-08-11",
    now: new Date("2026-08-15T00:00:00Z"),
  });
  assert.ok((plan?.daysRemaining ?? 1) <= 0);
});

test("returns null when no ad set has an enabled daily budget", () => {
  const plan = computeCampaignBudgetPlan({
    enabledDailyBudgetsMajor: [],
    startDate: "2026-08-01",
    endDate: "2026-08-11",
    now: new Date("2026-08-05T00:00:00Z"),
  });
  assert.equal(plan, null);
});

test("returns null when all enabled daily budgets are zero", () => {
  const plan = computeCampaignBudgetPlan({
    enabledDailyBudgetsMajor: [0, 0],
    startDate: "2026-08-01",
    endDate: "2026-08-11",
    now: new Date("2026-08-05T00:00:00Z"),
  });
  assert.equal(plan, null);
});

test("returns null when startDate or endDate is missing", () => {
  assert.equal(
    computeCampaignBudgetPlan({ enabledDailyBudgetsMajor: [10], startDate: "", endDate: "2026-08-11", now: new Date() }),
    null,
  );
  assert.equal(
    computeCampaignBudgetPlan({ enabledDailyBudgetsMajor: [10], startDate: "2026-08-01", endDate: "", now: new Date() }),
    null,
  );
});

test("returns null when dates are unparseable", () => {
  const plan = computeCampaignBudgetPlan({
    enabledDailyBudgetsMajor: [10],
    startDate: "not-a-date",
    endDate: "2026-08-11",
    now: new Date(),
  });
  assert.equal(plan, null);
});

test("returns null when endDate is before or equal to startDate (non-positive schedule)", () => {
  assert.equal(
    computeCampaignBudgetPlan({
      enabledDailyBudgetsMajor: [10],
      startDate: "2026-08-11",
      endDate: "2026-08-01",
      now: new Date(),
    }),
    null,
  );
  assert.equal(
    computeCampaignBudgetPlan({
      enabledDailyBudgetsMajor: [10],
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      now: new Date(),
    }),
    null,
  );
});
