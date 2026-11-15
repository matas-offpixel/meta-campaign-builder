/**
 * Electric Brixton, read 15 Nov 2026. D.O.D (NX26-DOD) is the show.
 * No active client has a presale log or a marketing budget entry, so the
 * entered lines are empty and Electric has no brand campaign. The numbers
 * are loadPresaleLog and readObjectiveBudget for that day (today 15 Nov,
 * so the period ends 14 Nov). Nothing here is from the design drawing.
 */

import { buildPresaleLog, type PresaleLog, type PresaleLogRow } from "../presale/model.ts";
import { computeObjectiveBudget } from "../objective-budget/compute.ts";
import type { BudgetEntry, BudgetPicture, Channel, Figure, MetaAdDay, MetaClassification, Objective, ObjectiveBudgetInput, ObjectiveBudgetResult, ObjectiveRow, ResultMetric } from "../objective-budget/types.ts";
import type { StoredStatsRow } from "../../d2c/stats-ingest/summary.ts";
import { budgetPanel, type BudgetPanelModel } from "./budget-view.ts";
import { FRAME_NOW_MS } from "./dates.ts";
import { presalePanel, type PresalePanelModel } from "./presale-view.ts";

const EVENT = "f0b5636b-ea5d-442e-8a71-36fd930a2b2b";
const missing = { kind: "missing" as const, reason: "not_entered" as const };

export const DOD_PRESALE: PresaleLog = {
  eventId: EVENT,
  presaleOpenAt: "2026-09-09T11:00:00+00:00",
  presaleDay: "2026-09-09",
  signupsAtPresaleLabel: "Signups at presale · to Tue 8 Sep",
  state: "empty",
  prompt: "Add the window figures",
  windowStart: { kind: "value", value: "2026-09-09T10:30:00.000Z", source: "derived", from: "Presale open − 30 min", entered: null },
  signupsAtPresale: { kind: "value", value: 1810, source: "counted", from: "CIRQLIN", entered: null, detail: { fromDay: "2026-08-18", throughDay: "2026-09-08" } },
  communityAtPresale: missing,
  soldInWindow: missing,
  presaleDayTickets: { kind: "missing", reason: "no_count_within_24h" },
  averageTicketPrice: missing,
  registrationSpend: { kind: "value", value: 1349.82, source: "counted", from: "Meta signup spend", entered: null },
  communityConversion: { kind: "missing", reason: "needs_inputs" },
  widerConversion: { kind: "missing", reason: "needs_inputs" },
  signupSpendPerPresaleTicket: { kind: "missing", reason: "needs_inputs" },
  presaleRevenue: { kind: "missing", reason: "needs_inputs" },
  presaleReturn: { kind: "missing", reason: "needs_inputs" },
  relaunches: [],
};

function fig(value: number | null, source = ""): Figure {
  return { value, source };
}

function row(label: string, objective: Objective | null, channel: Channel, spend: number, result: number | null, metric: ResultMetric | null, cost: number | null, costLabel: string | null): ObjectiveRow {
  const empty = fig(null);
  return {
    objective,
    label,
    channel,
    spend: fig(spend),
    shareOfSpend: empty,
    impressions: empty,
    reach: empty,
    clicks: empty,
    landingPageViews: empty,
    resultMetric: metric,
    result: fig(result),
    costPerResult: fig(cost),
    costLabel,
    roas: objective === "purchase" ? fig(null, "— until purchase value is stored") : null,
  };
}

const NONE: MetaClassification = {
  byGoal: { adDays: 0, spend: 0 },
  goalMissing: { adDays: 0, spend: 0, byObjective: { registration: 0, purchase: 0, traffic: 0, awareness_engagement: 0, none: 0 } },
  unmapped: { adDays: 0, spend: 0, what: [] },
};

