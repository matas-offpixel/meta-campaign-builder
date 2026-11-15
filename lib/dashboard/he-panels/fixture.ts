/**
 * Electric Brixton, read 15 Nov 2026. D.O.D (NX26-DOD) is the show.
 * No active client has a presale log or a marketing budget entry, so the
 * entered lines are empty and Electric has no brand campaign. The numbers
 * are loadPresaleLog and readObjectiveBudget for that day (today 15 Nov,
 * so the period ends 14 Nov). Nothing here is from the design drawing.
 */

import { buildPresaleLog, type PresaleLog, type PresaleLogRow } from "../presale/model.ts";
import type { BudgetPicture, Channel, Figure, MetaClassification, Objective, ObjectiveBudgetResult, ObjectiveRow, ResultMetric } from "../objective-budget/types.ts";
import { budgetPanel, type BudgetPanelModel } from "./budget-view.ts";
import { FRAME_NOW_MS, periodText } from "./dates.ts";
import { pounds, presalePanel, type PresalePanelModel } from "./presale-view.ts";

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
    totalMarketing: fig(opts.paid, "paid − credits + sub-budgets + D2C; excludes WhatsApp"),
    totalMarketingCreditsNotSubtracted: fig(opts.paid, "paid + sub-budgets + D2C, credits not subtracted; excludes WhatsApp"),
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
 * Ironworks Season 1, held here from the submitted report (read 13 Nov,
 * figures to 4 Nov). Not a live read, and not written to prod.
 * 83,421.09 + 1,297.27 + 8,681.15 = 93,399.51.
 * 83,000 − 83,421.09 + 460 = 38.91.
 * The two afterparties are not split in the report, so they stay one line.
 */
export function ironworksBudget(nowMs = FRAME_NOW_MS): BudgetPanelModel {
  return {
    title: "Objective and budget",
    scope: "Ironworks Season 1",
    period: periodText(null, "2026-11-04", nowMs),
    rows: [],
    lines: [
      { label: "Plan", value: pounds(83000), note: "Season budget · entered by Matas, 13 Nov" },
      { label: "Paid", value: pounds(83421.09), note: null },
      { label: "Brand campaigns", value: pounds(22651.1), note: null },
      { label: "Credits", value: pounds(460), note: "Google promo credit. Changes the variance, not the total." },
      { label: "Sub-budgets", value: pounds(1297.27), note: "Two afterparties, what ran." },
      { label: "D2C", value: pounds(8681.15), note: "WhatsApp + SMS" },
      { label: "Total", value: pounds(93399.51), note: "Paid + sub-budgets + D2C." },
      { label: "Variance", value: pounds(38.91), note: null },
    ],
    totalNote: null,
  };
}
