import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CIRQLIN_CRON_BUDGET_MS,
  cirqlinCronLeft,
  cirqlinCronOverBudget,
} from "../cron-budget.ts";

describe("cirqlin cron budget", () => {
  it("counts how many events were left when the loop stops", () => {
    assert.equal(cirqlinCronLeft(10, 3), 7);
    assert.equal(cirqlinCronLeft(10, 10), 0);
  });

  it("stops once the request has used its budget", () => {
    assert.equal(cirqlinCronOverBudget(0, CIRQLIN_CRON_BUDGET_MS - 1), false);
    assert.equal(cirqlinCronOverBudget(0, CIRQLIN_CRON_BUDGET_MS), true);
  });
});
