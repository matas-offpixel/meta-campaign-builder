/**
 * Creative Lab weekly judge. Pure.
 *
 * Window: WINDOW_DAYS (7) complete days ending LAG_DAYS (3) before the
 * judging day. The nightly ad-daily-insights cron restates the last three
 * complete days, so after the run on day D, day D − 3 has had its last
 * restatement.
 *
 * A round ad (one clip × caption) is judged across every ad set it runs
 * in. Per ad set, in the window, spend in GBP (lib/learning/currency.ts):
 *   ads in the ad set = ads that delivered in the window ∪ the round's
 *     ads launched into it (ad_daily_insights holds only ad-days with
 *     spend, so a missing ad-day is £0 and a starved ad has no row)
 *   share      = Σ ad spend ÷ Σ ad-set spend
 *   fair share = spend-weighted mean of 1 ÷ ads in the ad set
 *
 * Result (result_metric): the ad set's optimisation event, its
 * promoted_event or optimization_goal on ad_daily_insights, counted from
 * `actions` with the first present action type (Meta reports the pixel
 * type and the plain alias with the same value; never summed). With no
 * optimisation event: registrations in the registration stage, else
 * purchases. Stage is `stageOf` from lib/learning/joins.ts, the rung chain
 * learning uses. When a round ad's ad sets optimise for different events,
 * its results and cost come from the ad sets sharing the event of the ad
 * set it spent most in.
 *
 * CPR anchor: the pooled cost per result of the ad's ad sets (same
 * metric) without the ad. Under MIN_RESULTS_FOR_CPR results there, the
 * client's stage baseline_cpr from tag_performance, only when the metric
 * is the one learning counts for that stage (complete_registration in
 * registration, purchase in ticket_sale); a cost per purchase is no
 * anchor for a cost per checkout. Neither → no CPR verdict.
 *
 * Verdicts, first that applies:
 *   untested  impressions < UNTESTED_MAX_IMPRESSIONS (1000): Meta never
 *             showed it enough to lose
 *   thin      the window is incomplete (the ad went live after the window
 *             started, or insights do not reach the window's end), or the
 *             ad sets spent < THIN_ADSET_SPEND_GBP (£20) in it
 *   loser     share < 0.5 × fair (Meta starved it), or no results with
 *             share ≥ fair
 *   winner    share ≥ fair, results ≥ MIN_RESULTS_FOR_CPR (3) and cost
 *             per result ≤ anchor
 *   flagged   share ≥ fair and cost per result > 1.5 × anchor, or share ≥
 *             fair with no CPR verdict available (Meta funded it; its
 *             cost is dear or unproven)
 *   null      between the bands: share from half to full fair share, or
 *             cost per result above the anchor but within 1.5×
 * confirmed = winner, the round ad it re-tests was a winner, and results ≥
 * CONFIRM_MIN_RESULTS (10, THIN_MIN_RESULTS in lib/learning/shrink.ts).
 */

import { firstPresentAction, LEAD_ACTION_TYPES, PURCHASE_ACTION_TYPES, REGISTRATION_ACTION_TYPES, type MetaActionRow } from "../ad-daily-insights/derive.ts";
import type { CurrencyResolver } from "../learning/currency.ts";
import { metaPhaseByAdSet, resultStageByAdSet, stageOf, type Stage, type StageEvent } from "../learning/joins.ts";
import { THIN_MIN_RESULTS } from "../learning/shrink.ts";
import type { JudgeAdDayRow } from "./load.ts";

export const UNTESTED_MAX_IMPRESSIONS = 1000;
export const MIN_RESULTS_FOR_CPR = 3;
export const CONFIRM_MIN_RESULTS = THIN_MIN_RESULTS;
export const WINDOW_DAYS = 7;
export const LAG_DAYS = 3;
export const THIN_ADSET_SPEND_GBP = 20;
export const STARVED_SHARE_OF_FAIR = 0.5;
export const DEAR_CPR_OF_ANCHOR = 1.5;

export type Verdict = "untested" | "thin" | "loser" | "winner" | "flagged";

