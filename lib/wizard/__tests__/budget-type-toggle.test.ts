/**
 * Daily ↔ Lifetime converts each enabled row so the Budget step does not
 * leave the amount at 0.
 *
 * Run: node --test lib/wizard/__tests__/budget-type-toggle.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convertAdSetBudgetsOnTypeChange } from "../adset-suggestions.ts";
import type { AdSetSuggestion } from "../../types.ts";

function row(overrides: Partial<AdSetSuggestion> = {}): AdSetSuggestion {
  return {
    id: "london",
    name: "London",
    enabled: true,
    budgetPerDay: 20,
    ...overrides,
  } as AdSetSuggestion;
}

describe("convertAdSetBudgetsOnTypeChange", () => {
  it("Daily → Lifetime multiplies budgetPerDay by the scheduled days", () => {
    const [converted] = convertAdSetBudgetsOnTypeChange([row({ budgetPerDay: 20 })], "lifetime", 200, 10);
    assert.equal(converted!.budgetLifetime, 200);
    assert.equal(converted!.budgetPerDay, 20);
  });

  it("Lifetime → Daily divides budgetLifetime by the scheduled days", () => {
    const [converted] = convertAdSetBudgetsOnTypeChange(
      [row({ budgetPerDay: 0, budgetLifetime: 1700 })],
      "daily",
      1700,
      73,
    );
    assert.equal(converted!.budgetPerDay, 23.29);
    assert.equal(converted!.budgetLifetime, 1700);
  });

  it("splits the campaign amount when the scheduled length is unknown", () => {
    const converted = convertAdSetBudgetsOnTypeChange(
      [row({ id: "a", budgetPerDay: 20 }), row({ id: "b", budgetPerDay: 30 })],
      "lifetime",
      200,
      0,
    );
    assert.equal(converted[0]!.budgetLifetime, 100);
    assert.equal(converted[1]!.budgetLifetime, 100);
  });

  it("does not convert a disabled row", () => {
    const [converted] = convertAdSetBudgetsOnTypeChange(
      [row({ enabled: false, budgetPerDay: 20 })],
      "lifetime",
      200,
      10,
    );
    assert.equal(converted!.budgetLifetime, undefined);
    assert.equal(converted!.budgetPerDay, 20);
  });
});
