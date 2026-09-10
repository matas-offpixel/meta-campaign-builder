/**
 * Pre-evaluate eligibility gates. Each skip is named.
 *
 * Run: node --experimental-strip-types --test lib/optimisation/__tests__/eligibility.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateEligibility,
  eventDateHasPassed,
  instantIsPast,
  isDeliveringEffectiveStatus,
  presalePhaseHasEnded,
} from "../eligibility.ts";

const NOW = new Date("2026-09-09T20:01:05Z");

describe("isDeliveringEffectiveStatus", () => {
  it("treats only ACTIVE as delivering", () => {
    assert.equal(isDeliveringEffectiveStatus("ACTIVE"), true);
    assert.equal(isDeliveringEffectiveStatus("PAUSED"), false);
    assert.equal(isDeliveringEffectiveStatus("CAMPAIGN_PAUSED"), false);
    assert.equal(isDeliveringEffectiveStatus("WITH_ISSUES"), false);
  });

  it("fails open when status is missing", () => {
    assert.equal(isDeliveringEffectiveStatus(null), true);
    assert.equal(isDeliveringEffectiveStatus(undefined), true);
    assert.equal(isDeliveringEffectiveStatus(""), true);
  });
});

describe("instantIsPast / eventDateHasPassed", () => {
  it("date-only campaign_end_at is past on a later UTC day, not the same day", () => {
    assert.equal(instantIsPast("2026-09-08", NOW), true);
    assert.equal(instantIsPast("2026-09-09", NOW), false);
    assert.equal(instantIsPast("2026-09-10", NOW), false);
  });

  it("timestamptz campaign_end_at compares to the instant", () => {
    assert.equal(instantIsPast("2026-09-09T19:00:00Z", NOW), true);
    assert.equal(instantIsPast("2026-09-09T21:00:00Z", NOW), false);
  });

  it("event_date in the past is the day before today, not today", () => {
    assert.equal(eventDateHasPassed("2026-09-08", NOW), true);
    assert.equal(eventDateHasPassed("2026-09-09", NOW), false);
    assert.equal(eventDateHasPassed(null, NOW), false);
  });
});

describe("presalePhaseHasEnded", () => {
  it("fires only for a stored presale phase after general sale", () => {
    assert.equal(presalePhaseHasEnded("presale", "2026-09-01T00:00:00Z", NOW), true);
    assert.equal(presalePhaseHasEnded("on_sale", "2026-09-01T00:00:00Z", NOW), false);
    assert.equal(presalePhaseHasEnded("presale", "2026-09-20T00:00:00Z", NOW), false);
    assert.equal(presalePhaseHasEnded(null, "2026-09-01T00:00:00Z", NOW), false);
    assert.equal(presalePhaseHasEnded("presale", null, NOW), false);
  });
});

describe("evaluateEligibility — named skips", () => {
  it("paused ad set inside an otherwise live campaign is skip_not_delivering", () => {
    const skip = evaluateEligibility({
      now: NOW,
      effectiveStatus: "PAUSED",
      campaignEndAt: "2026-12-01",
      eventDate: "2026-12-15",
    });
    assert.equal(skip?.action, "skip_not_delivering");
    assert.match(skip?.reason ?? "", /PAUSED/);
  });

  it("does not infer a paused ad set from a missing campaign status", () => {
    const skip = evaluateEligibility({
      now: NOW,
      effectiveStatus: "ACTIVE",
    });
    assert.equal(skip, null);
  });

  it("past campaign_end_at is skip_campaign_ended", () => {
    const skip = evaluateEligibility({
      now: NOW,
      effectiveStatus: "ACTIVE",
      campaignEndAt: "2026-09-01T00:00:00Z",
    });
    assert.equal(skip?.action, "skip_campaign_ended");
  });

  it("past plan end_date is skip_campaign_ended", () => {
    const skip = evaluateEligibility({
      now: NOW,
      effectiveStatus: "ACTIVE",
      planEndDate: "2026-09-08",
    });
    assert.equal(skip?.action, "skip_campaign_ended");
    assert.match(skip?.reason ?? "", /plan end_date/);
  });

  it("past event_date is skip_event_passed", () => {
    const skip = evaluateEligibility({
      now: NOW,
      effectiveStatus: "ACTIVE",
      eventDate: "2026-09-01",
    });
    assert.equal(skip?.action, "skip_event_passed");
  });

  it("D.O.D 2026-09-09 20:01 — stored presale after general sale is skip_phase_ended, not pause", () => {
    const skip = evaluateEligibility({
      now: NOW,
      effectiveStatus: "ACTIVE",
      planPhase: "presale",
      generalSaleAt: "2026-09-01T10:00:00Z",
      eventDate: "2026-11-26",
    });
    assert.equal(skip?.action, "skip_phase_ended");
    assert.match(skip?.reason ?? "", /presale/);
  });

  it("a live in-window campaign with no phase fact stays eligible", () => {
    const skip = evaluateEligibility({
      now: NOW,
      effectiveStatus: "ACTIVE",
      campaignEndAt: "2026-12-01",
      eventDate: "2026-12-15",
    });
    assert.equal(skip, null);
  });

  it("delivery is checked before calendar so a paused ended campaign is named skip_not_delivering", () => {
    const skip = evaluateEligibility({
      now: NOW,
      effectiveStatus: "CAMPAIGN_PAUSED",
      campaignEndAt: "2026-09-01",
      eventDate: "2026-09-01",
      planPhase: "presale",
      generalSaleAt: "2026-08-01",
    });
    assert.equal(skip?.action, "skip_not_delivering");
  });
});