export type ResultMetric =
  | "complete_registration"
  | "lead"
  | "purchase"
  | "initiate_checkout"
  | "add_to_cart"
  | "add_payment_info"
  | "view_content"
  | "landing_page_view"
  | "link_click";

const ACTION_TYPES: Readonly<Record<ResultMetric, readonly string[] | null>> = {
  complete_registration: REGISTRATION_ACTION_TYPES,
  lead: LEAD_ACTION_TYPES,
  purchase: PURCHASE_ACTION_TYPES,
  initiate_checkout: ["offsite_conversion.fb_pixel_initiate_checkout", "initiate_checkout"],
  add_to_cart: ["offsite_conversion.fb_pixel_add_to_cart", "add_to_cart"],
  add_payment_info: ["offsite_conversion.fb_pixel_add_payment_info", "add_payment_info"],
  view_content: ["offsite_conversion.fb_pixel_view_content", "view_content"],
  landing_page_view: null,
  link_click: null,
};

const PROMOTED_EVENT_METRIC: Readonly<Record<string, ResultMetric>> = {
  COMPLETE_REGISTRATION: "complete_registration",
  LEAD: "lead",
  PURCHASE: "purchase",
  INITIATED_CHECKOUT: "initiate_checkout",
  ADD_TO_CART: "add_to_cart",
  ADD_PAYMENT_INFO: "add_payment_info",
  CONTENT_VIEW: "view_content",
};

const GOAL_METRIC: Readonly<Record<string, ResultMetric>> = {
  LEAD_GENERATION: "lead",
  QUALITY_LEAD: "lead",
  LANDING_PAGE_VIEWS: "landing_page_view",
  LINK_CLICKS: "link_click",
};

/** The metric tag_performance counts per stage; the only one a baseline_cpr can anchor. */
const LEARNING_METRIC: Readonly<Record<Stage, ResultMetric | null>> = {
  registration: "complete_registration",
  ticket_sale: "purchase",
  unknown: null,
};

export function resultMetricFor(input: { promotedEvent: string | null; optimizationGoal: string | null; stage: Stage }): ResultMetric {
  const event = (input.promotedEvent ?? "").trim().toUpperCase();
  if (PROMOTED_EVENT_METRIC[event]) return PROMOTED_EVENT_METRIC[event];
  const goal = (input.optimizationGoal ?? "").trim().toUpperCase();
  if (GOAL_METRIC[goal]) return GOAL_METRIC[goal];
  return input.stage === "registration" ? "complete_registration" : "purchase";
}