function picture(opts: {
  plan: number;
  paid: number;
  meta: number;
  tiktok: number;
  google: number;
  variance: number;
  brand: number;
  shows: number;
}): BudgetPicture {
  const empty = fig(0);
  return {
    plan: fig(opts.plan, "events.budget_marketing (one per venue code) + additional_spend_entries"),
    planParts: { budgetMarketing: fig(opts.plan), additionalSpend: empty, seasonBudget: fig(null) },
    paid: fig(opts.paid),
    paidByChannel: { meta: fig(opts.meta), tiktok: fig(opts.tiktok), google: fig(opts.google) },
    credits: fig(0, "Credits: none entered"),
    subBudgets: fig(0, "Sub-budgets: none entered"),
    subBudgetLines: [],
    d2c: fig(null, "excludes WhatsApp (the Bird rate isn't set); no SMS cost entered"),
    d2cParts: { whatsapp: fig(null, "WhatsApp cost: the client's Bird per-message rate isn't set"), sms: fig(0, "SMS cost: none entered") },
    variance: fig(opts.variance, "plan − paid + credits"),
    totalMarketing: fig(opts.paid, "paid + sub-budgets + D2C; excludes WhatsApp"),
    paidBrand: fig(opts.brand, opts.brand > 0 ? "D12 on brand campaigns" : "no brand campaign in the scope"),
    paidShows: fig(opts.shows),
    totalExcludes: ["WhatsApp"],
  };
}

function budget(scope: ObjectiveBudgetResult["scope"], rows: ObjectiveRow[], pictureOpts: Parameters<typeof picture>[0], paid: ObjectiveBudgetResult["paidInPeriod"]): ObjectiveBudgetResult {
  return {
    scope,
    period: { from: null, to: "2026-11-14" },
    rows,
    paidInPeriod: paid,
    brand: { eventIds: [], paidInPeriod: { meta: 0, tiktok: 0, google: 0, all: 0 } },
    metaClassification: NONE,
    budget: picture(pictureOpts),
  };
}

export const DOD_BUDGET: ObjectiveBudgetResult = budget(
  { kind: "show", eventIds: [EVENT], label: "D.O.D" },
  [
    row("Registration", "registration", "meta", 1349.819999999997, 939, "registrations", 1.4375079872204442, "£ / signup"),
    row("Purchase", "purchase", "meta", 683.1699999999972, 9, "purchases", 75.90777777777747, "£ / purchase"),
  ],
  { plan: 3000, paid: 2032.99, meta: 2032.99, tiktok: 0, google: 0, variance: 967.01, brand: 0, shows: 2032.99 },
  { meta: 2032.99, tiktok: 0, google: 0, all: 2032.99 },
);

export const ELECTRIC_BUDGET: ObjectiveBudgetResult = budget(
  { kind: "client", eventIds: [EVENT], label: "Electric Brixton · all shows and brand campaigns" },
  [
    row("Registration", "registration", "meta", 22148.70000000003, 10717, "registrations", 2.0666884389288076, "£ / signup"),
    row("Purchase", "purchase", "meta", 12308.70000000045, 205, "purchases", 60.042439024392436, "£ / purchase"),
    row("Traffic", "traffic", "meta", 5225.97000000014, 47163, "landing_page_views", 0.11080656446791214, "£ / landing page view"),
    row("Traffic", "traffic", "google", 79.96999999999998, 755, "clicks", 0.10592052980132448, "£ / click"),
    row("Awareness & engagement", "awareness_engagement", "meta", 1110.489999999999, null, "reach", null, null),
    row("Objective not stored", null, "meta", 2016.779999999997, null, null, null, null),
    row("Objective not stored", null, "tiktok", 540.65, null, null, null, null),
  ],
  { plan: 34000, paid: 43431.26, meta: 42810.64, tiktok: 540.65, google: 79.97, variance: -9431.26, brand: 0, shows: 43431.26 },
  { meta: 42810.64, tiktok: 540.65, google: 79.97, all: 43431.26 },
);

export function dodPresale(surface: "internal" | "share"): PresalePanelModel {
  return presalePanel(DOD_PRESALE, { show: "D.O.D", surface, nowMs: FRAME_NOW_MS });
}

/**
 * Charlotte de Witte (IRW0006). presale_at on prod is 5 Aug 2026, 12:00
 * Europe/London. The other figures are the season report's, held here,
 * not written to prod. The entered lines use 13 Nov, the day the report
 * was read. Signup spend is the report's registration spend (£5,771.82),
 * which the per-ticket figure is derived from.
 */
const CDW = "f8603e89-0b0e-4b43-9984-0f3f3a0e906d";
const MATAS = "matas";
const ENTERED_AT = "2026-11-13T12:00:00Z";

