/**
 * E2b / RP3: a show's phase curve (kind phase_curve).
 *
 * Per show with phase data, the cost per stage result in each rollout phase
 * (phase.ts), over all of the show's main campaigns: TF5's campaign set
 * (`isBenchmarkCampaign`: not the test campaigns, Purchase or Retargeting). Each
 * ad-day counts towards its own ad set's stage (stage-result.ts): signup ad
 * sets give cost per signup, sales ad sets cost per checkout (or purchase). Each
 * phase's row carries its ratio to the teaser phase on the same stage.
 *
 * A show with no announcement_at gets one row, verdict "no_phase_data": never a
 * phase guessed from ad names. A phase with no delivery day (presale when
 * presale and general sale open on the same day) has no row. Pure.
 */

import { isBenchmarkCampaign } from "../../creative-tests/benchmark.ts";
import { THIN_MIN_RESULTS, capByShows, type Confidence } from "../shrink.ts";
import { PHASES, PHASE_SOURCE, hasPhaseData, phaseOf, type Phase, type PhaseEvent } from "./phase.ts";
import { stageResult, stageResultKind, type FindingStage, type StageDay, type StageResultKind } from "./stage-result.ts";
import { campaignEventCode } from "./variant-pairs.ts";

export type CurveDay = StageDay & { campaign_name: string | null; meta_ad_id: string };

export type PhasePoint = {
  phase: Exclude<Phase, "unknown">;
  stage: Exclude<FindingStage, "unknown">;
  result: StageResultKind;
  firstDay: string;
  lastDay: string;
  days: number;
  spend: number;
  results: number;
  cost: number | null;
  /** cost ÷ the teaser phase's cost on the same stage; null when either has none. */
  ratioToTeaser: number | null;
  confidence: Confidence;
};

export type PhaseCurve =
  | { eventCode: string; state: "curve"; source: typeof PHASE_SOURCE; boundaries: PhaseEvent; points: PhasePoint[] }
  | { eventCode: string; state: "no_phase_data"; source: typeof PHASE_SOURCE; boundaries: PhaseEvent; points: [] };

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round = (n: number, places = 4) => Math.round(n * 10 ** places) / 10 ** places;

/** The curve from the show's ad-days (to the day before the read). Rows of other shows' campaigns are ignored. */
export function phaseCurve(input: { eventCode: string; event: PhaseEvent; days: readonly CurveDay[] }): PhaseCurve {
  const { eventCode, event } = input;
  const boundaries = { announcement_at: event.announcement_at, presale_at: event.presale_at, general_sale_at: event.general_sale_at };
  if (!hasPhaseData(event)) return { eventCode, state: "no_phase_data", source: PHASE_SOURCE, boundaries, points: [] };

  const cells = new Map<string, { phase: Exclude<Phase, "unknown">; stage: Exclude<FindingStage, "unknown">; result: StageResultKind; days: Set<string>; spend: number; results: number }>();
  for (const d of input.days) {
    if (campaignEventCode(d.campaign_name) !== eventCode || !isBenchmarkCampaign(d.campaign_name, eventCode)) continue;
    const { stage, result } = stageResultKind(d);
    if (stage === "unknown" || !result) continue;
    const phase = phaseOf(event, d.date);
    if (phase === "unknown") continue;
    // A sales ad set optimising for checkouts and one for purchases are different results: they don't share a cell.
    const key = `${phase}|${stage}|${result}`;
    const cell = cells.get(key) ?? { phase, stage, result, days: new Set<string>(), spend: 0, results: 0 };
    cell.spend += num(d.spend);
    cell.results += stageResult(d, result);
    if (num(d.spend) > 0) cell.days.add(d.date);
    cells.set(key, cell);
  }
  const points: PhasePoint[] = [...cells.values()]
    .filter((c) => c.days.size > 0)
    .map((c) => {
      const spend = Math.round(c.spend * 100) / 100;
      const sorted = [...c.days].sort();
      return {
        phase: c.phase,
        stage: c.stage,
        result: c.result,
        firstDay: sorted[0]!,
        lastDay: sorted[sorted.length - 1]!,
        days: sorted.length,
        spend,
        results: c.results,
        cost: c.results > 0 ? round(spend / c.results) : null,
        ratioToTeaser: null,
        confidence: capByShows(c.results >= THIN_MIN_RESULTS ? "ok" : "thin", 1),
      };
    })
    .sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) || a.stage.localeCompare(b.stage) || a.result.localeCompare(b.result));
  for (const p of points) {
    const teaser = points.find((t) => t.phase === "teaser" && t.stage === p.stage && t.result === p.result);
    p.ratioToTeaser = teaser && teaser.cost != null && p.cost != null && teaser.cost > 0 ? round(p.cost / teaser.cost) : null;
  }
  return { eventCode, state: "curve", source: PHASE_SOURCE, boundaries, points };
}

export type CurveFindingRow = {
  kind: "phase_curve";
  scope: "event";
  scope_id: string;
  event_id: string | null;
  client_id: string | null;
  stage: string | null;
  week_start: null;
  subject: string;
  metric: string | null;
  value_a: number | null;
  value_b: number | null;
  ratio: number | null;
  n_shows: number;
  n_pairs: null;
  spend_gbp: number | null;
  results: number | null;
  confidence: Confidence | null;
  verdict: string;
  read_day: null;
  source: null;
  evidence: Record<string, unknown>;
  recommendation: null;
  computed_at: string;
};

/**
 * The rows of a curve: one per phase × stage × result (subject "{phase}" or
 * "{phase}|{result}" when a stage has more than one result), value_a the
 * phase's cost, value_b the teaser's, ratio a ÷ b; or the one no_phase_data
 * row. week_start is null: a curve spans the show, and each night replaces it.
 */
export function curveRows(curve: PhaseCurve, ctx: { eventId: string | null; clientId: string | null; gbpRate: number; currency: string | null; computedAt: string }): CurveFindingRow[] {
  const base = { kind: "phase_curve" as const, scope: "event" as const, scope_id: curve.eventCode, event_id: ctx.eventId, client_id: ctx.clientId, week_start: null, n_shows: 1, n_pairs: null, read_day: null, source: null, recommendation: null, computed_at: ctx.computedAt };
  if (curve.state === "no_phase_data") {
    return [{ ...base, stage: null, subject: "no_phase_data", metric: null, value_a: null, value_b: null, ratio: null, spend_gbp: null, results: null, confidence: null, verdict: "no_phase_data", evidence: { source: curve.source, boundaries: curve.boundaries } }];
  }
  const perStage = new Map<string, number>();
  for (const p of curve.points) perStage.set(`${p.phase}|${p.stage}`, (perStage.get(`${p.phase}|${p.stage}`) ?? 0) + 1);
  return curve.points.map((p) => {
    const teaser = curve.points.find((t) => t.phase === "teaser" && t.stage === p.stage && t.result === p.result);
    return {
      ...base,
      stage: p.stage,
      subject: (perStage.get(`${p.phase}|${p.stage}`) ?? 0) > 1 || p.result === "purchase" ? `${p.phase}|${p.result}` : p.phase,
      metric: `cost_per_${p.result}`,
      value_a: p.cost,
      value_b: teaser?.cost ?? null,
      ratio: p.ratioToTeaser,
      spend_gbp: Math.round(p.spend * ctx.gbpRate * 100) / 100,
      results: p.results,
      confidence: p.confidence,
      verdict: p.phase,
      evidence: { source: curve.source, boundaries: curve.boundaries, currency: ctx.currency, ...p },
    };
  });
}
