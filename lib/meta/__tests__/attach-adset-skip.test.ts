/**
 * Unit tests for shouldSkipAdSetCreation — the Phase 2 skip-guard that
 * prevents launch-campaign from creating brand-new ad sets on top of ad
 * sets that already exist in Meta (task #113 bug fix).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldSkipAdSetCreation } from "../attach-adset-skip.ts";
import type { WizardMode } from "@/lib/types";

describe("shouldSkipAdSetCreation", () => {
  it("skips for attach_adset — the picked live ad set(s) already exist", () => {
    assert.equal(shouldSkipAdSetCreation("attach_adset"), true);
  });

  it("skips for attach_all_adsets — Phase 2 already fetched every live ad set (task #113 regression)", () => {
    assert.equal(shouldSkipAdSetCreation("attach_all_adsets"), true);
  });

  it("does NOT skip for new — the wizard creates everything from scratch", () => {
    assert.equal(shouldSkipAdSetCreation("new"), false);
  });

  it("does NOT skip for attach_campaign — it attaches a brand-new ad set under each campaign", () => {
    assert.equal(shouldSkipAdSetCreation("attach_campaign"), false);
  });

  it("covers every WizardMode value (compile-time exhaustiveness guard)", () => {
    const modes: WizardMode[] = ["new", "attach_campaign", "attach_adset", "attach_all_adsets"];
    const results = modes.map((m) => [m, shouldSkipAdSetCreation(m)] as const);
    assert.deepEqual(results, [
      ["new", false],
      ["attach_campaign", false],
      ["attach_adset", true],
      ["attach_all_adsets", true],
    ]);
  });
});
