/**
 * lib/dashboard/__tests__/venue-pacing-summary.test.ts
 *
 * Unit tests for the shared pacing presentation + summary layer added by
 * the visual-overhaul PR. Covers the 3-state tone thresholds, verdict
 * derivation (must match the canonical `warning` field), efficiency,
 * Today-alert issue derivation, the scrubber projection, and the new
 * `dailySpendSeries` canonical field.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildVenueCanonicalFunnel,
  type VenueCanonicalFunnel,
} from "../venue-canonical-funnel.ts";
import type { EventCodeLifetimeMetaCacheRow } from "../../db/event-code-lifetime-meta-cache.ts";
import type { DailyRollupRow } from "../../db/client-portal-server.ts";
import {
  inverseTone,
  pacingTone,
  verdictPresentation,
} from "../pacing-presentation.ts";
import {
  buildVenuePacingRow,
  deriveVenueIssues,
  deriveVenueVerdict,
  projectFunnelVolumes,
} from "../venue-pacing-summary.ts";

const TODAY = new Date("2026-05-28T00:00:00Z");

function makeCacheRow(
  overrides: Partial<EventCodeLifetimeMetaCacheRow> = {},
): EventCodeLifetimeMetaCacheRow {
  return {
    client_id: "c1",
    event_code: "WC26-TEST",
    meta_reach: null,
    meta_impressions: null,
    meta_link_clicks: null,
    meta_landing_page_views: null,
    meta_regs: null,
    meta_video_plays_3s: null,
    meta_video_plays_15s: null,
    meta_video_plays_p100: null,
    meta_engagements: null,
    campaign_names: [],
    fetched_at: "2026-05-28T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-05-28T00:00:00Z",
    ...overrides,
  };
}

function makeRollup(overrides: Partial<DailyRollupRow> = {}): DailyRollupRow {
  return {
    event_id: "ev-1",
    date: "2026-05-01",
    tickets_sold: 0,
    ad_spend: null,
    tiktok_spend: null,
    google_ads_spend: null,
    ad_spend_allocated: null,
    revenue: null,
    link_clicks: null,
    ad_spend_presale: null,
    meta_regs: null,
    tiktok_clicks: null,
    ...overrides,
  } as DailyRollupRow;
}

/** An under-pacing venue: high CPT, small budget, far from capacity. */
function underPacer(): VenueCanonicalFunnel {
  const rollups: DailyRollupRow[] = [];
  // 10 days of low spend at a poor CPT (few tickets).
  for (let i = 0; i < 10; i++) {
    const day = String(i + 1).padStart(2, "0");
    rollups.push(
      makeRollup({ date: `2026-05-${day}`, ad_spend_allocated: 100, tickets_sold: 5 }),
    );
  }
  return buildVenueCanonicalFunnel({
    capacity: 5000,
    ticketsSold: 200,
    lifetimeCacheRow: makeCacheRow({
      meta_reach: 100_000,
      meta_link_clicks: 8_000, // 8% reach→click < 14% → below
      meta_landing_page_views: 4_000,
    }),
    dailyRollups: rollups,
    eventDate: "2026-06-17", // 20 days out
    allocatedBudget: 2_000, // far short of what's required
    today: TODAY,
  });
}

describe("pacing-presentation — tone thresholds", () => {
  it("emerald at/above benchmark", () => {
    assert.equal(pacingTone(0.14, 0.14), "above");
    assert.equal(pacingTone(0.2, 0.14), "above");
  });
  it("amber within 10% below", () => {
    assert.equal(pacingTone(0.13, 0.14), "within"); // 0.928 ratio
  });
  it("red more than 10% below", () => {
    assert.equal(pacingTone(0.1, 0.14), "below"); // 0.71 ratio
  });
  it("neutral on null", () => {
    assert.equal(pacingTone(null, 0.14), "neutral");
  });
  it("inverseTone: lower is better (CPT)", () => {
    assert.equal(inverseTone(1.83, 4.8), "above"); // well below benchmark
    assert.equal(inverseTone(5.0, 4.8), "within"); // just above
    assert.equal(inverseTone(10, 4.8), "below"); // way above
  });
});

describe("deriveVenueVerdict — matches canonical warning", () => {
  it("under_pacing when warning=additional_needed", () => {
    const f = underPacer();
    assert.equal(f.spendReconciliation.warning, "additional_needed");
    assert.equal(deriveVenueVerdict(f), "under_pacing");
  });

  it("sold_out when no tickets remaining", () => {
    const f = buildVenueCanonicalFunnel({
      capacity: 1000,
      ticketsSold: 1000,
      lifetimeCacheRow: null,
      dailyRollups: [makeRollup({ ad_spend_allocated: 500 })],
      eventDate: "2026-06-17",
      allocatedBudget: 1000,
      today: TODAY,
    });
    assert.equal(deriveVenueVerdict(f), "sold_out");
  });

  it("event_passed when event date in the past", () => {
    const f = buildVenueCanonicalFunnel({
      capacity: 1000,
      ticketsSold: 500,
      lifetimeCacheRow: null,
      dailyRollups: [makeRollup({ ad_spend_allocated: 500 })],
      eventDate: "2026-05-01",
      allocatedBudget: 5000,
      today: TODAY,
    });
    assert.equal(deriveVenueVerdict(f), "event_passed");
  });
});

