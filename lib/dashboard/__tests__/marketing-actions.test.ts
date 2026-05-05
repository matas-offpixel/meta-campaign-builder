import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { recommendMarketingAction, type MarketingActionEvent } from "../marketing-actions.ts";

const baseEvent: MarketingActionEvent = {
  tickets_sold: 100,
  capacity: 500,
  days_until_event: 60,
  pct_sold: 20,
  tiers: [
    {
      tier_name: "General Admission",
      quantity_sold: 100,
      quantity_available: 500,
      price: 25,
    },
  ],
};

describe("recommendMarketingAction", () => {
  it("celebrates sold out events", () => {
    const action = recommendMarketingAction({
      ...baseEvent,
      tickets_sold: 500,
      capacity: 500,
      pct_sold: 100,
    });

    assert.equal(action.kind, "sold_out_celebrate");
  });

  it("falls back when no tier data is available", () => {
    const action = recommendMarketingAction({
      ...baseEvent,
      tiers: [],
    });

    assert.equal(action.kind, "hold");
    assert.match(action.reason, /No tier data available/);
  });

  it("scales or reduces spend from headline pacing when tiers are missing", () => {
    assert.equal(
      recommendMarketingAction({
        ...baseEvent,
        pct_sold: 80,
        days_until_event: 20,
        tiers: [],
      }).kind,
      "scale_spend",
    );
    assert.equal(
      recommendMarketingAction({
        ...baseEvent,
        pct_sold: 20,
        days_until_event: 10,
        tiers: [],
      }).kind,
      "reduce_spend",
    );
  });

  it("holds during pre-sale before tiers are released", () => {
    const action = recommendMarketingAction({
      ...baseEvent,
      tiers: [
        {
          tier_name: "Earlybird",
          quantity_sold: 0,
          quantity_available: 0,
          price: 20,
        },
      ],
    });

    assert.equal(action.kind, "pre_sale_hold");
  });

  it("promotes the next available tier after the lowest tier sells out", () => {
    const action = recommendMarketingAction({
      ...baseEvent,
      tiers: [
        {
          tier_name: "Earlybird",
          quantity_sold: 100,
          quantity_available: 100,
          price: 15,
        },
        {
          tier_name: "2nd Release",
          quantity_sold: 10,
          quantity_available: 200,
          price: 25,
        },
      ],
    });

    assert.equal(action.kind, "promote_next_tier");
    assert.match(action.reason, /Earlybird sold out/);
  });

  it("recommends releasing a final tier when the active tier is nearly gone", () => {
    const action = recommendMarketingAction({
      ...baseEvent,
      tiers: [
        {
          tier_name: "2nd Release",
          quantity_sold: 180,
          quantity_available: 200,
          price: 25,
        },
        {
          tier_name: "Final Release",
          quantity_sold: 0,
          quantity_available: 0,
          price: 35,
        },
      ],
    });

    assert.equal(action.kind, "release_next_tier");
    assert.match(action.reason, /Final Release/);
  });

  it("spots premium underperformance relative to GA", () => {
    const action = recommendMarketingAction({
      ...baseEvent,
      tiers: [
        {
          tier_name: "GA 2nd Release",
          quantity_sold: 86,
          quantity_available: 200,
          price: 25,
        },
        {
          tier_name: "Premium 2nd Release",
          quantity_sold: 13,
          quantity_available: 100,
          price: 50,
        },
      ],
    });

    assert.equal(action.kind, "premium_underperforming");
    assert.match(action.reason, /Premium 2nd Release at 13% vs GA 2nd Release at 43%/);
  });

  it("uses overall pace after tier-specific checks", () => {
    assert.equal(
      recommendMarketingAction({
        ...baseEvent,
        tickets_sold: 400,
        capacity: 500,
        pct_sold: 80,
        days_until_event: 30,
      }).kind,
      "scale_spend",
    );
    assert.equal(
      recommendMarketingAction({
        ...baseEvent,
        pct_sold: 20,
        days_until_event: 7,
      }).kind,
      "reduce_spend",
    );
  });

  it("holds when no stronger signal is present", () => {
    const action = recommendMarketingAction(baseEvent);

    assert.equal(action.kind, "hold");
  });
});
