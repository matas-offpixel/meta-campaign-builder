/**
 * E4: a show's week (kind show_week), pure.
 *
 * This week (the last complete Monday–Sunday London week before the read) vs
 * the week before: spend, stage results and cost per stage result, the best
 * and worst 3 ads (each ≥ £12 that week) and the biggest mover.
 *
 * Every cost is TF5's: `showBenchmark` (lib/creative-tests/benchmark.ts) over
 * the week, so the digest and RP1's test calls never disagree. That means the
 * show's main campaigns only (no Tests, Purchase or Retargeting) and
 * `resultsOf`'s result. The result is the stage most of the week's main spend
 * ran on (stage-result.ts): signups for registration, Initiate Checkout for
 * ticket sale. show-week-burst was read first: it is a refresh cadence for
 * shows in their last 7 days and computes no week figures, so there is
 * nothing in it to reuse.
 *
 * The biggest mover is the ad whose cost per result changed most (ratio,
 * either way) between the two weeks, among ads ≥ £12 with results in both.
 * None qualifying: null.
 */

import { resultsOf } from "../../creative-tests/approve.ts";
import { isBenchmarkCampaign, showBenchmark, type ShowBenchmark } from "../../creative-tests/benchmark.ts";
import type { ResultEvent } from "../../creative-tests/words.ts";
import { addDays } from "./observed-tests.ts";
import { stageResultKind, type StageDay } from "./stage-result.ts";

export const SHOW_WEEK = {
  /** An ad's spend that week before it can be a best or worst ad, GBP. */
  minAdSpendGbp: 12,
  top: 3,
} as const;

export type WeekDay = StageDay & { meta_ad_id: string; campaign_name: string | null; ad_name?: string | null };

export type WeekAd = { adId: string; name: string; spend: number; results: number; cost: number | null };

