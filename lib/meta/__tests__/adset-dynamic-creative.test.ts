/**
 * Regression tests for the Dynamic Creative opt-in in lib/meta/adset.ts.
 *
 * ROOT CAUSE: variation-rotation creatives are built as a Dynamic-Creative
 * asset_feed_spec (N assets, no customization rules — see
 * buildVariationRotationCreative). Meta silently degrades a multi-asset
 * creative to a single asset UNLESS the AD SET is created with
 * is_dynamic_creative:true. Before this fix the flag was never sent
 * (grep: 0 occurrences of "is_dynamic_creative" in the repo).
 *
 * buildAdSetPayload now takes an optional `hasVariationRotationCreative` flag:
 *   - true  → payload.is_dynamic_creative = true
 *   - false / omitted → the field is OMITTED entirely (Meta may treat an
 *     explicit `false` differently, and the flag is immutable once set).
 *
 * Run: node --test lib/meta/__tests__/adset-dynamic-creative.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAdSetPayload } from "../adset.ts";
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

const schedule: BudgetScheduleSettings = {
  startDate: "",
  endDate: "",
  adSets: [],
} as unknown as BudgetScheduleSettings;

const CAMPAIGN_ID = "cam_001";
const OBJ = "traffic" as const;
const GOAL = "link_clicks" as const;

function build(hasVariationRotationCreative?: boolean) {
  return buildAdSetPayload(
    makeAdSet(),
    CAMPAIGN_ID,
    emptyAudiences,
    schedule,
    GOAL,
    OBJ,
    undefined, // pixelId
    hasVariationRotationCreative,
  );
}

// ─── is_dynamic_creative flag behaviour ───────────────────────────────────────

describe("buildAdSetPayload — is_dynamic_creative flag", () => {
  it("sets is_dynamic_creative:true when the flag is passed", () => {
    const payload = build(true);
    assert.equal(payload.is_dynamic_creative, true);
  });

  it("OMITS the field (not false) when the flag is not passed", () => {
    const payload = build();
    assert.equal(payload.is_dynamic_creative, undefined, "field must be undefined, not false");
    assert.ok(
      !("is_dynamic_creative" in payload),
      "key must be entirely absent so Meta never receives an explicit false",
    );
    // And it must not leak into the serialized payload sent to Meta.
    assert.ok(!JSON.stringify(payload).includes("is_dynamic_creative"));
  });

  it("OMITS the field when the flag is explicitly false", () => {
    const payload = build(false);
    assert.equal(payload.is_dynamic_creative, undefined);
    assert.ok(!("is_dynamic_creative" in payload));
  });
});
