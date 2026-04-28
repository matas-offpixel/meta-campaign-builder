import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { paidLinkClicksOf, paidSpendOf } from "../paid-spend.ts";

describe("paid media read helpers", () => {
  it("sums Meta and TikTok spend", () => {
    assert.equal(paidSpendOf({ ad_spend: 120, tiktok_spend: 40 }), 160);
  });

  it("coerces null, undefined, and numeric strings without returning NaN", () => {
    const cases = [
      paidSpendOf({ ad_spend: null, tiktok_spend: undefined }),
      paidSpendOf({ ad_spend: "12.50", tiktok_spend: "bad-input" }),
      paidLinkClicksOf({ link_clicks: undefined, tiktok_clicks: "9" }),
    ];

    assert.deepEqual(cases, [0, 12.5, 9]);
    for (const value of cases) {
      assert.equal(Number.isNaN(value), false);
    }
  });
});
