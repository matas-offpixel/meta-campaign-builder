import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { joinInfoTips, planCanvasHeightBudget } from "../canvas.ts";

describe("planCanvasHeightBudget", () => {
  it("sums into 620–700px after the WindowBar label lane is in-flow", () => {
    const budget = planCanvasHeightBudget();
    assert.equal(budget.zones.B, 80);
    assert.equal(budget.content, 568);
    assert.equal(budget.guttersTotal, 120);
    assert.equal(budget.canvas, 688);
    assert.ok(budget.canvas >= 620 && budget.canvas <= 700);
    assert.equal(budget.launchY, 760);
    assert.equal(budget.zones.A, 88);
    assert.equal(budget.gutters.BC, 16);
    assert.equal(budget.gutters.DE, 24);
  });

  it("joinInfoTips drops empties and separates former tips with ·", () => {
    assert.equal(joinInfoTips("one", false, "", null, "two"), "one · two");
  });
});

