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
 * Datetime-local and date-only strings are wall-clock in budgetSchedule.timezone
 * (default Europe/London). A trailing Z is already UTC. Date-only is midnight
 * in that zone. August 2026 is BST, so those clocks are UTC+1.
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

  function iso(unix: number | undefined): string {
    assert.equal(typeof unix, "number");
    return new Date((unix as number) * 1000).toISOString();
  }

  it("YYYY-MM-DD endDate in Europe/London → midnight in that zone", () => {
    const { end } = times(makeSchedule({ endDate: "2026-08-06", timezone: "Europe/London" }));
    assert.equal(iso(end), "2026-08-05T23:00:00.000Z");
  });

  it("YYYY-MM-DDTHH:mm endDate (wizard datetime-local) → that clock in Europe/London", () => {
    // This was the broken case: "2026-08-06T12:00" → NaN → null → Meta ignored end_time.
    // August 2026 is BST, so noon London is 11:00Z.
    const { end } = times(makeSchedule({ endDate: "2026-08-06T12:00", timezone: "Europe/London" }));
    assert.equal(iso(end), "2026-08-06T11:00:00.000Z");
  });

  it("already-Z-suffixed ISO string passes through unchanged", () => {
    const { end } = times(makeSchedule({ endDate: "2026-08-06T12:00:00Z", timezone: "Europe/London" }));
    assert.equal(iso(end), "2026-08-06T12:00:00.000Z");
  });

  it("YYYY-MM-DD startDate in Europe/London → midnight in that zone", () => {
    const { start } = times(makeSchedule({ startDate: "2026-08-06", timezone: "Europe/London" }));
    assert.equal(iso(start), "2026-08-05T23:00:00.000Z");
  });

  it("YYYY-MM-DDTHH:mm startDate (wizard datetime-local) → that clock in Europe/London", () => {
    const { start } = times(makeSchedule({ startDate: "2026-08-06T12:00", timezone: "Europe/London" }));
    assert.equal(iso(start), "2026-08-06T11:00:00.000Z");
  });

  it("2026-10-07T12:00 in Europe/London during BST → 11:00Z", () => {
    const { end } = times(makeSchedule({ endDate: "2026-10-07T12:00", timezone: "Europe/London" }));
    assert.equal(iso(end), "2026-10-07T11:00:00.000Z");
  });

  it("same clock time in January in Europe/London → 12:00Z", () => {
    const { end } = times(makeSchedule({ endDate: "2026-01-07T12:00", timezone: "Europe/London" }));
    assert.equal(iso(end), "2026-01-07T12:00:00.000Z");
  });

  it("2026-07-01 date-only in Europe/London → 2026-06-30T23:00Z", () => {
    const { end } = times(makeSchedule({ endDate: "2026-07-01", timezone: "Europe/London" }));
    assert.equal(iso(end), "2026-06-30T23:00:00.000Z");
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
