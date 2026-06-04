/**
 * Regression tests: campaigns, ad sets, and ads are created ACTIVE at launch.
 *
 * HISTORY: Prior to this change all three were created PAUSED, requiring a
 * manual activation step in Meta Ads Manager before any spend occurred.
 * The decision was to flip the default so pressing "Launch" in the wizard
 * means the campaign starts spending immediately.
 *
 * These tests exist solely to prevent a future PR from silently reverting
 * the default back to PAUSED. They are intentionally minimal — if the
 * status ever changes to PAUSED again a human should make that decision
 * explicitly, not through an accidental refactor.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAdSetPayload } from "../adset.ts";
import { buildAdPayload } from "../creative.ts";
import type {
  AdSetSuggestion,
  AudienceSettings,
  BudgetScheduleSettings,
} from "../../types.ts";

// ─── Minimal fixtures ─────────────────────────────────────────────────────────

function makeAdSet(overrides: Partial<AdSetSuggestion> = {}): AdSetSuggestion {
  return {
    id: "s1",
    name: "Test Ad Set",
    sourceType: "interest_group",
    sourceId: "g1",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 10,
    advantagePlus: false,
    enabled: true,
    ...overrides,
  } as AdSetSuggestion;
}

const emptyAudiences: AudienceSettings = {
  interestGroups: [],
  customAudienceGroups: [],
  pageGroups: [],
  savedAudiences: [],
  selectedPagesLookalikeGroups: [],
} as unknown as AudienceSettings;

const emptySchedule: BudgetScheduleSettings = {
  startDate: "",
  endDate: "",
  adSets: [],
} as unknown as BudgetScheduleSettings;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("launch defaults: all entities created ACTIVE", () => {
  it("buildAdSetPayload returns status=ACTIVE", () => {
    const payload = buildAdSetPayload(
      makeAdSet(),
      "cam_001",
      emptyAudiences,
      emptySchedule,
      "conversions",
      "registration",
    );
    assert.equal(
      payload.status,
      "ACTIVE",
      "Ad sets must be ACTIVE at launch so spend starts immediately. " +
        "If you are intentionally changing this, update this test explicitly.",
    );
  });

  it("buildAdPayload returns status=ACTIVE", () => {
    const payload = buildAdPayload("My Ad", "cre_001", "adset_001");
    assert.equal(
      payload.status,
      "ACTIVE",
      "Ads must be ACTIVE at launch. " +
        "If you are intentionally changing this, update this test explicitly.",
    );
  });
});
