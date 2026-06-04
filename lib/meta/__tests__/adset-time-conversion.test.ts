/**
 * Regression tests for toUnixTs date parsing in lib/meta/adset.ts.
 *
 * ROOT CAUSE: The wizard stores budgetSchedule.endDate as an ISO datetime-local
 * string ("2026-08-06T12:00"), but toUnixTs unconditionally appended
 * "T00:00:00Z" — producing "2026-08-06T12:00T00:00:00Z" which is invalid ISO.
 * new Date() returned NaN, Math.floor(NaN / 1000) = NaN, JSON.stringify(NaN)
 * = null, Meta dropped end_time, and all ad sets launched "Ongoing".
 *
 * CONFIRMED: Supabase draft eb8e6a17 had endDate="2026-08-06T12:00"; all 8 ad
 * sets in the published campaign showed "Ongoing" in Meta Ads Manager.
 *
 * The fix normalises the input before parsing:
 *   - "YYYY-MM-DD"          → append "T00:00:00Z" (midnight UTC, legacy path)
 *   - "YYYY-MM-DDTHH:mm"    → append ":00Z" (datetime-local, current wizard)
 *   - "YYYY-MM-DDTHH:mm:ssZ" → pass through unchanged (already valid ISO)
 *
 * These tests exercise the exported buildAdSetPayload function indirectly via
 * the payload's start_time / end_time fields, but toUnixTs is private so we
 * test the public surface that depends on it.
 *
 * NOTE: toUnixTs is a module-private function; we test it indirectly through
 * buildAdSetPayload, which is the only caller.
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

function makeSchedule(overrides: Partial<BudgetScheduleSettings> = {}): BudgetScheduleSettings {
  return {
    startDate: "",
    endDate: "",
    adSets: [],
    ...overrides,
  } as unknown as BudgetScheduleSettings;
}

// ─── toUnixTs regression tests (via buildAdSetPayload) ────────────────────────

describe("buildAdSetPayload — end_time / start_time date parsing", () => {
  const CAMPAIGN_ID = "cam_001";
  const OBJ = "registration" as const;
  const GOAL = "conversions" as const;

  // Helper: build payload and return { start_time, end_time }
  function times(schedule: BudgetScheduleSettings) {
    const payload = buildAdSetPayload(
      makeAdSet(),
      CAMPAIGN_ID,
      emptyAudiences,
      schedule,
      GOAL,
      OBJ,
    );
    return { start: payload.start_time, end: payload.end_time };
  }

  // Verified: new Date("2026-08-06T00:00:00Z").getTime() / 1000
  const AUG_6_MIDNIGHT_UTC = 1785974400;
  // Verified: new Date("2026-08-06T12:00:00Z").getTime() / 1000 (midnight + 43200s)
  const AUG_6_NOON_UTC = AUG_6_MIDNIGHT_UTC + 43200;

  it("YYYY-MM-DD endDate → midnight UTC unix timestamp", () => {
    const { end } = times(makeSchedule({ endDate: "2026-08-06" }));
    assert.equal(end, AUG_6_MIDNIGHT_UTC,
      `Expected ${AUG_6_MIDNIGHT_UTC}, got ${end}`);
  });

  it("YYYY-MM-DDTHH:mm endDate (wizard datetime-local) → correct UTC timestamp (the regression)", () => {
    // This was the broken case: "2026-08-06T12:00" → NaN → null → Meta ignored end_time.
    const { end } = times(makeSchedule({ endDate: "2026-08-06T12:00" }));
    assert.equal(end, AUG_6_NOON_UTC,
      `datetime-local "2026-08-06T12:00" should parse to noon UTC ${AUG_6_NOON_UTC}, got ${end}`);
  });

  it("already-Z-suffixed ISO string passes through unchanged", () => {
    const { end } = times(makeSchedule({ endDate: "2026-08-06T12:00:00Z" }));
    assert.equal(end, AUG_6_NOON_UTC,
      `Already-valid ISO "2026-08-06T12:00:00Z" should equal noon UTC, got ${end}`);
  });

  it("YYYY-MM-DD startDate → midnight UTC unix timestamp", () => {
    const { start } = times(makeSchedule({ startDate: "2026-08-06" }));
    assert.equal(start, AUG_6_MIDNIGHT_UTC);
  });

  it("YYYY-MM-DDTHH:mm startDate (wizard datetime-local) → correct UTC timestamp", () => {
    const { start } = times(makeSchedule({ startDate: "2026-08-06T12:00" }));
    assert.equal(start, AUG_6_NOON_UTC);
  });

  it("empty endDate → end_time not set on payload", () => {
    const { end } = times(makeSchedule({ endDate: "" }));
    assert.equal(end, undefined,
      "Empty endDate should not set end_time (truthy check skips it)");
  });

  it("empty startDate → start_time not set on payload", () => {
    const { start } = times(makeSchedule({ startDate: "" }));
    assert.equal(start, undefined);
  });

  it("garbage endDate → throws rather than silently returning NaN", () => {
    assert.throws(
      () => times(makeSchedule({ endDate: "not-a-date" })),
      /toUnixTs: invalid date input/,
      "Invalid date should throw, not silently pass NaN to Meta",
    );
  });

  it("empty-string-as-value (not missing key) endDate → end_time not set", () => {
    // budgetSchedule.endDate = "" is falsy — the if-guard skips toUnixTs entirely
    const { end } = times(makeSchedule({ endDate: "" }));
    assert.equal(end, undefined);
  });
});