function cdwLog(): PresaleLog {
  const log: PresaleLogRow = {
    window_start_at: null,
    window_start_entered_by: null,
    window_start_entered_at: null,
    sold_in_window: 4000,
    sold_in_window_entered_by: MATAS,
    sold_in_window_entered_at: ENTERED_AT,
    avg_ticket_price: null,
    avg_ticket_price_entered_by: null,
    avg_ticket_price_entered_at: null,
    presale_day_tickets: 6600,
    presale_day_tickets_entered_by: MATAS,
    presale_day_tickets_entered_at: ENTERED_AT,
  };
  return buildPresaleLog({
    eventId: CDW,
    presaleAt: "2026-08-05T11:00:00+00:00",
    timeZone: "Europe/London",
    log,
    relaunches: [],
    memberCounts: [{ counted_on: "2026-08-05", members: 7100, entered_by: MATAS, entered_at: ENTERED_AT }],
    signupDays: null,
    internalCounts: [],
    registrationSpend: 5771.82,
    mailchimp: {
      tag: "Charlotte De Witte - October 2026",
      day: "2026-08-04",
      subscribers: 12868,
      readAt: null,
      endOfDay: true,
      estimated: false,
      rowSource: "mailchimp_eod_cron",
    },
    names: new Map([[MATAS, "Matas"]]),
  });
}

export function cdwPresale(surface: "internal" | "share", nowMs = FRAME_NOW_MS): PresalePanelModel {
  return presalePanel(cdwLog(), { show: "Charlotte de Witte", surface, nowMs });
}

export function dodBudget(nowMs = FRAME_NOW_MS): BudgetPanelModel {
  return budgetPanel(DOD_BUDGET, nowMs);
}

export function electricBudget(nowMs = FRAME_NOW_MS): BudgetPanelModel {
  return budgetPanel(ELECTRIC_BUDGET, nowMs);
}

/**
 * Ironworks Season 1, to 4 Nov 2026. The spend is the builder's own D12
 * read that day, collapsed onto one day per event (16,272 ad-days are not
 * copied in). Brand is £22,553.07: the £22,651.10 in the brief was before
 * the 25–26 May IRWOHD TikTok re-sync. The season entries are the report's
 * and are not written to prod. WhatsApp is the report's 161,788 delivered;
 * SMS is £535; the Bird rate makes the two £8,681.15.
 */
const IRW = "f7ed8aef-8527-4c3e-a16a-a05fc38861f5";
const IRW_SHOWS = "irw-shows";
const IRW_BRAND = "68535c85-0394-435f-9439-245dd2e87043";
const IRW_DAY = "2026-09-01";
const IRW_TO = "2026-11-04";
const WHATSAPP_DELIVERED = 161788;
const SMS_COST = 535;
const WHATSAPP_COST = 8146.15;

function irwAd(p: Pick<MetaAdDay, "campaignId" | "campaignName" | "adSetId" | "spend" | "optimizationGoal" | "promotedEvent"> & { registrations?: number; purchases?: number; landingPageViews?: number }): MetaAdDay {
  return {
    campaignId: p.campaignId,
    campaignName: p.campaignName,
    adSetId: p.adSetId,
    day: IRW_DAY,
    spend: p.spend,
    impressions: 0,
    reach: 0,
    linkClicks: 0,
    landingPageViews: p.landingPageViews ?? 0,
    registrations: p.registrations ?? 0,
    leads: 0,
    purchases: p.purchases ?? 0,
    campaignObjective: "OUTCOME_SALES",
    optimizationGoal: p.optimizationGoal,
    promotedEvent: p.promotedEvent,
  };
}