describe("buildVenuePacingRow — efficiency", () => {
  it("computes sold/spend fractions and efficiency tone", () => {
    const f = buildVenueCanonicalFunnel({
      capacity: 1000,
      ticketsSold: 700, // 70% sold
      lifetimeCacheRow: null,
      dailyRollups: [makeRollup({ ad_spend_allocated: 500 })],
      eventDate: "2026-06-17",
      allocatedBudget: 1000, // 50% spend
      today: TODAY,
    });
    const row = buildVenuePacingRow({
      funnel: f,
      eventCode: "WC26-TEST",
      label: "Test",
      href: "/x",
    });
    assert.equal(Math.round(row.soldFraction * 100), 70);
    assert.equal(Math.round((row.spendFraction ?? 0) * 100), 50);
    // 70% sold vs 50% spend → selling faster → above (efficient)
    assert.equal(row.efficiencyTone, "above");
    assert.ok((row.efficiency ?? 0) > 0);
  });
});

describe("deriveVenueIssues — Today alerts", () => {
  it("under-pacer yields a red issue first", () => {
    const f = underPacer();
    const row = buildVenuePacingRow({
      funnel: f,
      eventCode: "WC26-TEST",
      label: "The Pitt",
      href: "/pitt",
    });
    const issues = deriveVenueIssues(row);
    assert.ok(issues.length >= 1);
    assert.equal(issues[0]!.severity, "red");
    assert.match(issues[0]!.message, /under-pacing/);
  });

  it("sold-out venue yields no issues", () => {
    const f = buildVenueCanonicalFunnel({
      capacity: 1000,
      ticketsSold: 1000,
      lifetimeCacheRow: null,
      dailyRollups: [makeRollup({ ad_spend_allocated: 500 })],
      eventDate: "2026-06-17",
      allocatedBudget: 1000,
      today: TODAY,
    });
    const row = buildVenuePacingRow({
      funnel: f,
      eventCode: "WC26-TEST",
      label: "Sold",
      href: "/x",
    });
    assert.deepEqual(deriveVenueIssues(row), []);
  });
});

describe("projectFunnelVolumes — scrubber", () => {
  it("more daily spend projects more tickets", () => {
    const f = underPacer();
    const low = projectFunnelVolumes(f, 100);
    const high = projectFunnelVolumes(f, 400);
    assert.ok(high.projectedTickets > low.projectedTickets);
    assert.ok(high.additionalSpend > low.additionalSpend);
    // all four stages present, upstream scale up too
    assert.equal(high.stages.length, 4);
    const reachLow = low.stages.find((s) => s.key === "reach")!;
    const reachHigh = high.stages.find((s) => s.key === "reach")!;
    assert.ok((reachHigh.projected ?? 0) > (reachLow.projected ?? 0));
  });
});

describe("dailySpendSeries — canonical derived field", () => {
  it("collapses per-event rows by date, trailing window, ascending", () => {
    const rollups: DailyRollupRow[] = [
      // two events same date → collapse
      makeRollup({ event_id: "a", date: "2026-05-27", ad_spend_allocated: 50, ad_spend_presale: 10 }),
      makeRollup({ event_id: "b", date: "2026-05-27", ad_spend_allocated: 40 }),
      makeRollup({ event_id: "a", date: "2026-05-26", ad_spend_allocated: 30 }),
      // outside 14-day window → excluded
      makeRollup({ event_id: "a", date: "2026-01-01", ad_spend_allocated: 999 }),
    ];
    const f = buildVenueCanonicalFunnel({
      capacity: 1000,
      ticketsSold: 100,
      lifetimeCacheRow: null,
      dailyRollups: rollups,
      eventDate: "2026-06-17",
      allocatedBudget: 5000,
      today: TODAY,
    });
    const series = f.dailySpendSeries;
    assert.equal(series.length, 2);
    assert.equal(series[0]!.date, "2026-05-26");
    assert.equal(series[0]!.spent, 30);
    assert.equal(series[1]!.date, "2026-05-27");
    assert.equal(series[1]!.spent, 100); // 50+10+40
  });
});

describe("verdictPresentation", () => {
  it("maps verdicts to tone + emoji", () => {
    assert.equal(verdictPresentation("under_pacing").tone, "below");
    assert.equal(verdictPresentation("on_track").short, "ON TRACK");
    assert.equal(verdictPresentation("sold_out").emoji, "🎯");
  });
});
