/**
 * TF1 (docs/design-record/2026-11-16-creative-testing-3.html): the test ad
 * set's daily budget and the plan hold, with the record's expected figures
 * (TF-A, TF-B) and Matas's CBO ruling of 16 Nov.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TF1, capText, liveAdSetBudgets, medianBudget, planCheck, sizeTest } from "../budget.ts";
import { budgetLine } from "../words.ts";

const abo = (...pence: number[]) => pence.map((dailyMinor) => ({ dailyMinor, live: true }));

describe("TF1: the daily budget", () => {
  it("TF-A: £160 a day of spend → 10 % is £16, capped at £10, which is 6 % (6.25 shown as 6)", () => {
    const sized = sizeTest({ last7Spend: 160 * 7, mainAdSets: abo(2000, 2500, 3000), minDailyMinor: 100 });
    assert.ok(sized.ok);
    assert.equal(sized.dailyMinor, 1000);
    assert.equal(sized.sharePct, 6.25);
    assert.equal(sized.atMinimum, false);
    assert.equal(sized.line, "£10 a day · 6 % of current daily spend (cap £10)");
    assert.equal(sized.holdMinor, 4000);
  });

  it("TF-B: £6.50 a day → £0.65, under Meta's £1.00, so the minimum, 15 % (15.4), with the suffix", () => {
    const sized = sizeTest({ last7Spend: 6.5 * 7, mainAdSets: abo(500), minDailyMinor: 100 });
    assert.ok(sized.ok);
    assert.equal(sized.dailyMinor, 100);
    assert.equal(sized.atMinimum, true);
    assert.equal(sized.line, "£1.00 a day · 15 % of current daily spend (cap £10) · Meta's minimum");
  });

  it("rounds 10 % down to the whole pound (P26-BDAY, 9–15 Nov: £247.22 → £35.32 a day → £3)", () => {
    const sized = sizeTest({ last7Spend: 247.22, mainAdSets: abo(551, 551, 551, 1500), minDailyMinor: 100 });
    assert.ok(sized.ok);
    assert.equal(sized.currentDaily, 35.32);
    assert.equal(sized.dailyMinor, 300);
    assert.equal(sized.line, "£3 a day · 8 % of current daily spend (cap £10)");
  });

  it("is never more than the median live main ad set's daily budget", () => {
    const sized = sizeTest({ last7Spend: 120 * 7, mainAdSets: [...abo(400, 600, 900), { dailyMinor: 100, live: false }], minDailyMinor: 100 });
    assert.ok(sized.ok);
    assert.equal(sized.medianCapMinor, 600);
    assert.equal(sized.dailyMinor, 600);
  });

  it("CBO: each live ad set counts as the campaign's daily ÷ its live ad sets (Matas, 16 Nov), still capped at £10", () => {
    assert.deepEqual(liveAdSetBudgets([], [{ dailyMinor: 3000, liveAdSets: 4 }]), [750, 750, 750, 750]);
    const small = sizeTest({ last7Spend: 200 * 7, mainAdSets: [], cboCampaigns: [{ dailyMinor: 3000, liveAdSets: 4 }], minDailyMinor: 100 });
    assert.ok(small.ok);
    assert.equal(small.dailyMinor, 700);
    const big = sizeTest({ last7Spend: 500 * 7, mainAdSets: [], cboCampaigns: [{ dailyMinor: 50000, liveAdSets: 2 }], minDailyMinor: 100 });
    assert.ok(big.ok);
    assert.equal(big.dailyMinor, 1000);
  });

  it("the median of an even count is the lower middle; none known means no median limit", () => {
    assert.equal(medianBudget([500, 900, 600, 1000]), 600);
    assert.equal(medianBudget([]), null);
    const sized = sizeTest({ last7Spend: 70 * 7, mainAdSets: [], minDailyMinor: 100 });
    assert.ok(sized.ok);
    assert.equal(sized.medianCapMinor, null);
    assert.equal(sized.dailyMinor, 700);
  });

  it("uses Meta's own minimum from the account when it differs from £1.00, and £1.00 when it wasn't read", () => {
    const meta = sizeTest({ last7Spend: 10 * 7, mainAdSets: abo(500), minDailyMinor: 150 });
    assert.ok(meta.ok);
    assert.equal(meta.dailyMinor, 150);
    assert.equal(meta.atMinimum, true);
    assert.match(meta.line, /^£1\.50 a day · 15 % /);
    const unread = sizeTest({ last7Spend: 3 * 7, mainAdSets: abo(500), minDailyMinor: null });
    assert.ok(unread.ok);
    assert.equal(unread.dailyMinor, TF1.defaultMinMinor);
  });

  it("the minimum wins over a median ad set under it", () => {
    const sized = sizeTest({ last7Spend: 50 * 7, mainAdSets: abo(80, 90), minDailyMinor: 100 });
    assert.ok(sized.ok);
    assert.equal(sized.dailyMinor, 100);
    assert.equal(sized.atMinimum, true);
  });

  it("no Meta spend in the 7 days: the test can't start", () => {
    const sized = sizeTest({ last7Spend: 0, mainAdSets: abo(500), minDailyMinor: 100 });
    assert.deepEqual(sized, { ok: false, reason: "no_recent_spend", text: "No spend in the last 7 days to size a test from." });
  });

  it("{pct} is the real share, so a capped test reads under 10 %", () => {
    assert.equal(budgetLine({ daily: 10, sharePct: 6.25, cap: 10, atMinimum: false }), "£10 a day · 6 % of current daily spend (cap £10)");
  });
});

describe("TF1 / R5: the plan hold", () => {
  it("needs a budget, and a plan with money left (R5's sentences)", () => {
    assert.equal(planCheck({ budget: null, spendToDate: 0, holdMinor: 1200, otherHoldMinor: 0 }), "Set this event's budget to apply this.");
    assert.equal(planCheck({ budget: 1000, spendToDate: 1000, holdMinor: 400, otherHoldMinor: 0 }), "This event has spent its budget (£1000.00 of £1000.00), so nothing new goes live.");
  });

  it("both test ad sets together stay within 20 % of the remaining plan", () => {
    // £2,100 left → the cap is £420. A £10 test holds £40.
    assert.equal(planCheck({ budget: 4500, spendToDate: 2400, holdMinor: 4000, otherHoldMinor: 4000 }), null);
    // Only £30 left under the cap: the second test can't start.
    assert.equal(planCheck({ budget: 4500, spendToDate: 4350, holdMinor: 4000, otherHoldMinor: 0 }), capText(40, 30));
    // £3 tests hold £12 each: two fit under £30, a third's worth doesn't.
    assert.equal(planCheck({ budget: 4500, spendToDate: 4350, holdMinor: 1200, otherHoldMinor: 1200 }), null);
    assert.equal(planCheck({ budget: 4500, spendToDate: 4350, holdMinor: 1200, otherHoldMinor: 1900 }), capText(12, 11));
  });

  it("the cap sentence is design's words, pence on both amounts, and only when the test doesn't fit", () => {
    assert.equal(capText(12, 11), "This test needs £12.00 for its 4 days, and the plan's 20 % cap has £11.00 left.");
    assert.equal(capText(120, 0, "GBP"), "This test needs £120.00 for its 4 days, and the plan's 20 % cap has £0.00 left.");
    // £2,100 left → the cap is £420.00; another test holds £400.00, so a £6.25 a day test (£25.00) doesn't fit.
    assert.equal(planCheck({ budget: 4500, spendToDate: 2400, holdMinor: 2500, otherHoldMinor: 40000, currency: "GBP" }), "This test needs £25.00 for its 4 days, and the plan's 20 % cap has £20.00 left.");
    // With £20.00 of room, a £5.00 a day test (£20.00) fits: no sentence.
    assert.equal(planCheck({ budget: 4500, spendToDate: 2400, holdMinor: 2000, otherHoldMinor: 40000, currency: "GBP" }), null);
  });

  it("a hold that exactly fills the cap is allowed", () => {
    assert.equal(planCheck({ budget: 1000, spendToDate: 800, holdMinor: 2000, otherHoldMinor: 2000 }), null);
  });
});