export type ShowWeek = {
  eventCode: string;
  weekStart: string;
  weekEnd: string;
  lastWeekStart: string;
  result: ResultEvent;
  stage: "registration" | "ticket_sale";
  thisWeek: ShowBenchmark;
  lastWeek: ShowBenchmark;
  /** this week's cost ÷ last week's; null without both. */
  ratio: number | null;
  best: WeekAd[];
  worst: WeekAd[];
  mover: (WeekAd & { lastCost: number; ratio: number }) | null;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round = (n: number, places = 4) => Math.round(n * 10 ** places) / 10 ** places;

/** The last complete Monday–Sunday week before a London day: 23 Nov (a Monday) → 16–22 Nov; 26 Nov → 16–22 Nov too. */
export function lastCompleteWeek(readOn: string): { weekStart: string; weekEnd: string; lastWeekStart: string } {
  const dow = new Date(`${readOn}T12:00:00Z`).getUTCDay();
  const thisMonday = addDays(readOn, -((dow + 6) % 7));
  const weekStart = addDays(thisMonday, -7);
  return { weekStart, weekEnd: addDays(weekStart, 6), lastWeekStart: addDays(weekStart, -7) };
}

export function showWeek(input: { eventCode: string; days: readonly WeekDay[]; readOn: string; gbpRate?: number }): ShowWeek | null {
  const { eventCode } = input;
  const { weekStart, weekEnd, lastWeekStart } = lastCompleteWeek(input.readOn);
  const lastWeekEnd = addDays(weekStart, -1);
  const gbp = input.gbpRate ?? 1;
  const main = input.days.filter((d) => isBenchmarkCampaign(d.campaign_name, eventCode));
  const week = main.filter((d) => d.date >= weekStart && d.date <= weekEnd);
  const weekSpend = week.reduce((s, d) => s + num(d.spend), 0);
  if (weekSpend <= 0) return null;

  // The stage most of the week's main spend ran on.
  let reg = 0;
  let sale = 0;
  for (const d of week) {
    const { stage } = stageResultKind(d);
    if (stage === "registration") reg += num(d.spend);
    else if (stage === "ticket_sale") sale += num(d.spend);
  }
  const stage = reg > sale ? "registration" : "ticket_sale";
  const result: ResultEvent = stage === "registration" ? "complete_registration" : "initiate_checkout";
  const thisWeek = showBenchmark(main as never, { eventCode, result, fromDay: weekStart, toDay: weekEnd });
  const lastWeek = showBenchmark(main as never, { eventCode, result, fromDay: lastWeekStart, toDay: lastWeekEnd });

  const adsIn = (from: string, to: string): Map<string, WeekAd> => {
    const out = new Map<string, WeekAd>();
    for (const d of main) {
      if (d.date < from || d.date > to) continue;
      const ad = out.get(d.meta_ad_id) ?? { adId: d.meta_ad_id, name: (d.ad_name ?? "").replace(/\s+/g, " ").trim() || d.meta_ad_id, spend: 0, results: 0, cost: null };
      ad.spend += num(d.spend);
      ad.results += resultsOf(d, result);
      out.set(d.meta_ad_id, ad);
    }
    for (const ad of out.values()) {
      ad.spend = Math.round(ad.spend * 100) / 100;
      ad.cost = ad.results > 0 ? round(ad.spend / ad.results) : null;
    }
    return out;
  };
  const now = adsIn(weekStart, weekEnd);
  const before = adsIn(lastWeekStart, lastWeekEnd);
  const funded = [...now.values()].filter((a) => a.spend * gbp >= SHOW_WEEK.minAdSpendGbp);
  const priced = funded.filter((a) => a.cost != null).sort((a, b) => a.cost! - b.cost! || b.spend - a.spend);
  const best = priced.slice(0, SHOW_WEEK.top);
  // Worst: no results first (by spend), then the dearest.
  const worst = [...funded.filter((a) => a.cost == null).sort((a, b) => b.spend - a.spend), ...[...priced].reverse()].filter((a) => !best.includes(a)).slice(0, SHOW_WEEK.top);
  let mover: ShowWeek["mover"] = null;
  for (const ad of priced) {
    const last = before.get(ad.adId);
    if (!last || last.cost == null || last.spend * gbp < SHOW_WEEK.minAdSpendGbp) continue;
    const ratio = ad.cost! / last.cost;
    if (!mover || Math.abs(Math.log(ratio)) > Math.abs(Math.log(mover.ratio))) mover = { ...ad, lastCost: last.cost, ratio: round(ratio) };
  }
  return {
    eventCode,
    weekStart,
    weekEnd,
    lastWeekStart,
    result,
    stage,
    thisWeek,
    lastWeek,
    ratio: thisWeek.cost != null && lastWeek.cost != null && lastWeek.cost > 0 ? round(thisWeek.cost / lastWeek.cost) : null,
    best,
    worst,
    mover,
  };
}

export type ShowWeekRow = {
  kind: "show_week";
  scope: "event";
  scope_id: string;
  event_id: string | null;
  client_id: string | null;
  stage: string;
  week_start: string;
  subject: "week";
  metric: string;
  value_a: number | null;
  value_b: number | null;
  ratio: number | null;
  n_shows: 1;
  n_pairs: null;
  spend_gbp: number;
  results: number;
  confidence: null;
  verdict: string;
  read_day: null;
  source: null;
  evidence: Record<string, unknown>;
  recommendation: null;
  computed_at: string;
};

/** One row per show per week: value_a this week's cost, value_b last week's, ratio a ÷ b. */
export function showWeekRow(w: ShowWeek, ctx: { eventId: string | null; clientId: string | null; gbpRate: number; currency: string | null; computedAt: string }): ShowWeekRow {
  return {
    kind: "show_week",
    scope: "event",
    scope_id: w.eventCode,
    event_id: ctx.eventId,
    client_id: ctx.clientId,
    stage: w.stage,
    week_start: w.weekStart,
    subject: "week",
    metric: `cost_per_${w.result}`,
    value_a: w.thisWeek.cost,
    value_b: w.lastWeek.cost,
    ratio: w.ratio,
    n_shows: 1,
    n_pairs: null,
    spend_gbp: Math.round(w.thisWeek.spend * ctx.gbpRate * 100) / 100,
    results: w.thisWeek.results,
    confidence: null,
    verdict: w.ratio == null ? "no_comparison" : w.ratio < 1 ? "cheaper" : w.ratio > 1 ? "dearer" : "same",
    read_day: null,
    source: null,
    evidence: { currency: ctx.currency, result: w.result, weekEnd: w.weekEnd, lastWeekStart: w.lastWeekStart, thisWeek: w.thisWeek, lastWeek: w.lastWeek, best: w.best, worst: w.worst, mover: w.mover },
    recommendation: null,
    computed_at: ctx.computedAt,
  };
}
