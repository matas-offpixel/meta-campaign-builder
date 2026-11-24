/**
 * E2 / RP2: observed variant pairs (kind variant_pair).
 *
 * Two ads in the same ad set whose names are equal once one axis's tokens are
 * taken out (variant-axes.ts) are siblings. They're compared like with like:
 *
 *   - only on the days both delivered (spend > 0 on the day), needing at least 3;
 *   - only when phaseOf() is the same on every one of those days — the landing
 *     page changes with the phase (teaser → dated → on sale), and the dated
 *     creatives launch with it, so a dated vs undated pair across a boundary
 *     measures the page, not the creative (Matas, 23 Nov). Pairs read phases
 *     with phaseOf's next-London-day rule; an overlap day with no phase data
 *     (before the show's first known boundary) can't show that, so it isn't
 *     compared;
 *   - each arm at least £10 on those days.
 *
 * Fail any → not a pair, with its reason (the dry run prints it; nothing is
 * written). Cost per stage result on the overlap days, the stage and result of
 * the ad set (stage-result.ts). An arm with no results has no cost: its spend
 * is a lower bound on it ("cost so far ≥ £x"), and the pair is thin.
 *
 * Ads with the same name once normalised (a " – Copy" of the same creative) are
 * one arm. Ad sets in show test campaigns are left out: their call is RP1's
 * test_verdict (one ad set, one verdict).
 *
 * lib/creative-tests/pair.ts makes track pairs and has no comparison rule of its
 * own: an app-made pair is a creative_tests "pair" test, called by TF2 + TF5
 * like any test (BENCHMARK_KINDS). The overlap, phase and £10 rules here are
 * the brief's. Pure.
 */

import { THIN_MIN_RESULTS, capByShows, type Confidence } from "../shrink.ts";
import { eventCodeOf, weekStart, type ObservedAdDay } from "./observed-tests.ts";
import { phaseOf, type Phase, type PhaseEvent } from "./phase.ts";
import { stageResult, stageResultKind, type FindingStage, type StageResultKind } from "./stage-result.ts";
import { AXIS_SIDES, normaliseName, siblingAxis, type Axis } from "./variant-axes.ts";

export const PAIRS = {
  /** Overlapping delivery days a pair needs. */
  minOverlapDays: 3,
  /** Each arm's spend on the overlap days, GBP. */
  minArmSpendGbp: 10,
} as const;

export type PairAdDay = ObservedAdDay & { purchases?: number | string | null };

export type PairArm = {
  label: string;
  key: string;
  side: string;
  adIds: string[];
  /** On the overlap days, account currency. */
  spend: number;
  results: number;
  /** Spend ÷ results; null with no results. */
  cost: number | null;
};

export type ComparedPair = {
  eventCode: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  adAccountId: string | null;
  axis: Axis;
  axisSource: "name";
  phase: Exclude<Phase, "unknown">;
  stage: FindingStage;
  result: StageResultKind;
  overlapDays: string[];
  a: PairArm;
  b: PairArm;
  /** cost a ÷ cost b; with one arm at no results, the bound its spend gives. */
  ratio: number | null;
  ratioBound: "exact" | "at_least" | "at_most" | null;
  confidence: Confidence;
  /** "{side}_cheaper", "equal", "not_yet" (a bound that doesn't decide) or "no_results". */
  verdict: string;
};

