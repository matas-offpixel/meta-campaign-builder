import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  EVENT_FUNNEL_SEEDS,
  buildEventFunnelView,
  provenanceForPurchaseSource,
  winningSnapshotSource,
} from "../event-funnel.ts";

/**
 * Phase A.1 regression: the per-event funnel must fail on main
 * before this module existed, and must never invent zeros for a
 * missing column or first-party LPV pipe.
 */
describe("buildEventFunnelView", () => {
  const base = {
    metaReach: 10_000,
    metaImpressions: 20_000,
    metaClicks: 1_200,
    metaSpend: 400,
    tiktokReach: 2_000,
    tiktokImpressions: 5_000,
    tiktokClicks: 300,
    tiktokSpend: 80,
    googleImpressions: 8_000,
    googleClicks: 150,
    googleSpend: 60,
    metaReportedLpv: 400,
    signupCount: 1,
    purchases: 502,
    snapshotSources: ["fourthefans", "manual"],
  };

  it("sums reach from Meta + TikTok and treats Google reach as not tracked", () => {
    const view = buildEventFunnelView(base);
    const reach = view.stages.find((s) => s.key === "reach");
    assert.ok(reach);
    assert.equal(reach.value, 12_000);
    assert.equal(reach.provenance, "platform-reported");
    const google = reach.platformSplit?.find((p) => p.platform === "google");
    assert.ok(google);
    assert.equal(google.tracked, false);
    assert.equal(google.value, null);
    assert.equal(view.metaReportedLpv, 400);
  });

  it("never uses Meta landing_page_views as the first-party LPV stage", () => {
    const view = buildEventFunnelView(base);
    const lpv = view.stages.find((s) => s.key === "lpv");
    assert.ok(lpv);
    assert.equal(lpv.value, null);
    assert.equal(lpv.provenance, "not instrumented");
    assert.match(lpv.provenanceDetail, /Phase B/);
    assert.equal(lpv.conversionFromPrevious, null);
    assert.equal(lpv.seedRate, EVENT_FUNNEL_SEEDS.clickToLpv);
  });

  it("shows a real zero for a tracked clicks column, not 'not tracked'", () => {
    const view = buildEventFunnelView({
      ...base,
      googleClicks: 0,
      googleSpend: 90,
    });
    const clicks = view.stages.find((s) => s.key === "clicks");
    const google = clicks?.platformSplit?.find((p) => p.platform === "google");
    assert.ok(google);
    assert.equal(google.tracked, true);
    assert.equal(google.value, 0);
  });

  it("compares reach→click to the 15% industry seed", () => {
    const view = buildEventFunnelView(base);
    const clicks = view.stages.find((s) => s.key === "clicks");
    assert.ok(clicks);
    assert.equal(clicks.seedRate, 0.15);
    assert.match(clicks.seedLabel ?? "", /industry seed/);
    assert.ok(clicks.conversionFromPrevious != null);
    assert.ok(
      Math.abs((clicks.conversionFromPrevious ?? 0) - 1650 / 12_000) < 1e-9,
    );
  });

  it("labels purchases from the winning snapshot source, not a silent blend", () => {
    const view = buildEventFunnelView(base);
    const purchases = view.stages.find((s) => s.key === "purchases");
    assert.ok(purchases);
    assert.equal(purchases.value, 502);
    assert.equal(purchases.provenance, "manual entry");
    assert.match(purchases.provenanceDetail, /winning snapshot source is manual/i);
    assert.equal(purchases.seedRate, EVENT_FUNNEL_SEEDS.lpvToPurchase);
    assert.equal(purchases.conversionFromPrevious, null);
  });

  it("keeps signups first-party even when the count is 0", () => {
    const view = buildEventFunnelView({ ...base, signupCount: 0 });
    const signups = view.stages.find((s) => s.key === "signups");
    assert.ok(signups);
    assert.equal(signups.value, 0);
    assert.equal(signups.provenance, "first-party");
  });
});

describe("winningSnapshotSource", () => {
  it("prefers manual > xlsx_import > fourthefans > eventbrite", () => {
    assert.equal(
      winningSnapshotSource(["eventbrite", "fourthefans", "xlsx_import"]),
      "xlsx_import",
    );
    assert.equal(
      winningSnapshotSource(["eventbrite", "manual", "fourthefans"]),
      "manual",
    );
    assert.equal(winningSnapshotSource([]), null);
  });
});

describe("provenanceForPurchaseSource", () => {
  it("maps manual and xlsx to manual entry, APIs to first-party", () => {
    assert.equal(provenanceForPurchaseSource("manual"), "manual entry");
    assert.equal(provenanceForPurchaseSource("xlsx_import"), "manual entry");
    assert.equal(provenanceForPurchaseSource("fourthefans"), "first-party");
    assert.equal(provenanceForPurchaseSource("eventbrite"), "first-party");
    assert.equal(provenanceForPurchaseSource(null), "first-party");
  });
});
