import { classifyCampaignFunnelStage, type FunnelStage } from "./funnel-stage-classifier.ts";
import type { PortalEvent } from "@/lib/db/client-portal-server";
import { resolveDisplayTicketCount } from "./tier-channel-rollups.ts";
import type { MetaCampaignRow } from "@/lib/insights/types";
import type { VenueDailyAdMetricsRow } from "@/lib/insights/meta";

export interface FunnelStageMetrics {
  stage: FunnelStage;
  campaigns: string[];
  reach: number;
  lpv: number;
  regs: number;
  spend: number;
  costPerReach: number | null;
  costPerLpv: number | null;
  costPerReg: number | null;
}

export interface EventFunnelOverride {
  tofu_to_mofu_rate?: number | null;
  mofu_to_bofu_rate?: number | null;
  bofu_to_reg_rate?: number | null;
  reg_to_sale_rate?: number | null;
  organic_lift_rate?: number | null;
  cost_per_reach?: number | null;
  cost_per_lpv?: number | null;
  cost_per_reg?: number | null;
  sellout_target_override?: number | null;
}

export interface FunnelDefaults {
  tofuToMofuRate: number | null;
  mofuToBofuRate: number | null;
  bofuToRegRate: number;
  regToSaleRate: number;
  organicLiftRate: number;
  costPerReach: number | null;
  costPerLpv: number | null;
  costPerReg: number;
}

export interface FunnelData {
  tofu: FunnelStageMetrics;
  mofu: FunnelStageMetrics;
  bofu: FunnelStageMetrics;
  totalSpend: number;
  ticketsSold: number;
  ticketsTarget: number;
  actualTofuToMofu: number | null;
  actualMofuToBofu: number | null;
  actualBofuToReg: number | null;
  effectiveTofuToMofu: number | null;
  effectiveMofuToBofu: number | null;
  effectiveBofuToReg: number;
  effectiveRegToSale: number;
  effectiveOrganicLift: number;
  effectiveCostPerReach: number | null;
  effectiveCostPerLpv: number | null;
  effectiveCostPerReg: number;
}

export const LEEDS_FA_CUP_FUNNEL_DEFAULTS: FunnelDefaults = {
  tofuToMofuRate: null,
  mofuToBofuRate: null,
  bofuToRegRate: 0.1827,
  regToSaleRate: 0.51,
  organicLiftRate: 0.57,
  costPerReach: null,
  costPerLpv: null,
  costPerReg: 1,
};

export function aggregateFunnelData(
  events: PortalEvent[],
  campaigns: MetaCampaignRow[],
  insights: VenueDailyAdMetricsRow[],
  override: EventFunnelOverride | null,
  defaults: FunnelDefaults,
): FunnelData {
  void insights;
  const stages = {
    TOFU: emptyStage("TOFU"),
    MOFU: emptyStage("MOFU"),
    BOFU: emptyStage("BOFU"),
  } satisfies Record<FunnelStage, MutableStageMetrics>;

  for (const campaign of campaigns) {
    const stage =
      campaign.funnelStage ?? classifyCampaignFunnelStage(campaign);
    const bucket = stages[stage];
    bucket.campaigns.push(campaign.name);
    bucket.reach += campaign.reach;
    bucket.lpv += campaign.landingPageViews;
    bucket.regs += campaign.registrations;
    bucket.spend += campaign.spend;
  }

  const tofu = finalizeStage(stages.TOFU);
  const mofu = finalizeStage(stages.MOFU);
  const bofu = finalizeStage(stages.BOFU);
  const totalSpend = tofu.spend + mofu.spend + bofu.spend;

  return {
    tofu,
    mofu,
    bofu,
    totalSpend,
    ticketsSold: sumTicketsSold(events),
    ticketsTarget:
      override?.sellout_target_override ?? sumCapacity(events) ?? 0,
    actualTofuToMofu: safeRate(mofu.reach, tofu.reach),
    actualMofuToBofu: safeRate(bofu.lpv, mofu.reach),
    actualBofuToReg: safeRate(bofu.regs, bofu.lpv),
    effectiveTofuToMofu:
      override?.tofu_to_mofu_rate ?? defaults.tofuToMofuRate,
    effectiveMofuToBofu:
      override?.mofu_to_bofu_rate ?? defaults.mofuToBofuRate,
    effectiveBofuToReg:
      override?.bofu_to_reg_rate ?? defaults.bofuToRegRate,
    effectiveRegToSale:
      override?.reg_to_sale_rate ?? defaults.regToSaleRate,
    effectiveOrganicLift:
      override?.organic_lift_rate ?? defaults.organicLiftRate,
    effectiveCostPerReach:
      override?.cost_per_reach ?? defaults.costPerReach,
    effectiveCostPerLpv:
      override?.cost_per_lpv ?? defaults.costPerLpv,
    effectiveCostPerReg:
      override?.cost_per_reg ?? defaults.costPerReg,
  };
}

interface MutableStageMetrics {
  stage: FunnelStage;
  campaigns: string[];
  reach: number;
  lpv: number;
  regs: number;
  spend: number;
}

function emptyStage(stage: FunnelStage): MutableStageMetrics {
  return {
    stage,
    campaigns: [],
    reach: 0,
    lpv: 0,
    regs: 0,
    spend: 0,
  };
}

function finalizeStage(stage: MutableStageMetrics): FunnelStageMetrics {
  return {
    ...stage,
    costPerReach: safeRate(stage.spend, stage.reach),
    costPerLpv: safeRate(stage.spend, stage.lpv),
    costPerReg: safeRate(stage.spend, stage.regs),
  };
}

function safeRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function sumTicketsSold(events: PortalEvent[]): number {
  return events.reduce(
    (total, event) =>
      total +
      (event.ticket_tiers.length > 0
        ? resolveDisplayTicketCount({
            ticket_tiers: event.ticket_tiers,
            latest_snapshot_tickets: event.latest_snapshot?.tickets_sold ?? null,
            fallback_tickets: event.tickets_sold ?? null,
            tier_channel_sales_sum: event.tier_channel_sales_tickets ?? null,
          })
        : event.latest_snapshot?.tickets_sold ?? event.tickets_sold ?? 0),
    0,
  );
}

function sumCapacity(events: PortalEvent[]): number | null {
  let total = 0;
  let any = false;
  for (const event of events) {
    if (event.capacity == null) continue;
    total += event.capacity;
    any = true;
  }
  return any ? total : null;
}
