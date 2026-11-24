/**
 * E3 / RP4: the cross-show rollup (kind axis_rollup), pure.
 *
 * Pools the per-show findings at three scopes, client → vertical → all,
 * archived clients left out (the loader drops their rows):
 *
 *   pair|{axis}|{voice}       variant pairs by axis × stage × voice. Only pairs
 *                             with a cost on both arms enter the ratio (a
 *                             spend-only bound decides nothing); bounds are
 *                             counted in the evidence. Ratio = exp of the
 *                             results-weighted mean log ratio (arm a ÷ arm b,
 *                             AXIS_SIDES' order), shrunk with shrink.ts
 *                             (SHRINK_K, n = pairs) toward the next scope up
 *                             (`choosePool`), all → 1.
 *   phase|teaser>{phase}      phase curves by transition × stage: each show's
 *                             ratio to its own teaser. value_a is the median
 *                             across shows (the brief's "× 3.4 median · 4
 *                             shows"); the shrunk weighted mean is in the
 *                             evidence. Shows with no teaser have no ratio and
 *                             don't count.
 *   tests|{kind}              observed test verdicts by test kind ("AB copy
 *                             test", "Artist cards test", or the Tests ad set's
 *                             name before " · "): winners of tests.
 *
 * Voice is the page the ads ran from, as copy_features reads it
 * (lib/learning/copy/normalise.ts voiceOf: a page on the client's promoter
 * list is the promoter, any other page the artist; no page → unknown). The
 * loader passes ad id → voice. Confidence: confidenceOf(n, spend £, results),
 * then capByShows — never strong under 3 shows. No threshold is loosened: with
 * one pair in prod today, every pair rollup is thin.
 */

import { capByShows, choosePool, confidenceOf, shrinkIndex, type Confidence } from "../shrink.ts";
import { AXIS_SIDES, type Axis } from "./variant-axes.ts";

export type FindingRowLike = {
  kind: string;
  scope: string;
  scope_id: string | null;
  client_id: string | null;
  stage: string | null;
  subject: string | null;
  verdict: string | null;
  ratio: number | string | null;
  results: number | string | null;
  spend_gbp: number | string | null;
  confidence: string | null;
  evidence: unknown;
};

export type RollupScope = "client" | "vertical" | "all";

export type RollupRow = {
  kind: "axis_rollup";
  scope: RollupScope;
  scope_id: string | null;
  event_id: null;
  client_id: string | null;
  stage: string | null;
  week_start: null;
  subject: string;
  metric: string;
  value_a: number | null;
  value_b: number | null;
  ratio: number | null;
  n_shows: number;
  n_pairs: number | null;
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

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round = (n: number | null, places = 4): number | null => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** places) / 10 ** places);
const ev = (row: FindingRowLike) => (row.evidence ?? {}) as Record<string, unknown>;

type Member = { show: string; clientId: string | null; ratio: number | null; weight: number; spend: number; results: number; subject: string; bound: boolean };

type Group = { key: string; scope: RollupScope; scopeId: string | null; family: "pair" | "phase" | "tests"; subject: string; stage: string | null; members: Member[]; extra?: Record<string, unknown> };

function scopesOf(clientId: string | null, verticalOf: ReadonlyMap<string, string | null>): { scope: RollupScope; scopeId: string | null }[] {
  const out: { scope: RollupScope; scopeId: string | null }[] = [{ scope: "all", scopeId: null }];
  if (clientId) {
    out.push({ scope: "client", scopeId: clientId });
    const vertical = verticalOf.get(clientId);
    if (vertical) out.push({ scope: "vertical", scopeId: vertical });
  }
  return out;
}

/** The test kind an observed test belongs to: its round campaign's suffix, or its Tests ad set's name before " · ". */
export function testKindOf(row: FindingRowLike): string {
  const e = ev(row);
  const campaign = String(e.campaignName ?? "");
  const suffix = campaign.split(" · ").slice(1).join(" · ");
  if (suffix && suffix !== "Tests") return suffix;
  const adset = String(e.adsetName ?? "").split(" · ")[0]?.trim();
  return adset || "Tests";
}

