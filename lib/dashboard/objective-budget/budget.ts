/**
 * lib/dashboard/objective-budget/budget.ts
 *
 * E6's budget picture, to a day. Pure.
 *
 *   Plan     a client season budget (marketing_budget_entries,
 *            kind 'season_budget', migration 250) when the scope is the
 *            client and one is entered; otherwise the existing computed
 *            total: events.budget_marketing, one per venue code
 *            (`aggregateSharedVenueBudget`, the client dashboard's rule),
 *            plus additional_spend_entries. events.total_marketing_budget
 *            was dropped in 051; event_ad_plans has no budget_paid_media
 *            column (051's comment names one that was never added).
 *   Paid     D12, all channels, since launch to the day.
 *   Credits  entered (kind 'credit'), such as a Google promo credit.
 *   Sub-budgets  entered (kind 'sub_budget'), such as afterparties: what
 *            ran under each when entered, else its allocation.
 *   D2C      E5's costs: WhatsApp from HE3's read (delivered × the
 *            client's Bird rate; null when the rate isn't set) plus SMS
 *            (entered, kind 'sms_cost'). Email has no cost.
 *
 *   Variance is plan − paid + credits.
 *   The total marketing cost is paid + sub-budgets + D2C.
 *
 * Relative imports only (node --test).
 */

import { aggregateSharedVenueBudget, type AggregatableEvent } from "../../db/client-dashboard-aggregations.ts";
import { summariseD2CStats } from "../../d2c/stats-ingest/summary.ts";
import { londonDay } from "../sales-calc/days.ts";
import type { BudgetEntry, BudgetPicture, Channel, Figure, ObjectiveBudgetInput, SubBudgetLine } from "./types.ts";

const fig = (value: number | null, source: string): Figure => ({ value, source });
const round2 = (n: number) => Math.round(n * 100) / 100;

function onOrBefore(day: string | null, to: string): boolean {
  return day == null || day <= to;
}

function entriesFor(input: ObjectiveBudgetInput, kind: BudgetEntry["kind"], scope: "show" | "client", eventIds: ReadonlySet<string>, to: string): BudgetEntry[] {
  return (input.entries ?? []).filter(
    (e) => e.kind === kind && onOrBefore(e.day, to) && (scope === "client" ? e.eventId == null || eventIds.has(e.eventId) : e.eventId != null && eventIds.has(e.eventId)),
  );
}

function labels(entries: readonly BudgetEntry[]): string {
  const named = entries.map((e) => e.label.trim()).filter(Boolean);
  return named.length ? `: ${named.join(", ")}` : "";
}

