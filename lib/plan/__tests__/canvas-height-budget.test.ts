import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planCanvasHeightBudget } from "../canvas.ts";

describe("planCanvasHeightBudget", () => {
  it("sums to ~672px and lands Launch at y ≈ 744", () => {
    const budget = planCanvasHeightBudget();
    assert.equal(budget.content, 552);
    assert.equal(budget.guttersTotal, 120);
    assert.equal(budget.canvas, 672);
    assert.ok(budget.canvas >= 620 && budget.canvas <= 700);
    assert.equal(budget.launchY, 744);
    assert.equal(budget.zones.A, 88);
    assert.equal(budget.gutters.BC, 16);
    assert.equal(budget.gutters.DE, 24);
  });
});