/** Verdicts that are a call made (a winner or no call), as against a read still running. */
export const CALLED_VERDICTS: readonly string[] = ["ready_to_call", "day8_no_call", "ended_no_call", "day4_no_call", "no_clear_winner", "not_enough_variants", "one_variant", "no_result_event"];

export function axisRollup(input: {
  rows: readonly FindingRowLike[];
  /** client id → vertical. */
  verticalOf: ReadonlyMap<string, string | null>;
  /** Meta ad id → voice. */
  voiceOf: ReadonlyMap<string, string>;
  computedAt: string;
}): RollupRow[] {
  const groups = new Map<string, Group>();
  const add = (scope: RollupScope, scopeId: string | null, family: Group["family"], subject: string, stage: string | null, member: Member, extra?: Record<string, unknown>) => {
    const key = [scope, scopeId ?? "", family, subject, stage ?? ""].join("\u0000");
    const g = groups.get(key) ?? { key, scope, scopeId, family, subject, stage, members: [], extra };
    g.members.push(member);
    groups.set(key, g);
  };

  for (const row of input.rows) {
    const show = row.scope_id ?? "";
    if (row.scope !== "event" || !show) continue;
    const e = ev(row);
    if (row.kind === "variant_pair") {
      const axis = String(e.axis ?? "") as Axis;
      if (!AXIS_SIDES[axis]) continue;
      const a = (e.a ?? {}) as { adIds?: string[]; results?: number };
      const b = (e.b ?? {}) as { adIds?: string[]; results?: number };
      const va = input.voiceOf.get(a.adIds?.[0] ?? "") ?? "unknown";
      const vb = input.voiceOf.get(b.adIds?.[0] ?? "") ?? "unknown";
      const voice = va === vb ? va : "unknown";
      const exact = e.ratioBound === "exact" && num(row.ratio) > 0;
      const member: Member = { show, clientId: row.client_id, ratio: exact ? num(row.ratio) : null, weight: num(a.results) + num(b.results), spend: num(row.spend_gbp), results: num(row.results), subject: row.subject ?? "", bound: !exact };
      for (const s of scopesOf(row.client_id, input.verticalOf)) add(s.scope, s.scopeId, "pair", `pair|${axis}|${voice}`, row.stage, member, { axis, voice });
    } else if (row.kind === "phase_curve") {
      const phase = row.verdict ?? "";
      if (!phase || phase === "teaser" || phase === "no_phase_data") continue;
      const ratio = num(row.ratio) > 0 ? num(row.ratio) : null;
      if (ratio == null) continue;
      const member: Member = { show, clientId: row.client_id, ratio, weight: num(row.results), spend: num(row.spend_gbp), results: num(row.results), subject: row.subject ?? "", bound: false };
      for (const s of scopesOf(row.client_id, input.verticalOf)) add(s.scope, s.scopeId, "phase", `phase|teaser>${phase}`, row.stage, member, { from: "teaser", to: phase });
    } else if (row.kind === "test_verdict") {
      const kind = testKindOf(row);
      const member: Member = { show, clientId: row.client_id, ratio: null, weight: 0, spend: num(row.spend_gbp), results: num(row.results), subject: `${row.verdict ?? ""}|${row.subject ?? ""}`, bound: false };
      for (const s of scopesOf(row.client_id, input.verticalOf)) add(s.scope, s.scopeId, "tests", `tests|${kind}`, null, member, { testKind: kind });
    }
  }

  // All first, then vertical, then client: each shrinks toward the scope above it.
  const order: RollupScope[] = ["all", "vertical", "client"];
  const done = new Map<string, RollupRow>();
  const rows: RollupRow[] = [];
  const parentKey = (g: Group, scope: RollupScope, scopeId: string | null) => [scope, scopeId ?? "", g.family, g.subject, g.stage ?? ""].join("\u0000");
  for (const scope of order) {
    for (const g of groups.values()) {
      if (g.scope !== scope) continue;
      const shows = new Set(g.members.map((m) => m.show));
      const spend = Math.round(g.members.reduce((s, m) => s + m.spend, 0) * 100) / 100;
      const results = g.members.reduce((s, m) => s + m.results, 0);
      const base = { kind: "axis_rollup" as const, scope, scope_id: g.scopeId, event_id: null, client_id: scope === "client" ? g.scopeId : null, stage: g.stage, week_start: null, subject: g.subject, read_day: null, source: null, recommendation: null, computed_at: input.computedAt, n_shows: shows.size, spend_gbp: spend, results };
      if (g.family === "tests") {
        const tests = g.members.length;
        const winners = g.members.filter((m) => m.subject.startsWith("ready_to_call|")).length;
        const called = g.members.filter((m) => CALLED_VERDICTS.includes(m.subject.split("|")[0]!)).length;
        const row: RollupRow = { ...base, metric: "winners", value_a: winners, value_b: tests, ratio: tests ? round(winners / tests) : null, n_pairs: null, confidence: capByShows(shows.size >= 3 ? "ok" : "thin", shows.size), verdict: winners ? "winners" : called ? "no_winners" : "running", evidence: { ...g.extra, tests, winners, called, running: tests - called, shows: [...shows].sort() } };
        rows.push(row);
        done.set(g.key, row);
        continue;
      }
      const priced = g.members.filter((m) => m.ratio != null && m.ratio > 0);
      const weight = priced.reduce((s, m) => s + Math.max(1, m.weight), 0);
      const index = priced.length ? Math.exp(priced.reduce((s, m) => s + Math.max(1, m.weight) * Math.log(m.ratio!), 0) / weight) : null;
      const chain = scope === "client" ? [done.get(parentKey(g, "vertical", verticalOfScope(g, input.verticalOf))), done.get(parentKey(g, "all", null))] : scope === "vertical" ? [done.get(parentKey(g, "all", null))] : [];
      const pool = choosePool(chain.map((r) => (r ? { index: r.ratio, confidence: r.confidence, fundedAds: (r.n_pairs ?? r.n_shows) as number } : null)));
      const n = priced.length;
      const { shrunkIndex } = shrinkIndex(n, index, pool);
      const confidence = capByShows(confidenceOf(n, spend, results), shows.size);
      const sides = g.family === "pair" ? AXIS_SIDES[(g.extra?.axis as Axis) ?? "date"] : null;
      const sorted = priced.map((m) => m.ratio!).sort((a, b) => a - b);
      const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2) : null;
      const shrunk = round(shrunkIndex);
      const row: RollupRow =
        g.family === "pair"
          ? { ...base, metric: "cost_ratio", value_a: shrunk, value_b: round(index), ratio: shrunk, n_pairs: g.members.length, confidence, verdict: shrunk == null ? "no_ratio" : shrunk < 1 ? `${sides![0]}_cheaper` : shrunk > 1 ? `${sides![1]}_cheaper` : "equal", evidence: { ...g.extra, sides, raw: round(index), pool, priced: priced.length, bounds: g.members.length - priced.length, members: g.members.map((m) => m.subject) } }
          : { ...base, metric: "cost_ratio_to_teaser", value_a: round(median), value_b: shrunk, ratio: round(median), n_pairs: null, confidence, verdict: median == null ? "no_ratio" : median > 1 ? "cost_rises" : median < 1 ? "cost_falls" : "equal", evidence: { ...g.extra, median: round(median), weightedMean: round(index), shrunk, pool, ratios: priced.map((m) => ({ show: m.show, ratio: round(m.ratio) })) } };
      rows.push(row);
      done.set(g.key, row);
    }
  }
  return rows.sort((a, b) => order.indexOf(a.scope) - order.indexOf(b.scope) || String(a.scope_id).localeCompare(String(b.scope_id)) || a.subject.localeCompare(b.subject) || String(a.stage).localeCompare(String(b.stage)));
}

function verticalOfScope(g: { members: Member[] }, verticalOf: ReadonlyMap<string, string | null>): string | null {
  const client = g.members.find((m) => m.clientId)?.clientId;
  return client ? (verticalOf.get(client) ?? null) : null;
}
