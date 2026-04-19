// ─────────────────────────────────────────────────────────────────────────────
// Pricing calculator tests.
//
// Run with:  node --experimental-strip-types --test lib/pricing/__tests__
// (Node 22.6+ strips TS at runtime; no extra deps needed.)
//
// Cases mirror the legacy spreadsheet:
//   - Louder Booka Shade           1500 cap, ads_d2c_creative
//                                  → £1,350 base, £150 sell-out bonus
//   - DHB NYC                      1100 cap, ads
//                                  → calculator says £880 base
//                                    (legacy DHB rate sheet shows £770;
//                                    flagged in the comment below — likely
//                                    a custom DHB tier rather than a bug.)
//   - Minimum-fee floor            600 cap, ads → £750 (minimum kicks in)
//   - Fee cap                      5500 cap, ads_d2c_creative → £4,000
// ─────────────────────────────────────────────────────────────────────────────

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  calculateQuote,
  calculateInvoiceAmounts,
  calculateSettlementDueDate,
} from "../calculator.ts";

describe("calculateQuote", () => {
  it("Louder Booka Shade — 1,500 cap, ads_d2c_creative, sold-out expected", () => {
    const result = calculateQuote({
      capacity: 1500,
      marketing_budget: 4000,
      service_tier: "ads_d2c_creative",
      sold_out_expected: true,
    });
    assert.equal(result.base_fee, 1350);
    assert.equal(result.sell_out_bonus, 150);
    assert.equal(result.max_fee, 1500);
    assert.equal(result.fee_cap_applied, false);
    assert.equal(result.minimum_fee_applied, false);
  });

  it("DHB NYC — 1,100 cap, ads only", () => {
    // NOTE: The DHB rate card on file shows £770 for this row, which would
    // imply £0.70 per ticket. Our standard 'ads' tier is £0.80 → £880.
    // Treating £880 as the canonical answer until Matas confirms whether
    // DHB is on a discounted custom tier.
    const result = calculateQuote({
      capacity: 1100,
      marketing_budget: 2000,
      service_tier: "ads",
      sold_out_expected: false,
    });
    assert.equal(result.base_fee, 880);
    assert.equal(result.sell_out_bonus, 0);
    assert.equal(result.max_fee, 880);
    assert.equal(result.fee_cap_applied, false);
    assert.equal(result.minimum_fee_applied, false);
  });

  it("Minimum fee floor — 600 cap, ads → £750", () => {
    const result = calculateQuote({
      capacity: 600,
      marketing_budget: 0,
      service_tier: "ads",
      sold_out_expected: false,
    });
    assert.equal(result.base_fee, 750);
    assert.equal(result.minimum_fee_applied, true);
    assert.equal(result.fee_cap_applied, false);
  });

  it("Fee cap — 5,500 cap, ads_d2c_creative → £4,000", () => {
    const result = calculateQuote({
      capacity: 5500,
      marketing_budget: 10000,
      service_tier: "ads_d2c_creative",
      sold_out_expected: false,
    });
    assert.equal(result.base_fee, 4000);
    assert.equal(result.fee_cap_applied, true);
    assert.equal(result.minimum_fee_applied, false);
  });

  it("Large room cap — 15,000 cap, ads_d2c_creative → £4,500", () => {
    const result = calculateQuote({
      capacity: 15000,
      marketing_budget: 25000,
      service_tier: "ads_d2c_creative",
      sold_out_expected: false,
    });
    assert.equal(result.base_fee, 4500);
    assert.equal(result.fee_cap_applied, true);
  });

  it("XL room cap — 20,000 cap, ads_d2c_creative → £5,000", () => {
    const result = calculateQuote({
      capacity: 20000,
      marketing_budget: 50000,
      service_tier: "ads_d2c_creative",
      sold_out_expected: true,
    });
    assert.equal(result.base_fee, 5000);
    assert.equal(result.sell_out_bonus, 2000);
    assert.equal(result.max_fee, 7000);
  });
});

describe("calculateInvoiceAmounts", () => {
  it("75/25 split on £1,350", () => {
    const split = calculateInvoiceAmounts({ base_fee: 1350 }, 75);
    assert.equal(split.upfront, 1012.5);
    assert.equal(split.settlement, 337.5);
  });

  it("50/50 Louder split on £1,350", () => {
    const split = calculateInvoiceAmounts({ base_fee: 1350 }, 50);
    assert.equal(split.upfront, 675);
    assert.equal(split.settlement, 675);
  });

  it("clamps wild upfront percentages", () => {
    const high = calculateInvoiceAmounts({ base_fee: 1000 }, 150);
    assert.equal(high.upfront, 1000);
    assert.equal(high.settlement, 0);
    const low = calculateInvoiceAmounts({ base_fee: 1000 }, -25);
    assert.equal(low.upfront, 0);
    assert.equal(low.settlement, 1000);
  });
});

describe("calculateSettlementDueDate", () => {
  it("1_month_before subtracts a month", () => {
    const due = calculateSettlementDueDate(
      new Date("2026-06-15T00:00:00Z"),
      "1_month_before",
    );
    assert.equal(due?.toISOString().slice(0, 10), "2026-05-15");
  });

  it("2_weeks_before subtracts 14 days", () => {
    const due = calculateSettlementDueDate(
      new Date("2026-06-15T00:00:00Z"),
      "2_weeks_before",
    );
    assert.equal(due?.toISOString().slice(0, 10), "2026-06-01");
  });

  it("on_completion mirrors the event date", () => {
    const due = calculateSettlementDueDate(
      new Date("2026-06-15T00:00:00Z"),
      "on_completion",
    );
    assert.equal(due?.toISOString().slice(0, 10), "2026-06-15");
  });

  it("returns null when no event date", () => {
    assert.equal(
      calculateSettlementDueDate(null, "1_month_before"),
      null,
    );
  });
});
