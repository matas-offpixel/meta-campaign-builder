import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { signupPhaseCpr, signupPhaseSpend } from "../signup-phase-cpr.ts";

describe("signup-phase spend window", () => {
  it("uses only rows on or before the general-sale day", () => {
    const result = signupPhaseCpr(
      [
        { date: "2026-08-26", ad_spend: 100 },
        { date: "2026-09-09", ad_spend: 0 },
        { date: "2026-09-10", ad_spend: 900 },
      ],
      "2026-09-09T13:00:00+00:00",
      100,
    );
    assert.equal(result.spend, 100);
    assert.equal(result.cpr, 1);
    assert.equal(result.label, "£1.00 per signup · £100.00 spent 26 Aug – 9 Sept");
  });

  it("skips leading zero-pad days when dating the window", () => {
    const window = signupPhaseSpend(
      [
        { date: "2026-06-27", ad_spend: 0 },
        { date: "2026-08-26", ad_spend: 80 },
        { date: "2026-08-27", ad_spend: 20 },
      ],
      "2026-09-09T13:00:00+00:00",
    );
    assert.equal(window.fromDay, "2026-08-26");
    assert.equal(window.spend, 100);
  });

  it("is all-time when general sale is unset", () => {
    const result = signupPhaseCpr(
      [
        { date: "2026-08-26", ad_spend: 50 },
        { date: "2026-09-20", ad_spend: 50 },
      ],
      null,
      100,
    );
    assert.equal(result.allTime, true);
    assert.equal(result.spend, 100);
    assert.equal(result.label, "£1.00 per signup · £100.00 spent all-time");
  });
});