export function budgetPicture(
  input: ObjectiveBudgetInput,
  scope: "show" | "client",
  eventIds: ReadonlySet<string>,
  to: string,
  paid: Record<Channel | "all", number>,
): BudgetPicture {
  const migrationMissing = input.entries == null;
  const entered = (what: string) => (migrationMissing ? `${what}: migration 250 isn't applied, so none can be entered yet` : `${what}: none entered`);

  // Plan.
  const events = input.events.filter((e) => eventIds.has(e.eventId));
  const budgetMarketing = aggregateSharedVenueBudget(
    events.map(
      (e): AggregatableEvent => ({
        id: e.eventId,
        event_code: e.code,
        event_date: e.showDate,
        capacity: null,
        prereg_spend: null,
        tickets_sold: null,
        budget_marketing: e.budgetMarketing,
        latest_snapshot: null,
      }),
    ),
  );
  const additional = input.additionalSpend.filter(
    (a) => eventIds.has(a.eventId) && a.day <= to && (scope === "client" || a.scope === "event"),
  );
  const additionalTotal = additional.reduce((s, a) => s + a.amount, 0);
  const seasons = scope === "client" ? entriesFor(input, "season_budget", scope, eventIds, to) : [];
  const seasonTotal = seasons.reduce((s, e) => s + e.amount, 0);
  const budgetMarketingFig = fig(budgetMarketing, "events.budget_marketing, one per venue code (the client dashboard's shared-venue rule)");
  const additionalFig = fig(additional.length ? round2(additionalTotal) : 0, additional.length ? "additional_spend_entries.amount" : "additional_spend_entries: none");
  const seasonFig = seasons.length
    ? fig(round2(seasonTotal), `marketing_budget_entries season budget, entered${labels(seasons)}`)
    : fig(null, scope === "client" ? entered("Season budget") : "a season budget is client-level");
  const plan: Figure = seasons.length
    ? fig(round2(seasonTotal), `Season budget, entered${labels(seasons)}`)
    : budgetMarketing != null || additional.length
      ? fig(round2((budgetMarketing ?? 0) + additionalTotal), "events.budget_marketing (one per venue code) + additional_spend_entries")
      : fig(null, "no budget_marketing set, no season budget entered");

  // Paid (D12).
  const paidFig = fig(round2(paid.all), "D12: per show, per day, per platform, the larger of the rollup column and the platform's own mapped campaigns, since launch");
  const paidByChannel: Record<Channel, Figure> = {
    meta: fig(round2(paid.meta), "D12 Meta"),
    tiktok: fig(round2(paid.tiktok), "D12 TikTok (event_daily_rollups.tiktok_spend)"),
    google: fig(round2(paid.google), "D12 Google"),
  };

  // Credits.
  const credits = entriesFor(input, "credit", scope, eventIds, to);
  const creditTotal = round2(credits.reduce((s, e) => s + e.amount, 0));
  const creditsFig = credits.length ? fig(creditTotal, `marketing_budget_entries credit, entered${labels(credits)}`) : fig(0, entered("Credits"));

  // Sub-budgets.
  const subs = entriesFor(input, "sub_budget", scope, eventIds, to);
  const subBudgetLines: SubBudgetLine[] = subs.map((e) => ({ label: e.label, allocation: e.amount, spent: e.spent }));
  const subTotal = round2(subs.reduce((s, e) => s + (e.spent ?? e.amount), 0));
  const unspent = subs.filter((e) => e.spent == null).map((e) => e.label || "unnamed");
  const subsFig = subs.length
    ? fig(
        subTotal,
        unspent.length
          ? `marketing_budget_entries sub-budget, what ran under each; allocation where spend isn't entered (${unspent.join(", ")})`
          : "marketing_budget_entries sub-budget, what ran under each, entered",
      )
    : fig(0, entered("Sub-budgets"));

  // D2C.
  const d2cRows = input.d2c.rows.filter(
    (r) => (scope === "client" || (r.event_id != null && eventIds.has(r.event_id))) && (r.sent_at == null || londonDay(r.sent_at) <= to),
  );
  const summary = summariseD2CStats(d2cRows, input.d2c.rate, input.d2c.rows);
  const wa = summary.channels.find((c) => c.group === "whatsapp");
  const rateSet = input.d2c.rate.rate != null;
  const whatsapp: Figure = !rateSet
    ? fig(null, "WhatsApp cost: the client's Bird per-message rate isn't set")
    : fig(round2(wa?.cost ?? 0), wa ? "d2c_broadcast_stats delivered × clients.whatsapp_message_rate (HE3)" : "no WhatsApp sends stored");
  const sms = entriesFor(input, "sms_cost", scope, eventIds, to);
  const smsFig = sms.length ? fig(round2(sms.reduce((s, e) => s + e.amount, 0)), `marketing_budget_entries SMS cost, entered${labels(sms)}`) : fig(0, entered("SMS cost"));
  const d2cValue = whatsapp.value == null && !sms.length ? null : round2((whatsapp.value ?? 0) + (smsFig.value ?? 0));
  const d2cFig = fig(
    d2cValue,
    whatsapp.value == null
      ? sms.length
        ? "SMS, entered; excludes WhatsApp (the Bird rate isn't set)"
        : "excludes WhatsApp (the Bird rate isn't set); no SMS cost entered"
      : "WhatsApp (HE3) + SMS (entered)",
  );

  const totalExcludes = whatsapp.value == null ? ["WhatsApp"] : [];
  const variance = plan.value == null ? fig(null, "no plan") : fig(round2(plan.value - paid.all + creditTotal), "plan − paid + credits");
  const total = fig(
    round2(paid.all + subTotal + (d2cValue ?? 0)),
    totalExcludes.length ? `paid + sub-budgets + D2C; excludes ${totalExcludes.join(", ")}` : "paid + sub-budgets + D2C",
  );

  return {
    plan,
    planParts: { budgetMarketing: budgetMarketingFig, additionalSpend: additionalFig, seasonBudget: seasonFig },
    paid: paidFig,
    paidByChannel,
    credits: creditsFig,
    subBudgets: subsFig,
    subBudgetLines,
    d2c: d2cFig,
    d2cParts: { whatsapp, sms: smsFig },
    variance,
    totalMarketing: total,
    totalExcludes,
  };
}