export function resultsOf(row: Pick<JudgeAdDayRow, "actions" | "landing_page_views" | "link_clicks">, metric: ResultMetric): number {
  if (metric === "landing_page_view") return Number(row.landing_page_views) || 0;
  if (metric === "link_click") return Number(row.link_clicks) || 0;
  const actions = Array.isArray(row.actions) ? (row.actions as MetaActionRow[]) : [];
  return firstPresentAction(actions, ACTION_TYPES[metric] ?? [])?.value ?? 0;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function judgingWindow(judgedOn: string): { start: string; end: string } {
  const end = addDays(judgedOn, -LAG_DAYS);
  return { start: addDays(end, -(WINDOW_DAYS - 1)), end };
}

export type JudgeLaunch = { metaAdId: string; adSetId: string };

export type JudgeRoundAd = {
  /** creative_lab_round_ads.id, or the meta_ad_id when judging ad sets with no round rows. */
  key: string;
  label: string;
  launches: JudgeLaunch[];
  /** YYYY-MM-DD the ad went live; null → its first delivery in ad_daily_insights. */
  liveFrom: string | null;
  retestOfVerdict?: Verdict | null;
  clipId?: string | null;
  captionId?: string | null;
};

export type JudgeAdSet = { phaseAtLaunch: string | null; event: StageEvent | null; clientId: string | null };

export type JudgeInput = {
  /** YYYY-MM-DD */
  judgedOn: string;
  /** Every ad-day of the ad sets up to the window's end; earlier days date first delivery. */
  rows: readonly JudgeAdDayRow[];
  roundAds: readonly JudgeRoundAd[];
  adSets: ReadonlyMap<string, JudgeAdSet>;
  /** `${clientId}|${stage}` → tag_performance baseline_cpr (GBP). */
  baselines: ReadonlyMap<string, number>;
  currency: CurrencyResolver;
  /** Latest date ad_daily_insights holds for the accounts; null when unknown. */
  dataThrough: string | null;
};

export type AdSetSummary = {
  adSetId: string;
  stage: Stage;
  resultMetric: ResultMetric;
  ads: number;
  spendGbp: number;
  results: number;
  clientId: string | null;
};

export type AdVerdict = {
  key: string;
  label: string;
  metaAdIds: string[];
  verdict: Verdict | null;
  reason: string;
  confirmed: boolean;
  resultMetric: ResultMetric | null;
  spendShare: number;
  fairShare: number;
  impressions: number;
  spendGbp: number;
  adSetSpendGbp: number;
  results: number;
  costPerResult: number | null;
  anchorCpr: number | null;
  anchorSource: "pooled" | "baseline" | null;
  adSets: number;
  clipId: string | null;
  captionId: string | null;
};

export type JudgeResult = { windowStart: string; windowEnd: string; adSets: AdSetSummary[]; verdicts: AdVerdict[] };

type SetStats = AdSetSummary & {
  spendByAd: Map<string, number>;
  resultsByAd: Map<string, number>;
  impressionsByAd: Map<string, number>;
};

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function firstNonNull<T>(values: Iterable<T | null | undefined>): T | null {
  for (const v of values) if (v != null && v !== "") return v;
  return null;
}

export function judgeRound(input: JudgeInput): JudgeResult {
  const { start, end } = judgingWindow(input.judgedOn);
  const firstDelivery = new Map<string, string>();
  for (const r of input.rows) {
    const seen = firstDelivery.get(r.meta_ad_id);
    if (!seen || r.date < seen) firstDelivery.set(r.meta_ad_id, r.date);
  }
  const inWindow = input.rows.filter((r) => r.date >= start && r.date <= end && r.meta_adset_id);

  const adSetIds = new Set<string>();
  for (const ad of input.roundAds) for (const l of ad.launches) adSetIds.add(l.adSetId);
  const metaPhase = metaPhaseByAdSet(input.rows);
  const resultStage = resultStageByAdSet(input.rows);

  const sets = new Map<string, SetStats>();
  for (const id of adSetIds) {
    const all = input.rows.filter((r) => r.meta_adset_id === id);
    const ledger = input.adSets.get(id);
    const { stage } = stageOf(end, ledger?.event ?? null, ledger?.phaseAtLaunch ?? null, metaPhase.get(id) ?? null, null, resultStage.get(id) ?? null);
    const resultMetric = resultMetricFor({
      promotedEvent: firstNonNull(all.map((r) => r.promoted_event)),
      optimizationGoal: firstNonNull(all.map((r) => r.optimization_goal)),
      stage,
    });
    const stats: SetStats = {
      adSetId: id,
      stage,
      resultMetric,
      ads: 0,
      spendGbp: 0,
      results: 0,
      clientId: ledger?.clientId ?? ledger?.event?.clientId ?? null,
      spendByAd: new Map(),
      resultsByAd: new Map(),
      impressionsByAd: new Map(),
    };
    for (const r of inWindow) {
      if (r.meta_adset_id !== id) continue;
      const spend = (Number(r.spend) || 0) * input.currency.rate(r.ad_account_id);
      const results = resultsOf(r, resultMetric);
      stats.spendGbp += spend;
      stats.results += results;
      stats.spendByAd.set(r.meta_ad_id, (stats.spendByAd.get(r.meta_ad_id) ?? 0) + spend);
      stats.resultsByAd.set(r.meta_ad_id, (stats.resultsByAd.get(r.meta_ad_id) ?? 0) + results);
      stats.impressionsByAd.set(r.meta_ad_id, (stats.impressionsByAd.get(r.meta_ad_id) ?? 0) + (Number(r.impressions) || 0));
    }
    const ads = new Set(stats.spendByAd.keys());
    for (const ad of input.roundAds) for (const l of ad.launches) if (l.adSetId === id) ads.add(l.metaAdId);
    stats.ads = ads.size;
    sets.set(id, stats);
  }

  const verdicts = input.roundAds.map((ad) => judgeAd(ad, sets, input, start, end, firstDelivery));
  return {
    windowStart: start,
    windowEnd: end,
    adSets: [...sets.values()].map(({ adSetId, stage, resultMetric, ads, spendGbp, results, clientId }) => ({
      adSetId,
      stage,
      resultMetric,
      ads,
      spendGbp: round(spendGbp, 2),
      results,
      clientId,
    })),
    verdicts,
  };
}

function judgeAd(
  ad: JudgeRoundAd,
  sets: ReadonlyMap<string, SetStats>,
  input: JudgeInput,
  windowStart: string,
  windowEnd: string,
  firstDelivery: ReadonlyMap<string, string>,
): AdVerdict {
  type PerSet = { set: SetStats; adSpend: number; adResults: number; adImpressions: number };
  const perSet = new Map<string, PerSet>();
  for (const l of ad.launches) {
    const set = sets.get(l.adSetId);
    if (!set) continue;
    const p = perSet.get(l.adSetId) ?? { set, adSpend: 0, adResults: 0, adImpressions: 0 };
    p.adSpend += set.spendByAd.get(l.metaAdId) ?? 0;
    p.adResults += set.resultsByAd.get(l.metaAdId) ?? 0;
    p.adImpressions += set.impressionsByAd.get(l.metaAdId) ?? 0;
    perSet.set(l.adSetId, p);
  }
  const list = [...perSet.values()];
  const adSpend = list.reduce((s, p) => s + p.adSpend, 0);
  const setSpend = list.reduce((s, p) => s + p.set.spendGbp, 0);
  const impressions = list.reduce((s, p) => s + p.adImpressions, 0);
  const share = setSpend > 0 ? adSpend / setSpend : 0;
  const fair =
    setSpend > 0
      ? list.reduce((s, p) => s + p.set.spendGbp / Math.max(1, p.set.ads), 0) / setSpend
      : list.length
        ? list.reduce((s, p) => s + 1 / Math.max(1, p.set.ads), 0) / list.length
        : 0;

  const dominant = [...list].sort((a, b) => b.adSpend - a.adSpend || b.set.spendGbp - a.set.spendGbp)[0];
  const metric = dominant?.set.resultMetric ?? null;
  const same = list.filter((p) => p.set.resultMetric === metric);
  const results = same.reduce((s, p) => s + p.adResults, 0);
  const metricSpend = same.reduce((s, p) => s + p.adSpend, 0);
  const cpr = results > 0 ? metricSpend / results : null;

  const otherSpend = same.reduce((s, p) => s + (p.set.spendGbp - p.adSpend), 0);
  const otherResults = same.reduce((s, p) => s + (p.set.results - p.adResults), 0);
  let anchor: number | null = null;
  let anchorSource: AdVerdict["anchorSource"] = null;
  if (otherResults >= MIN_RESULTS_FOR_CPR && otherSpend > 0) {
    anchor = otherSpend / otherResults;
    anchorSource = "pooled";
  } else if (dominant && metric && LEARNING_METRIC[dominant.set.stage] === metric && dominant.set.clientId) {
    const baseline = input.baselines.get(`${dominant.set.clientId}|${dominant.set.stage}`);
    if (baseline != null && baseline > 0) {
      anchor = baseline;
      anchorSource = "baseline";
    }
  }

  const liveFrom =
    ad.liveFrom ??
    ad.launches
      .map((l) => firstDelivery.get(l.metaAdId))
      .filter((d): d is string => Boolean(d))
      .sort()[0] ??
    null;

  const pick = (): { verdict: Verdict | null; reason: string } => {
    if (impressions < UNTESTED_MAX_IMPRESSIONS) return { verdict: "untested", reason: `${impressions} impressions in the window` };
    if (liveFrom && liveFrom > windowStart) return { verdict: "thin", reason: `live from ${liveFrom}, after the window starts` };
    if (!input.dataThrough || input.dataThrough < windowEnd) {
      return { verdict: "thin", reason: `insights reach ${input.dataThrough ?? "no date"}, not ${windowEnd}` };
    }
    if (setSpend < THIN_ADSET_SPEND_GBP) return { verdict: "thin", reason: `ad sets spent £${setSpend.toFixed(2)} in the window` };
    if (share < STARVED_SHARE_OF_FAIR * fair) return { verdict: "loser", reason: "starved: under half its fair share" };
    if (results === 0 && share >= fair) return { verdict: "loser", reason: `funded, no ${metric}` };
    const cprVerdict = results >= MIN_RESULTS_FOR_CPR && anchor != null && cpr != null;
    if (share >= fair && cprVerdict && cpr! <= anchor!) return { verdict: "winner", reason: `cost per ${metric} at or under the ${anchorSource} anchor` };
    if (share >= fair && cprVerdict && cpr! > DEAR_CPR_OF_ANCHOR * anchor!) {
      return { verdict: "flagged", reason: `funded, cost per ${metric} over 1.5× the ${anchorSource} anchor` };
    }
    if (share >= fair && !cprVerdict) {
      return {
        verdict: "flagged",
        reason: results < MIN_RESULTS_FOR_CPR ? `funded, ${results} ${metric} (under ${MIN_RESULTS_FOR_CPR})` : "funded, no CPR anchor",
      };
    }
    if (share < fair) return { verdict: null, reason: "between half and full fair share" };
    return { verdict: null, reason: "dearer than the anchor, within 1.5×" };
  };
  const { verdict, reason } = pick();

  return {
    key: ad.key,
    label: ad.label,
    metaAdIds: ad.launches.map((l) => l.metaAdId),
    verdict,
    reason,
    confirmed: verdict === "winner" && ad.retestOfVerdict === "winner" && results >= CONFIRM_MIN_RESULTS,
    resultMetric: metric,
    spendShare: round(share, 4),
    fairShare: round(fair, 4),
    impressions,
    spendGbp: round(adSpend, 2),
    adSetSpendGbp: round(setSpend, 2),
    results,
    costPerResult: cpr == null ? null : round(cpr, 4),
    anchorCpr: anchor == null ? null : round(anchor, 4),
    anchorSource,
    adSets: list.length,
    clipId: ad.clipId ?? null,
    captionId: ad.captionId ?? null,
  };
}

export type RoundPlanInput = { clipId: string; captionId: string; verdict: Verdict | null; confirmed: boolean };

export type RoundPlan = {
  /** Clips with a winner, or not yet decided (untested, thin, between bands). */
  keepClips: string[];
  keepCaptions: string[];
  /** Winning clips: pair each with new captions. */
  newCaptionsOn: string[];
  /** Winning captions: pair each with new clips. */
  newClipsWith: string[];
  /** Winners not yet confirmed: run once more as controls. */
  retest: { clipId: string; captionId: string }[];
  /** Every decided ad lost or was flagged, and none won. */
  dropClips: string[];
  dropCaptions: string[];
};

const UNDECIDED = new Set<Verdict | null>(["untested", "thin", null]);

/** Winning clip + new captions, winning caption + new clips (roadmap M3). */
export function nextRoundPlan(ads: readonly RoundPlanInput[]): RoundPlan {
  const plan = (key: "clipId" | "captionId") => {
    const keep: string[] = [];
    const drop: string[] = [];
    const winners: string[] = [];
    for (const id of [...new Set(ads.map((a) => a[key]))]) {
      const mine = ads.filter((a) => a[key] === id);
      const won = mine.some((a) => a.verdict === "winner");
      if (won) winners.push(id);
      if (won || mine.some((a) => UNDECIDED.has(a.verdict))) keep.push(id);
      else drop.push(id);
    }
    return { keep, drop, winners };
  };
  const clips = plan("clipId");
  const captions = plan("captionId");
  return {
    keepClips: clips.keep,
    keepCaptions: captions.keep,
    newCaptionsOn: clips.winners,
    newClipsWith: captions.winners,
    retest: ads.filter((a) => a.verdict === "winner" && !a.confirmed).map(({ clipId, captionId }) => ({ clipId, captionId })),
    dropClips: clips.drop,
    dropCaptions: captions.drop,
  };
}
