import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PortalEvent } from "@/lib/db/client-portal-server";
import type { MetaCampaignRow } from "@/lib/insights/types";
import {
  aggregateFunnelData,
  LEEDS_FA_CUP_FUNNEL_DEFAULTS,
} from "../funnel-aggregations.ts";
import type { FunnelStage } from "../funnel-stage-classifier.ts";

describe("aggregateFunnelData", () => {
  it("anchors Leeds defaults from presale BOFU campaign data", () => {
    const data = aggregateFunnelData(
      [event({ id: "leeds", capacity: 5280, tickets: 1219 })],
      [
        campaign({
          name: "[Leeds26-FACUP] PRESALE | Conversions",
          stage: "BOFU",
          spend: 523,
          lpv: 2857,
          regs: 522,
        }),
      ],
      [],
      null,
      LEEDS_FA_CUP_FUNNEL_DEFAULTS,
    );

    assert.equal(data.bofu.campaigns.length, 1);
    assert.equal(data.bofu.lpv, 2857);
    assert.equal(data.bofu.regs, 522);
    assert.equal(round4(data.actualBofuToReg), round4(522 / 2857));
    assert.equal(data.effectiveBofuToReg, 0.1827);
    assert.equal(data.effectiveRegToSale, 0.51);
    assert.equal(data.effectiveOrganicLift, 0.57);
    assert.equal(data.effectiveCostPerReg, 1);
    assert.equal(round4(data.bofu.costPerReg), round4(523 / 522));
  });

  it("aggregates classified campaign rows into TOFU/MOFU/BOFU buckets", () => {
    const data = aggregateFunnelData(
      [event({ id: "bristol-a", capacity: 1320 }), event({ id: "bristol-b", capacity: 3960 })],
      [
        campaign({ name: "[WC26-BRISTOL] Awareness", stage: "TOFU", reach: 100000, spend: 900 }),
        campaign({ name: "[WC26-BRISTOL] Traffic", stage: "MOFU", reach: 25000, lpv: 5000, spend: 600 }),
        campaign({ name: "[WC26-BRISTOL] PRESALE", stage: "BOFU", lpv: 1200, regs: 220, spend: 250 }),
      ],
      [],
      null,
      LEEDS_FA_CUP_FUNNEL_DEFAULTS,
    );

    assert.equal(data.ticketsTarget, 5280);
    assert.equal(data.totalSpend, 1750);
    assert.equal(data.tofu.reach, 100000);
    assert.equal(data.mofu.reach, 25000);
    assert.equal(data.bofu.regs, 220);
    assert.equal(data.actualTofuToMofu, 0.25);
    assert.equal(data.actualMofuToBofu, 1200 / 25000);
    assert.equal(data.actualBofuToReg, 220 / 1200);
  });

  it("applies event or venue overrides over Leeds defaults", () => {
    const data = aggregateFunnelData(
      [event({ id: "venue", capacity: 1000 })],
      [],
      [],
      {
        tofu_to_mofu_rate: 0.2,
        mofu_to_bofu_rate: 0.4,
        bofu_to_reg_rate: 0.25,
        reg_to_sale_rate: 0.6,
        organic_lift_rate: 0.5,
        cost_per_reach: 0.01,
        cost_per_lpv: 0.2,
        cost_per_reg: 2,
        sellout_target_override: 750,
      },
      LEEDS_FA_CUP_FUNNEL_DEFAULTS,
    );

    assert.equal(data.ticketsTarget, 750);
    assert.equal(data.effectiveTofuToMofu, 0.2);
    assert.equal(data.effectiveMofuToBofu, 0.4);
    assert.equal(data.effectiveBofuToReg, 0.25);
    assert.equal(data.effectiveRegToSale, 0.6);
    assert.equal(data.effectiveOrganicLift, 0.5);
    assert.equal(data.effectiveCostPerReach, 0.01);
    assert.equal(data.effectiveCostPerLpv, 0.2);
    assert.equal(data.effectiveCostPerReg, 2);
  });
});

function event({
  id,
  capacity = null,
  tickets = null,
}: {
  id: string;
  capacity?: number | null;
  tickets?: number | null;
}): PortalEvent {
  return {
    id,
    name: id,
    slug: null,
    event_code: "WC26-BRISTOL",
    venue_name: "Bristol",
    venue_city: "Bristol",
    venue_country: "England",
    capacity,
    event_date: null,
    general_sale_at: null,
    report_cadence: "weekly",
    budget_marketing: null,
    meta_campaign_id: null,
    meta_spend_cached: null,
    prereg_spend: null,
    tickets_sold: tickets,
    api_tickets_sold: tickets,
    additional_tickets_sold: 0,
    additional_ticket_revenue: 0,
    tickets_sold_previous: null,
    latest_snapshot: null,
    history: [],
    ticketing_status: {
      linked_count: 0,
      provider: null,
      active_source: null,
      latest_ticket_snapshot_at: null,
      latest_ticket_source: null,
      preferred_provider: null,
    },
    ticket_tiers: [],
  };
}

function campaign({
  name,
  stage,
  objective = null,
  reach = 0,
  lpv = 0,
  regs = 0,
  spend = 0,
}: {
  name: string;
  stage: FunnelStage;
  objective?: string | null;
  reach?: number;
  lpv?: number;
  regs?: number;
  spend?: number;
}): MetaCampaignRow {
  return {
    id: name,
    name,
    objective,
    status: "ACTIVE",
    funnelStage: stage,
    spend,
    impressions: reach * 2,
    reach,
    clicks: lpv,
    landingPageViews: lpv,
    registrations: regs,
    purchases: 0,
    purchaseValue: 0,
    roas: 0,
    cpr: regs > 0 ? spend / regs : 0,
    cplpv: lpv > 0 ? spend / lpv : 0,
    cpp: 0,
    videoPlays3s: 0,
    videoPlays15s: 0,
    videoPlaysP100: 0,
    engagements: 0,
  };
}

function round4(value: number | null): number | null {
  return value == null ? null : Math.round(value * 10000) / 10000;
}
