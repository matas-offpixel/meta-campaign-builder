import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseMoneyAmountInput,
  parseSpendDateToIso,
} from "../../additional-spend-parse.ts";

describe("parseMoneyAmountInput", () => {
  it("strips £ and commas", () => {
    const a = parseMoneyAmountInput("£1,800");
    assert.ok(a.ok);
    if (a.ok) assert.equal(a.value, 1800);
  });

  it("accepts 1,800 without currency", () => {
    const a = parseMoneyAmountInput("1,800.50");
    assert.ok(a.ok);
    if (a.ok) assert.equal(a.value, 1800.5);
  });

  it("accepts plain number string", () => {
    const a = parseMoneyAmountInput("1800");
    assert.ok(a.ok);
    if (a.ok) assert.equal(a.value, 1800);
  });
});

describe("parseSpendDateToIso", () => {
  it("accepts ISO date", () => {
    const d = parseSpendDateToIso("2026-04-15");
    assert.ok(d.ok);
    if (d.ok) assert.equal(d.isoDate, "2026-04-15");
  });

  it("accepts UK DD/MM/YYYY", () => {
    const d = parseSpendDateToIso("15/04/2026");
    assert.ok(d.ok);
    if (d.ok) assert.equal(d.isoDate, "2026-04-15");
  });

  it("accepts DD-MM-YYYY", () => {
    const d = parseSpendDateToIso("15-04-2026");
    assert.ok(d.ok);
    if (d.ok) assert.equal(d.isoDate, "2026-04-15");
  });
});