function ironworksInput(): ObjectiveBudgetInput {
  const shows: MetaAdDay[] = [
    irwAd({ campaignId: "irw-s-reg", campaignName: "Shows registration", adSetId: "irw-s-reg", spend: 22896.27, optimizationGoal: "OFFSITE_CONVERSIONS", promotedEvent: "COMPLETE_REGISTRATION", registrations: 22704 }),
    irwAd({ campaignId: "irw-s-pur", campaignName: "Shows purchase", adSetId: "irw-s-pur", spend: 14124.34, optimizationGoal: "OFFSITE_CONVERSIONS", promotedEvent: "PURCHASE", purchases: 553 }),
    irwAd({ campaignId: "irw-s-traf", campaignName: "Shows traffic", adSetId: "irw-s-traf", spend: 10740.39, optimizationGoal: "LANDING_PAGE_VIEWS", promotedEvent: null, landingPageViews: 58241 }),
    irwAd({ campaignId: "irw-s-aw", campaignName: "Shows awareness", adSetId: "irw-s-aw", spend: 3333.16, optimizationGoal: "REACH", promotedEvent: null }),
  ];
  const brand: MetaAdDay[] = [
    irwAd({ campaignId: "irw-b-reg", campaignName: "Brand registration", adSetId: "irw-b-reg", spend: 4458.46, optimizationGoal: "OFFSITE_CONVERSIONS", promotedEvent: "COMPLETE_REGISTRATION", registrations: 1610 }),
    irwAd({ campaignId: "irw-b-pur", campaignName: "Brand purchase", adSetId: "irw-b-pur", spend: 1992.26, optimizationGoal: "OFFSITE_CONVERSIONS", promotedEvent: "PURCHASE", purchases: 48 }),
    irwAd({ campaignId: "irw-b-traf", campaignName: "Brand traffic", adSetId: "irw-b-traf", spend: 572.02, optimizationGoal: "LANDING_PAGE_VIEWS", promotedEvent: null, landingPageViews: 1103 }),
    irwAd({ campaignId: "irw-b-aw", campaignName: "Brand awareness", adSetId: "irw-b-aw", spend: 883.48, optimizationGoal: "REACH", promotedEvent: null }),
  ];
  const entries: BudgetEntry[] = [
    { id: "irw-season", eventId: null, kind: "season_budget", label: "Season 1", amount: 83000, spent: null, day: "2026-05-25" },
    { id: "irw-credit", eventId: null, kind: "credit", label: "Google promo credit", amount: 460, spent: null, day: "2026-10-01" },
    { id: "irw-a1", eventId: IRW_SHOWS, kind: "sub_budget", label: "Afters one", amount: 1500, spent: 1181.76, day: null },
    { id: "irw-a2", eventId: IRW_SHOWS, kind: "sub_budget", label: "Afters two", amount: 750, spent: 115.51, day: null },
    { id: "irw-sms", eventId: null, kind: "sms_cost", label: "SMS", amount: SMS_COST, spent: null, day: IRW_TO },
  ];
  const whatsapp: StoredStatsRow = {
    id: "irw-wa",
    provider: "bird",
    account_id: "bird",
    external_id: "irw-wa",
    channel: "whatsapp",
    client_id: IRW,
    event_id: IRW_SHOWS,
    attribution: "show",
    audience_kind: "marketing",
    name: "Ironworks WhatsApp",
    sent_at: "2026-09-15T10:00:00Z",
    sent: 27,
    delivered: WHATSAPP_DELIVERED,
    read: null,
    clicked: null,
    opens_unique_raw: null,
    opens_unique_filtered: null,
    open_rate_filtered: null,
    fetched_at: null,
  };
  return {
    client: { id: IRW, name: "IRONWORKS" },
    events: [
      { eventId: IRW_SHOWS, code: "IRWSHOWS", name: "Ironworks shows", showDate: "2026-11-01", kind: "event", linkedCampaignIds: shows.map((a) => a.campaignId), budgetMarketing: null },
      { eventId: IRW_BRAND, code: "IRWOHD", name: "Brand Awareness (Always-On)", showDate: null, kind: "brand_campaign", linkedCampaignIds: brand.map((a) => a.campaignId), budgetMarketing: null },
    ],
    metaAdDays: [...shows, ...brand],
    googleDays: [{ eventCode: "IRWSHOWS", campaignId: "irw-g", channelType: "SEARCH", day: IRW_DAY, spend: 1260.98, impressions: 21808, clicks: 3917, conversions: 0, conversionValue: 0 }],
    rollups: [
      { eventId: IRW_SHOWS, day: IRW_DAY, meta: 57378.3, tiktok: 2228.74, google: 1260.98, metaSynced: true, tiktokSynced: true, googleSynced: true },
      { eventId: IRW_BRAND, day: IRW_DAY, meta: 18910.3, tiktok: 3642.77, google: null, metaSynced: true, tiktokSynced: true, googleSynced: false },
    ],
    overrides: { meta: {}, google: {} },
    additionalSpend: [],
    entries,
    d2c: { rate: { rate: WHATSAPP_COST / WHATSAPP_DELIVERED, currency: "GBP" }, rows: [whatsapp] },
  };
}

export function ironworksBudget(nowMs = FRAME_NOW_MS): BudgetPanelModel {
  return budgetPanel(computeObjectiveBudget(ironworksInput(), { kind: "client" }, { from: null, to: IRW_TO }), nowMs);
}
