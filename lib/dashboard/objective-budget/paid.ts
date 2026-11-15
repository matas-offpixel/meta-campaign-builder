/**
 * lib/dashboard/objective-budget/paid.ts
 *
 * D12 paid spend for HE6, through the sales calc itself: the input is
 * reshaped into a `SalesCalcInput` and run through `buildSeries`, so the
 * per show, per day, per platform figure is the dashboard's own (the
 * larger of the rollup column and the platform's own mapped campaigns).
 * `lib/dashboard/sales-calc/**` is read, never edited.
 *
 * One difference from the sales calc's loader: brand campaigns
 * (events.kind = 'brand_campaign') are scope events here even with no
 * date, because a client's budget covers them. The loader drops events
 * with no event_date, so the sales dashboard's client total leaves them
 * out. An undated brand campaign sorts after every show (it never wins a
 * shared [CODE] from a show).
 *
 * Relative imports only (node --test).
 */

import { buildSeries, mapCampaigns } from "../sales-calc/figures.ts";
import { addDays } from "../sales-calc/days.ts";
import type { MetaCampaignDay, SalesCalcInput, ShowInput } from "../sales-calc/types.ts";
import type { Channel, ObjectiveBudgetInput } from "./types.ts";

/** Sorts an undated brand campaign after every show. */
export const UNDATED = "9999-12-31";

export function showInputs(input: Pick<ObjectiveBudgetInput, "events">): ShowInput[] {
  return input.events.map((e) => ({
    eventId: e.eventId,
    code: e.code,
    name: e.name,
    showDate: e.showDate ?? UNDATED,
    presaleDate: null,
    capacity: null,
    allocation: null,
    allocationFromTiers: false,
    isUmbrella: false,
    cirqlinPageId: null,
    linkedCampaignIds: e.linkedCampaignIds,
    referenceEventIds: [],
    counts: [],
    finalCount: null,
  }));
}

/** ad_daily_insights ad-days summed to campaign × day, as the sales calc's loader does. */
export function metaCampaignDays(input: Pick<ObjectiveBudgetInput, "metaAdDays">): MetaCampaignDay[] {
  const out = new Map<string, MetaCampaignDay>();
  for (const r of input.metaAdDays) {
    const key = `${r.campaignId}|${r.day}`;
    let c = out.get(key);
    if (!c) {
      out.set(key, (c = { campaignId: r.campaignId, campaignName: r.campaignName, day: r.day, spend: 0, linkClicks: 0, landingPageViews: 0, initiateCheckouts: 0, addsToCart: 0 }));
    }
    if (r.campaignName > c.campaignName) c.campaignName = r.campaignName;
    c.spend += r.spend;
    c.linkClicks += r.linkClicks;
    c.landingPageViews += r.landingPageViews;
  }
  return [...out.values()];
}

/** The sales calc's input for HE6. `to` is the last day read (inclusive). */
export function salesCalcInput(input: ObjectiveBudgetInput, to: string): SalesCalcInput {
  return {
    client: input.client,
    today: addDays(to, 1),
    shows: showInputs(input),
    metaCampaignDays: metaCampaignDays(input),
    googleCampaignDays: input.googleDays.map((g) => ({ eventCode: g.eventCode, day: g.day, spend: g.spend, campaignId: g.campaignId })),
    rollups: input.rollups,
    signups: [],
    library: [],
    overrides: { meta: input.overrides.meta, google: input.overrides.google },
  };
}

/** D12 per show, per day, per channel, to `to`. */
export interface PaidDays {
  /** eventId → day → channel → £. */
  byShowDay: Map<string, Map<string, Record<Channel, number>>>;
  /** Meta campaign → owner (the D1 rule: override, link, [CODE]). */
  metaOwner: Map<string, { eventId: string; linked: boolean; name: string }>;
  calc: SalesCalcInput;
}

export function paidDays(input: ObjectiveBudgetInput, to: string): PaidDays {
  const calc = salesCalcInput(input, to);
  const series = buildSeries(calc);
  const byShowDay = new Map<string, Map<string, Record<Channel, number>>>();
  for (const [eventId, s] of series) {
    const days = new Map<string, Record<Channel, number>>();
    for (const [day, f] of s.days) days.set(day, { ...f.byPlatform });
    byShowDay.set(eventId, days);
  }
  return { byShowDay, metaOwner: mapCampaigns(calc), calc };
}

export function inPeriod(day: string, from: string | null, to: string): boolean {
  return (from == null || day >= from) && day <= to;
}

/** D12 paid spend for the scope over [from, to], per channel. */
export function paidTotals(paid: PaidDays, eventIds: ReadonlySet<string>, from: string | null, to: string): Record<Channel | "all", number> {
  const out = { meta: 0, tiktok: 0, google: 0, all: 0 };
  for (const [eventId, days] of paid.byShowDay) {
    if (!eventIds.has(eventId)) continue;
    for (const [day, f] of days) {
      if (!inPeriod(day, from, to)) continue;
      out.meta += f.meta;
      out.tiktok += f.tiktok;
      out.google += f.google;
    }
  }
  out.all = out.meta + out.tiktok + out.google;
  return out;
}