export type NotCompared = {
  eventCode: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  axis: Axis;
  a: string;
  b: string;
  reason: string;
  overlapDays: string[];
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const money = (n: number) => `£${n.toFixed(2)}`;
const round = (n: number, places = 4) => Math.round(n * 10 ** places) / 10 ** places;

/** The event code of a main campaign: the first [CODE] in its name, exactly as written. */
export function campaignEventCode(name: string | null | undefined): string | null {
  const m = /\[([A-Za-z0-9][A-Za-z0-9-]*)\]/.exec(name ?? "");
  return m ? m[1]! : null;
}

type Arm = { label: string; key: string; adIds: Set<string>; days: Map<string, { spend: number; rows: PairAdDay[] }> };

function armsOf(days: readonly PairAdDay[]): Arm[] {
  const arms = new Map<string, Arm>();
  for (const d of days) {
    const key = normaliseName(d.ad_name);
    if (!key) continue;
    let arm = arms.get(key);
    if (!arm) {
      arm = { label: clean(d.ad_name), key, adIds: new Set(), days: new Map() };
      arms.set(key, arm);
    }
    arm.adIds.add(d.meta_ad_id);
    const day = arm.days.get(d.date) ?? { spend: 0, rows: [] };
    day.spend += num(d.spend);
    day.rows.push(d);
    arm.days.set(d.date, day);
  }
  return [...arms.values()].sort((x, y) => x.key.localeCompare(y.key));
}

export type PairsInput = {
  /** Every ad-day of the ad sets to read, to the day before the read. */
  days: readonly PairAdDay[];
  /** Event code → its phase dates. */
  events: ReadonlyMap<string, PhaseEvent>;
  /** GBP per unit of an ad account's currency. */
  gbpRate?: (adAccountId: string | null) => number;
};

export function findPairs(input: PairsInput): { pairs: ComparedPair[]; notCompared: NotCompared[] } {
  const rate = input.gbpRate ?? (() => 1);
  const byAdSet = new Map<string, PairAdDay[]>();
  for (const d of input.days) {
    if (!d.meta_adset_id || !d.meta_ad_id || eventCodeOf(d.campaign_name)) continue;
    const list = byAdSet.get(d.meta_adset_id) ?? [];
    list.push(d);
    byAdSet.set(d.meta_adset_id, list);
  }
  const pairs: ComparedPair[] = [];
  const notCompared: NotCompared[] = [];
  for (const [adsetId, days] of [...byAdSet].sort(([x], [y]) => x.localeCompare(y))) {
    const sample = days.find((d) => d.promoted_event || d.optimization_goal || d.campaign_objective) ?? days[0]!;
    const campaignName = clean(sample.campaign_name);
    const eventCode = campaignEventCode(sample.campaign_name);
    const adsetName = clean(days.find((d) => d.adset_name)?.adset_name);
    const arms = armsOf(days);
    for (let i = 0; i < arms.length; i += 1) {
      for (let j = i + 1; j < arms.length; j += 1) {
        const sib = siblingAxis(arms[i]!.label, arms[j]!.label);
        if (!sib) continue;
        // Arm order follows the axis (a = with date, no text, cta, static, [AB-A]).
        const [x, y, sideX, sideY] = sib.sideA === AXIS_SIDES[sib.axis][0] ? [arms[i]!, arms[j]!, sib.sideA, sib.sideB] : [arms[j]!, arms[i]!, sib.sideB, sib.sideA];
        const overlapDays = [...x.days.keys()].filter((day) => x.days.get(day)!.spend > 0 && (y.days.get(day)?.spend ?? 0) > 0).sort();
        const base = { eventCode: eventCode ?? "", campaignName, adsetId, adsetName, axis: sib.axis, a: x.label, b: y.label, overlapDays };
        const skip = (reason: string) => notCompared.push({ ...base, reason });
        if (overlapDays.length < PAIRS.minOverlapDays) {
          skip(`${overlapDays.length} overlapping delivery day${overlapDays.length === 1 ? "" : "s"} (needs ${PAIRS.minOverlapDays})`);
          continue;
        }
        const event = eventCode ? input.events.get(eventCode) : undefined;
        if (!event) {
          skip(eventCode ? `no event ${eventCode}` : "no event code in the campaign name");
          continue;
        }
        const phases = [...new Set(overlapDays.map((day) => phaseOf(event, day)))];
        if (phases.includes("unknown")) {
          skip("no phase data on the overlap days (before the show's first known boundary)");
          continue;
        }
        if (phases.length > 1) {
          skip(`phase changed on the overlap days (${phases.join(" → ")})`);
          continue;
        }
        const { stage, result } = stageResultKind(sample);
        if (!result) {
          skip("no stage result for this ad set");
          continue;
        }
        const gbp = rate(sample.ad_account_id);
        const arm = (a: Arm, side: string): PairArm => {
          const rows = overlapDays.flatMap((day) => a.days.get(day)?.rows ?? []);
          const spend = Math.round(rows.reduce((s, r) => s + num(r.spend), 0) * 100) / 100;
          const results = rows.reduce((s, r) => s + stageResult(r, result), 0);
          return { label: a.label, key: a.key, side, adIds: [...a.adIds].sort(), spend, results, cost: results > 0 ? spend / results : null };
        };
        const a = arm(x, sideX);
        const b = arm(y, sideY);
        const low = [a, b].filter((r) => r.spend * gbp < PAIRS.minArmSpendGbp);
        if (low.length) {
          skip(`under £${PAIRS.minArmSpendGbp} on the overlap days (${low.map((r) => `${r.label} ${money(r.spend * gbp)}`).join(", ")})`);
          continue;
        }
        pairs.push({ eventCode: eventCode!, campaignName, adsetId, adsetName, adAccountId: sample.ad_account_id, axis: sib.axis, axisSource: "name", phase: phases[0] as Exclude<Phase, "unknown">, stage, result, overlapDays, a, b, ...compare(a, b) });
      }
    }
  }
  return { pairs, notCompared };
}

/** The ratio a ÷ b and what it says, with a spend-only bound for an arm with no results. */
export function compare(a: Pick<PairArm, "side" | "spend" | "results" | "cost">, b: Pick<PairArm, "side" | "spend" | "results" | "cost">): Pick<ComparedPair, "ratio" | "ratioBound" | "confidence" | "verdict"> {
  const enough = a.results >= THIN_MIN_RESULTS && b.results >= THIN_MIN_RESULTS;
  // One show, one pair: never above ok (GK7).
  const confidence: Confidence = capByShows(enough ? "ok" : "thin", 1);
  if (a.cost != null && b.cost != null) {
    const ratio = round(a.cost / b.cost);
    return { ratio, ratioBound: "exact", confidence, verdict: ratio < 1 ? `${a.side}_cheaper` : ratio > 1 ? `${b.side}_cheaper` : "equal" };
  }
  if (a.cost == null && b.cost != null) {
    // a's cost is at least its spend; if that's already dearer than b, b is cheaper.
    const ratio = round(a.spend / b.cost);
    return { ratio, ratioBound: "at_least", confidence: "thin", verdict: ratio > 1 ? `${b.side}_cheaper` : "not_yet" };
  }
  if (a.cost != null && b.cost == null) {
    const ratio = round(a.cost / b.spend);
    return { ratio, ratioBound: "at_most", confidence: "thin", verdict: ratio < 1 ? `${a.side}_cheaper` : "not_yet" };
  }
  return { ratio: null, ratioBound: null, confidence: "thin", verdict: "no_results" };
}

export type PairFindingRow = {
  kind: "variant_pair";
  scope: "event";
  scope_id: string;
  event_id: string | null;
  client_id: string | null;
  stage: string;
  week_start: string;
  subject: string;
  metric: string;
  value_a: number | null;
  value_b: number | null;
  ratio: number | null;
  n_shows: number;
  n_pairs: number;
  spend_gbp: number;
  results: number;
  confidence: Confidence;
  verdict: string;
  read_day: null;
  source: null;
  evidence: Record<string, unknown>;
  recommendation: null;
  computed_at: string;
};

/** One row per pair: ad set × axis × the two arms' names, so a later night's read replaces it. */
export function pairRow(p: ComparedPair, ctx: { eventId: string | null; clientId: string | null; gbpRate: number; currency: string | null; computedAt: string }): PairFindingRow {
  const value = (arm: PairArm) => (arm.cost != null ? round(arm.cost) : null);
  return {
    kind: "variant_pair",
    scope: "event",
    scope_id: p.eventCode,
    event_id: ctx.eventId,
    client_id: ctx.clientId,
    stage: p.stage,
    week_start: weekStart(p.overlapDays[0]!),
    subject: `${p.adsetId}|${p.axis}|${p.a.key}|${p.b.key}`,
    metric: `cost_per_${p.result}`,
    value_a: value(p.a),
    value_b: value(p.b),
    ratio: p.ratio,
    n_shows: 1,
    n_pairs: 1,
    spend_gbp: Math.round((p.a.spend + p.b.spend) * ctx.gbpRate * 100) / 100,
    results: p.a.results + p.b.results,
    confidence: p.confidence,
    verdict: p.verdict,
    read_day: null,
    source: null,
    evidence: {
      axis: p.axis,
      axis_source: p.axisSource,
      phase: p.phase,
      result: p.result,
      ratioBound: p.ratioBound,
      overlapDays: p.overlapDays,
      campaignName: p.campaignName,
      adsetId: p.adsetId,
      adsetName: p.adsetName,
      adAccountId: p.adAccountId,
      currency: ctx.currency,
      a: p.a,
      b: p.b,
    },
    recommendation: null,
    computed_at: ctx.computedAt,
  };
}
