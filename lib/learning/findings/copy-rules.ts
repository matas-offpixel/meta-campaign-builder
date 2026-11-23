/**
 * E5: copy rules surfaced (kind copy_rule), pure. Reads copy_features
 * (migration 213) as stored; nothing is recomputed.
 *
 *   voices disagree   the same feature × value × field × stage × scope reads
 *                     proven for one voice (n ≥ 2 shows, index ≤ 0.9, 213's
 *                     rule) and > 1.1 from ≥ 2 shows for the other. Subject
 *                     "{feature}={value}|{field}|voices", value_a the promoter's
 *                     index, value_b the artist's.
 *   strong            proven at index ≤ 0.85 ("better"), or ≥ 1.25 from ≥ 2
 *                     shows ("worse"). Subject "{feature}={value}|{field}|{voice}".
 *
 * 213's "proven" only ever means better (≤ 0.9), so a worse side can't be
 * proven: it's held to the same bar of shows (≥ 2), never fewer. An index
 * below 1 is better (cheaper than the event's stage cost per result).
 * Scopes as copy_features has them; "all" reads scope_id null. Client-scope
 * rows of archived clients are left out by the loader.
 */

import type { Confidence } from "../shrink.ts";

export type CopyFeatureRow = {
  feature: string;
  value: string;
  field: string;
  stage: string;
  voice: string;
  scope: string;
  scope_id: string;
  events_n: number;
  ads_n: number;
  spend: number | string;
  results: number | string;
  index_vs_event: number | string | null;
  confidence: string;
  proven: boolean;
};

export const COPY_RULES = { better: 0.85, worse: 1.25, disagreeGood: 0.9, disagreeBad: 1.1, minShows: 2 } as const;

export type CopyRuleRow = {
  kind: "copy_rule";
  scope: "client" | "vertical" | "all";
  scope_id: string | null;
  event_id: null;
  client_id: string | null;
  stage: string;
  week_start: null;
  subject: string;
  metric: "index_vs_event";
  value_a: number | null;
  value_b: number | null;
  ratio: number | null;
  n_shows: number;
  n_pairs: null;
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

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const idx = (r: CopyFeatureRow) => (r.index_vs_event == null || r.index_vs_event === "" ? null : Number(r.index_vs_event));
const CONF: Record<string, number> = { thin: 0, ok: 1, strong: 2 };
const lower = (a: string, b: string): Confidence => ((CONF[a] ?? 0) <= (CONF[b] ?? 0) ? a : b) as Confidence;

export function copyRules(rows: readonly CopyFeatureRow[], computedAt: string): CopyRuleRow[] {
  const out: CopyRuleRow[] = [];
  const base = (r: CopyFeatureRow) => ({
    kind: "copy_rule" as const,
    scope: r.scope as CopyRuleRow["scope"],
    scope_id: r.scope === "all" ? null : r.scope_id,
    event_id: null,
    client_id: r.scope === "client" ? r.scope_id : null,
    stage: r.stage,
    week_start: null,
    metric: "index_vs_event" as const,
    n_pairs: null,
    read_day: null,
    source: null,
    recommendation: null,
    computed_at: computedAt,
  });
  const fact = (r: CopyFeatureRow) => ({ voice: r.voice, index: idx(r), shows: r.events_n, ads: r.ads_n, spend: num(r.spend), results: num(r.results), proven: r.proven, confidence: r.confidence });

  // Strong single rows.
  for (const r of rows) {
    const i = idx(r);
    if (i == null) continue;
    const better = r.proven && i <= COPY_RULES.better;
    const worse = r.events_n >= COPY_RULES.minShows && i >= COPY_RULES.worse;
    if (!better && !worse) continue;
    out.push({ ...base(r), subject: `${r.feature}=${r.value}|${r.field}|${r.voice}`, value_a: i, value_b: null, ratio: i, n_shows: r.events_n, spend_gbp: num(r.spend), results: num(r.results), confidence: r.confidence as Confidence, verdict: better ? "better" : "worse", evidence: { feature: r.feature, value: r.value, field: r.field, rule: "strong", row: fact(r) } });
  }

  // Promoter and artist disagree.
  const byKey = new Map<string, { promoter?: CopyFeatureRow; artist?: CopyFeatureRow }>();
  for (const r of rows) {
    if (r.voice !== "promoter" && r.voice !== "artist") continue;
    const key = [r.feature, r.value, r.field, r.stage, r.scope, r.scope_id].join("\u0000");
    const pair = byKey.get(key) ?? {};
    pair[r.voice] = r;
    byKey.set(key, pair);
  }
  for (const { promoter: p, artist: a } of byKey.values()) {
    if (!p || !a) continue;
    const ip = idx(p);
    const ia = idx(a);
    if (ip == null || ia == null) continue;
    const promoterBetter = p.proven && ip < COPY_RULES.disagreeGood + 1e-9 && a.events_n >= COPY_RULES.minShows && ia > COPY_RULES.disagreeBad;
    const artistBetter = a.proven && ia < COPY_RULES.disagreeGood + 1e-9 && p.events_n >= COPY_RULES.minShows && ip > COPY_RULES.disagreeBad;
    if (!promoterBetter && !artistBetter) continue;
    out.push({ ...base(p), subject: `${p.feature}=${p.value}|${p.field}|voices`, value_a: ip, value_b: ia, ratio: ia > 0 ? Math.round((ip / ia) * 10000) / 10000 : null, n_shows: Math.min(p.events_n, a.events_n), spend_gbp: num(p.spend) + num(a.spend), results: num(p.results) + num(a.results), confidence: lower(p.confidence, a.confidence), verdict: promoterBetter ? "promoter_better" : "artist_better", evidence: { feature: p.feature, value: p.value, field: p.field, rule: "voices_disagree", promoter: fact(p), artist: fact(a) } });
  }
  return out.sort((x, y) => x.scope.localeCompare(y.scope) || String(x.scope_id).localeCompare(String(y.scope_id)) || x.subject.localeCompare(y.subject) || x.stage.localeCompare(y.stage));
}
