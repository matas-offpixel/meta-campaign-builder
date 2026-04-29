import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applySmartPlusDefaults,
  parseOptionalMoney,
  validateBudgetGuardrails,
} from "../budget-schedule.ts";
import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";

describe("TikTok Smart+ budget linkage", () => {
  it("locks bid strategy and Step 5 budget schedule defaults", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    const now = new Date("2026-04-29T12:15:00Z");
    const patch = applySmartPlusDefaults(draft, now);

    assert.equal(patch.optimisation.smartPlusEnabled, true);
    assert.equal(patch.optimisation.bidStrategy, "SMART_PLUS");
    assert.equal(patch.campaignSetup.bidStrategy, "SMART_PLUS");
    assert.equal(patch.budgetSchedule.budgetMode, "LIFETIME");
    assert.equal(patch.budgetSchedule.automaticSchedule, true);
    assert.ok(patch.budgetSchedule.scheduleStartAt);
    assert.ok(patch.budgetSchedule.scheduleEndAt);
  });

  it("validates budget against guardrails and schedule order", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    const warnings = validateBudgetGuardrails({
      budget: {
        ...draft.budgetSchedule,
        budgetMode: "DAILY",
        budgetAmount: 250,
        scheduleStartAt: "2026-05-01T10:00",
        scheduleEndAt: "2026-04-30T10:00",
      },
      optimisation: {
        ...draft.optimisation,
        maxDailySpend: 200,
      },
    });

    assert.deepEqual(warnings, [
      "Daily budget is above the max daily spend guardrail.",
      "Schedule end must be after schedule start.",
    ]);
  });
});

describe("TikTok wizard money parsing", () => {
  it("accepts currency symbols, commas, plain numbers, and pasted newlines", () => {
    assert.equal(parseOptionalMoney("£1,800"), 1800);
    assert.equal(parseOptionalMoney("1,800.50"), 1800.5);
    assert.equal(parseOptionalMoney("1800"), 1800);
    assert.equal(parseOptionalMoney("\n£2,000\n"), 2000);
  });

  it("treats blank optional fields as null", () => {
    assert.equal(parseOptionalMoney(""), null);
    assert.equal(parseOptionalMoney("   "), null);
  });
});
