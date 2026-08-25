import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  EVENT_FUNNEL_SEEDS,
  FUNNEL_COST_CELL_KINDS,
  buildEventFunnelView,
  costPerUnit,
  funnelCostLabel,
  isAmountCell,
  provenanceForPurchaseSource,
  winningSnapshotSource,
  type FunnelCostCell,
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

function assertNamedOrFinite(cell: FunnelCostCell): void {
  assert.ok(FUNNEL_COST_CELL_KINDS.includes(cell.kind), `unknown kind ${cell.kind}`);
  if (cell.kind === "amount") {
    assert.ok(Number.isFinite(cell.value), "amount must be finite");
  }
}

describe("costPerUnit", () => {
  it("spend > 0 and metric = 0 is a named zero-metric state, not Infinity", () => {
    assert.deepEqual(costPerUnit(80, 0, "no_clicks_yet"), { kind: "no_clicks_yet" });
    assert.deepEqual(costPerUnit(80, 0, "no_impressions_yet"), {
      kind: "no_impressions_yet",
    });
    assert.deepEqual(costPerUnit(80, 0, "no_reach_yet"), { kind: "no_reach_yet" });
    const cell = costPerUnit(80, 0, "no_clicks_yet");
    assert.equal(isAmountCell(cell), false);
    assert.equal(funnelCostLabel(cell), "no clicks yet");
  });

  it("spend = 0 and metric > 0 is no_spend_recorded", () => {
    assert.deepEqual(costPerUnit(0, 400, "no_clicks_yet"), {
      kind: "no_spend_recorded",
    });
    assert.equal(funnelCostLabel({ kind: "no_spend_recorded" }), "no spend recorded");
  });

  it("neither spend nor metric is a named state, not 0/0", () => {
    const cell = costPerUnit(0, 0, "no_clicks_yet");
    assert.equal(cell.kind, "no_spend_recorded");
    assert.equal(isAmountCell(cell), false);
  });

  it("returns a finite amount when both sides are positive", () => {
    const cell = costPerUnit(80, 400, "no_clicks_yet");
    assert.deepEqual(cell, { kind: "amount", value: 0.2 });
    const cpm = costPerUnit(80, 4000, "no_impressions_yet", 1000);
    assert.deepEqual(cpm, { kind: "amount", value: 20 });
  });
});

describe("buildEventFunnelView costs", () => {
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

  it("every cost cell is a finite amount or a named state", () => {
    const { costs } = buildEventFunnelView(base);
    for (const row of costs.platforms) {
      assertNamedOrFinite(row.cpm);
      assertNamedOrFinite(row.costPerReach);
      assertNamedOrFinite(row.cpc);
    }
    assertNamedOrFinite(costs.costPerLpv);
    assertNamedOrFinite(costs.costPerSignup);
    assertNamedOrFinite(costs.costPerTicket);
  });

  it("Google shows CPM + CPC and no reach data", () => {
    const google = buildEventFunnelView(base).costs.platforms.find(
      (p) => p.platform === "google",
    );
    assert.ok(google);
    assert.deepEqual(google.cpm, { kind: "amount", value: (60 / 8000) * 1000 });
    assert.deepEqual(google.cpc, { kind: "amount", value: 60 / 150 });
    assert.deepEqual(google.costPerReach, { kind: "no_reach_data" });
    assert.equal(funnelCostLabel(google.costPerReach), "no reach data");
  });

  it("highlights TikTok CPC when it is cheaper than Meta; drops when TikTok has no clicks", () => {
    const twoPlatforms = {
      ...base,
      googleSpend: 0,
      googleImpressions: 0,
      googleClicks: 0,
    };
    const withBoth = buildEventFunnelView(twoPlatforms);
    // TikTok 80/300 ≈ 0.267; Meta 400/1200 ≈ 0.333
    assert.equal(withBoth.costs.bestCpc, "tiktok");

    const withoutTikTokClicks = buildEventFunnelView({
      ...twoPlatforms,
      tiktokClicks: 0,
    });
    const tiktok = withoutTikTokClicks.costs.platforms.find(
      (p) => p.platform === "tiktok",
    );
    assert.equal(tiktok?.cpc.kind, "no_clicks_yet");
    assert.equal(withoutTikTokClicks.costs.bestCpc, null);
  });

  it("omits a platform that has neither spend nor metrics", () => {
    const { costs } = buildEventFunnelView({
      ...base,
      googleSpend: 0,
      googleImpressions: 0,
      googleClicks: 0,
    });
    assert.equal(
      costs.platforms.some((p) => p.platform === "google"),
      false,
    );
  });

  it("cost per LPV is not instrumented; signup and ticket are blended", () => {
    const { costs } = buildEventFunnelView(base);
    assert.deepEqual(costs.costPerLpv, { kind: "not_instrumented" });
    assert.equal(funnelCostLabel(costs.costPerLpv), "not instrumented yet — Phase B");
    const total = 400 + 80 + 60;
    assert.deepEqual(costs.costPerSignup, { kind: "amount", value: total / 1 });
    assert.deepEqual(costs.costPerTicket, { kind: "amount", value: total / 502 });
    assert.equal(costs.ticketProvenance, "manual entry");
  });

  it("blended signup with spend and zero signups is no_signups_yet", () => {
    const { costs } = buildEventFunnelView({ ...base, signupCount: 0 });
    assert.deepEqual(costs.costPerSignup, { kind: "no_signups_yet" });
  });

  it("organic edge: metric without spend is no_spend_recorded on that platform", () => {
    const { costs } = buildEventFunnelView({
      ...base,
      tiktokSpend: 0,
      tiktokClicks: 40,
      tiktokImpressions: 800,
      tiktokReach: 200,
    });
    const tiktok = costs.platforms.find((p) => p.platform === "tiktok");
    assert.ok(tiktok);
    assert.deepEqual(tiktok.cpc, { kind: "no_spend_recorded" });
    assert.deepEqual(tiktok.cpm, { kind: "no_spend_recorded" });
    assert.deepEqual(tiktok.costPerReach, { kind: "no_spend_recorded" });
  });
});
