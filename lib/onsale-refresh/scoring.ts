/**
 * R6 / HR6 — the on-sale refresh learning from its own moves.
 *
 * Every refresh line (shadow, rejected and applied alike) is judged once
 * its week is in ad_daily_insights: the first full Monday–Sunday week that
 * starts after the proposal's run day, or after the Apply day for an
 * applied line (a week starting on that day doesn't count). From the
 * line's stored evidence:
 *   - Pause: right if the campaign's cost per result held or improved, and
 *     the creative had kept running worse than 1.5× the campaign. Not
 *     applied: did the creative keep running worse than 1.5× in the week?
 *   - Add: right if the new ad's convert score is at or above the
 *     campaign's median after 7 days; the median leaves out every ad the
 *     same proposal added. Not applied: no ad ran — unknown.
 *   - Bring back / drop: right if the audience's cost per result came in on
 *     the predicted side of the campaign's (a bring-back cheaper, a drop
 *     dearer). A bring-back not applied, or a drop applied, has no week of
 *     its own — unknown. A drop not applied kept running: judged.
 *   - Move: right if the receiving side held its cost per result within
 *     20 %. Not applied: the receiving side never had the money — unknown.
 *   - New ad set (cluster bring-back, standing default; the record has no
 *     rule for them): right if the new ad set's cost per result is at or
 *     below the campaign's after 7 days. Not applied — unknown.
 * A side that spent and got no results did worse when it spent at least
 * the campaign's cost per result in the week; below that it is unknown,
 * "spent less than one result's worth".
 * Where a line can't be judged the outcome is unknown with its reason;
 * nothing is guessed, and unknown never counts towards a track record.
 *
 * DB-only: reads ad_daily_insights, creative_scores and the refresh's own
 * tables (every multi-row read paged in unique-key order and deduped);
 * writes onsale_refresh_outcomes (migration 241), one row per line. Zero
 * Meta calls. Runs inside /api/cron/learning-refresh, after its other
 * jobs, behind ENABLE_ONSALE_REFRESH_SCORING = "1".
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAllPaged } from "../db/paged-read.ts";
import { addDaysIso, outcomeWeek } from "./schedule.ts";

type Db = Pick<SupabaseClient, "from">;

export const SCORING_ENV = "ENABLE_ONSALE_REFRESH_SCORING";

export function isScoringEnabled(env: Record<string, string | undefined>): boolean {
  return env[SCORING_ENV] === "1";
}

/** R6's bars. */
export const PAUSE_WORSE_RATIO = 1.5;
export const MOVE_HOLD_RATIO = 1.2;
/** An unknown is looked at again for this long after its week, in case a late figure (a convert score) arrives. */
export const UNKNOWN_RETRY_DAYS = 14;
/** Design's words (2b): a side with no results that spent under the campaign's cost per result. */
export const SPENT_UNDER_ONE_RESULT = "spent less than one result's worth";

export type Outcome = "right" | "wrong" | "unknown";

export type Judgement = { outcome: Outcome; reason: string; figures: Record<string, unknown> };

export type InsightRow = {
  meta_ad_id: string;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
  date: string;
  ad_name: string | null;
  spend: number | string | null;
  landing_page_views: number | string | null;
  actions: { action_type?: string; value?: string | number }[] | null;
};

export type ScoreLine = {
  id: string;
  proposal_id: string;
  user_id: string;
  kind: string;
  rule_id: string;
  state: string;
  target: Record<string, unknown> | null;
  evidence: Record<string, unknown> | null;
  write: Record<string, unknown> | null;
  applied_result: Record<string, unknown> | null;
  applied_at: string | null;
};

export type ScoreProposal = { id: string; event_id: string; user_id: string; campaign_key: string; campaign_ids: string[] | null; run_day: string; window_end: string; objective: string };

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

function actionCount(actions: InsightRow["actions"], type: string): number {
  if (!Array.isArray(actions)) return 0;
  return actions.filter((action) => action?.action_type === type).reduce((sum, action) => sum + num(action.value), 0);
}

/** The result the proposal optimised for (the same counts load.ts reads). */
export function resultOf(row: InsightRow, objective: string): number {
  if (objective === "initiate_checkout") return actionCount(row.actions, "omni_initiated_checkout");
  if (objective === "landing_page_view") return num(row.landing_page_views);
  return actionCount(row.actions, "omni_complete_registration");
}

type Totals = { spend: number; results: number; cpr: number | null };

function totals(rows: readonly InsightRow[], objective: string): Totals {
  const spend = rows.reduce((sum, row) => sum + num(row.spend), 0);
  const results = rows.reduce((sum, row) => sum + resultOf(row, objective), 0);
  return { spend: round2(spend), results, cpr: results > 0 && spend > 0 ? round2(spend / results) : null };
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : []);

/** Whether the line's write is live: applied, or failed part-way with something live. */
export function wasApplied(line: Pick<ScoreLine, "state" | "kind" | "applied_result">): boolean {
  if (line.state === "applied") return true;
  if (line.state !== "failed") return false;
  const result = line.applied_result ?? {};
  if (line.kind === "move_budget") return false; // a part-done move moved only the giving side
  return (Array.isArray(result.adIds) && result.adIds.length > 0) || (Array.isArray(result.pausedAdIds) && result.pausedAdIds.length > 0) || typeof result.adsetId === "string";
}

/**
 * The week a line is judged on (2d): the first full Monday–Sunday week
 * that starts after its Apply day (applied) or its proposal's run day; a
 * week starting on that day doesn't count. The same week the panel's F3
 * sentence names (schedule.ts outcomeWeek).
 */
export function judgedWeek(line: Pick<ScoreLine, "state" | "kind" | "applied_result" | "applied_at">, proposal: Pick<ScoreProposal, "run_day">): { from: string; to: string } {
  const { to } = outcomeWeek(wasApplied(line) && line.applied_at ? line.applied_at : `${proposal.run_day}T12:00:00Z`);
  return { from: addDaysIso(to, -6), to };
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The ad's name as Apply created it: the file name without its extension (apply.ts adName). */
export function adNameOf(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 380) || "Ad";
}

const unknown = (reason: string, figures: Record<string, unknown> = {}): Judgement => ({ outcome: "unknown", reason, figures });

/**
 * 2b: a side that spent and got no results. "worse" when it spent at least
 * one result's worth (the campaign's cost per result in the week), "short"
 * below that, null when it has results (or nothing to compare against).
 */
export function noResults(own: Totals, campaignCpr: number | null): "worse" | "short" | null {
  if (own.results > 0 || own.spend <= 0 || campaignCpr == null) return null;
  return own.spend >= campaignCpr ? "worse" : "short";
}

/** The names of the ads a proposal's applied Add lines created, so they're left out of each other's median (2e). */
export function addedAdNames(lines: readonly Pick<ScoreLine, "kind" | "state" | "target" | "applied_result">[]): Set<string> {
  const names = new Set<string>();
  for (const line of lines) {
    if (line.kind !== "add_creative" || !wasApplied(line)) continue;
    const name = line.target?.name;
    if (typeof name === "string" && name) names.add(adNameOf(name));
  }
  return names;
}

/**
 * Judge one line on its week. `rows` are the proposal's campaigns'
 * ad-days in that week; `scores` the event's latest convert scores by
 * creative name. Pure.
 */
export function judgeLine(line: ScoreLine, ctx: { objective: string; rows: readonly InsightRow[]; scores: ReadonlyMap<string, number>; addedBySameProposal?: ReadonlySet<string> }): Judgement {
  const applied = wasApplied(line);
  const campaign = totals(ctx.rows, ctx.objective);
  const evidence = line.evidence ?? {};
  const target = line.target ?? {};
  const write = line.write ?? {};
  const result = line.applied_result ?? {};
  const newAdSet = line.kind === "missing_default" || write.kind === "new_adset";
  const base = { campaign, applied };

  if (line.kind === "claim_ready") return unknown("A claim is made in the Lab; R6 has no outcome rule for it.", base);
  if (!ctx.rows.length) return unknown("The campaign had no ad-days in the week.", base);

  if (line.kind === "pause_creative") {
    const creative = typeof target.creative === "string" ? target.creative : null;
    if (!creative) return unknown("The line names no creative.", base);
    const before = num(evidence.campaignCpr) || null;
    const ratioBefore = evidence.cprRatio == null ? null : num(evidence.cprRatio);
    if (applied) {
      // R6: the campaign's cost held or improved, and the creative had kept running worse than 1.5×.
      if (campaign.cpr == null || before == null) return unknown("No cost per result for the campaign in the week, or none stored before.", { ...base, before });
      // 2b: no results before counts as worse than 1.5× once it had spent one result's worth.
      if (ratioBefore == null && num(evidence.results) === 0 && num(evidence.spend) > 0 && num(evidence.spend) < before) return unknown(SPENT_UNDER_ONE_RESULT, { ...base, before, spendBefore: num(evidence.spend) });
      const workedBefore = ratioBefore == null ? num(evidence.results) === 0 && num(evidence.spend) >= before : ratioBefore >= PAUSE_WORSE_RATIO;
      const held = campaign.cpr <= before;
      return { outcome: held && workedBefore ? "right" : "wrong", reason: held ? (workedBefore ? "The campaign's cost held or improved, and the creative had run worse than 1.5×." : "The campaign's cost held, but the creative hadn't run worse than 1.5×.") : "The campaign's cost rose after the pause.", figures: { ...base, before, ratioBefore, bar: PAUSE_WORSE_RATIO } };
    }
    // Not applied: did the creative keep running worse than 1.5× the campaign?
    const own = totals(ctx.rows.filter((row) => row.ad_name === creative), ctx.objective);
    if (own.spend <= 0) return unknown("Not paused, and the creative didn't run in the week.", { ...base, creative: own });
    if (campaign.cpr == null) return unknown("No cost per result for the campaign in the week.", { ...base, creative: own });
    const none = noResults(own, campaign.cpr);
    if (none === "short") return unknown(SPENT_UNDER_ONE_RESULT, { ...base, creative: own });
    const ratio = own.cpr == null ? null : round2(own.cpr / campaign.cpr);
    const worse = none === "worse" || ratio! >= PAUSE_WORSE_RATIO;
    return { outcome: worse ? "right" : "wrong", reason: worse ? "Not paused: the creative kept running worse than 1.5× the campaign." : "Not paused: the creative ran better than 1.5× the campaign.", figures: { ...base, creative: own, ratio, bar: PAUSE_WORSE_RATIO } };
  }

  if (line.kind === "add_creative") {
    if (!applied) return unknown("Not applied: no ad ran to score.", base);
    const fileName = typeof target.name === "string" ? target.name : null;
    if (!fileName) return unknown("The line names no file.", base);
    const name = adNameOf(fileName);
    const own = ctx.scores.get(name);
    if (own == null) return unknown("The new ad has no convert score yet.", { ...base, ad: name });
    // 2e: the median leaves out this ad and every other ad the same proposal added.
    const added = ctx.addedBySameProposal ?? new Set<string>();
    const others = [...new Set(ctx.rows.map((row) => row.ad_name).filter((n): n is string => typeof n === "string" && n.length > 0 && n !== name && !added.has(n)))].map((n) => ctx.scores.get(n)).filter((score): score is number => score != null);
    const mid = median(others);
    if (mid == null) return unknown("No other creative in the campaign has a convert score.", { ...base, ad: name, score: own });
    return { outcome: own >= mid ? "right" : "wrong", reason: own >= mid ? "The new ad's convert score is at or above the campaign's median." : "The new ad's convert score is under the campaign's median.", figures: { ...base, ad: name, score: own, median: mid, compared: others.length } };
  }

  if (newAdSet) {
    if (!applied) return unknown("Not applied: no new ad set ran.", base);
    const adsetId = typeof result.adsetId === "string" ? result.adsetId : null;
    if (!adsetId) return unknown("The new ad set's id wasn't stored.", base);
    const own = totals(ctx.rows.filter((row) => row.meta_adset_id === adsetId), ctx.objective);
    if (own.spend <= 0) return unknown("The new ad set didn't spend in the week.", { ...base, adset: own });
    if (campaign.cpr == null) return unknown("No cost per result for the campaign in the week.", { ...base, adset: own });
    const none = noResults(own, campaign.cpr);
    if (none === "short") return unknown(SPENT_UNDER_ONE_RESULT, { ...base, adset: own });
    if (none === "worse") return { outcome: "wrong", reason: "The new ad set spent at least one result's worth and got no results.", figures: { ...base, adset: own } };
    const right = own.cpr! <= campaign.cpr;
    return { outcome: right ? "right" : "wrong", reason: right ? "The new ad set's cost per result was at or below the campaign's." : "The new ad set's cost per result was above the campaign's.", figures: { ...base, adset: own } };
  }

  if (line.kind === "bring_back_audience" || line.kind === "drop_audience") {
    const ids = strings(target.adsetIds).length ? strings(target.adsetIds) : strings([target.adsetId]);
    const bringBack = line.kind === "bring_back_audience";
    if (bringBack && !applied) return unknown("Not applied: the ad set stayed off, so it has no week to judge.", base);
    if (!bringBack && applied) return unknown("Dropped: the ad set was off all week, so it has no figures to judge.", base);
    const own = totals(ctx.rows.filter((row) => row.meta_adset_id && ids.includes(row.meta_adset_id)), ctx.objective);
    if (own.spend <= 0) return unknown("The ad set didn't spend in the week.", { ...base, adset: own });
    if (campaign.cpr == null) return unknown("No cost per result for the campaign in the week.", { ...base, adset: own });
    // Predicted side: a bring-back cheaper than the campaign, a drop dearer. No results reads as dearer once it spent one result's worth (2b).
    const none = noResults(own, campaign.cpr);
    if (none === "short") return unknown(SPENT_UNDER_ONE_RESULT, { ...base, adset: own });
    const cheaper = own.cpr != null && own.cpr < campaign.cpr;
    const right = bringBack ? cheaper : !cheaper;
    return { outcome: right ? "right" : "wrong", reason: right ? (bringBack ? "Its cost per result came in under the campaign's, as predicted." : "Not dropped: its cost per result stayed over the campaign's, as predicted.") : bringBack ? "Its cost per result came in over the campaign's." : "Not dropped: its cost per result came in under the campaign's.", figures: { ...base, adset: own, predicted: bringBack ? "under" : "over" } };
  }

  if (line.kind === "move_budget") {
    if (!applied) return unknown("Not applied: the receiving side never had the money, so the move can't be judged.", base);
    const toId = typeof target.toAdsetId === "string" ? target.toAdsetId : typeof write.toAdsetId === "string" ? write.toAdsetId : null;
    const before = num(evidence.toCpr) || null;
    if (!toId || before == null) return unknown("The line stores no receiving ad set or its cost before.", base);
    const own = totals(ctx.rows.filter((row) => row.meta_adset_id === toId), ctx.objective);
    if (own.spend <= 0) return unknown("The receiving ad set didn't spend in the week.", { ...base, receiving: own });
    const none = noResults(own, campaign.cpr);
    if (none === "short") return unknown(SPENT_UNDER_ONE_RESULT, { ...base, receiving: own });
    if (none === "worse") return { outcome: "wrong", reason: "The receiving ad set spent at least one result's worth and got no results.", figures: { ...base, receiving: own, before, bar: MOVE_HOLD_RATIO } };
    if (own.cpr == null) return unknown("The receiving ad set had no cost per result in the week.", { ...base, receiving: own });
    const held = own.cpr <= before * MOVE_HOLD_RATIO;
    return { outcome: held ? "right" : "wrong", reason: held ? "The receiving ad set held its cost per result within 20 %." : "The receiving ad set's cost per result rose more than 20 %.", figures: { ...base, receiving: own, before, bar: MOVE_HOLD_RATIO } };
  }

  return unknown(`R6 has no outcome rule for ${line.kind}.`, base);
}

export type OutcomeRow = {
  line_id: string;
  proposal_id: string;
  user_id: string;
  event_id: string;
  client_id: string | null;
  rule_id: string;
  kind: string;
  applied: boolean;
  outcome: Outcome;
  reason: string;
  week_from: string;
  week_to: string;
  figures: Record<string, unknown>;
  scored_at: string;
};

type ExistingOutcome = { line_id: string; outcome: Outcome; week_to: string };

/**
 * The lines due a judgement tonight: their week's last day is in
 * ad_daily_insights, and they have no outcome yet, or an unknown still
 * inside its retry window. A judged right / wrong is never re-judged.
 */
export function dueLines(lines: readonly ScoreLine[], proposals: ReadonlyMap<string, ScoreProposal>, existing: ReadonlyMap<string, ExistingOutcome>, latestDay: string, today: string): { line: ScoreLine; proposal: ScoreProposal; week: { from: string; to: string } }[] {
  const out: { line: ScoreLine; proposal: ScoreProposal; week: { from: string; to: string } }[] = [];
  for (const line of lines) {
    const proposal = proposals.get(line.proposal_id);
    if (!proposal) continue;
    const week = judgedWeek(line, proposal);
    if (week.to > latestDay) continue;
    const have = existing.get(line.id);
    if (have && have.outcome !== "unknown") continue;
    if (have && addDaysIso(have.week_to, UNKNOWN_RETRY_DAYS) < today) continue;
    out.push({ line, proposal, week });
  }
  return out;
}

export type ScoringResult = { scored: number; right: number; wrong: number; unknown: number; due: number; latestDay: string | null };

/**
 * The nightly job. `dryRun` judges and writes nothing. Throws on a read
 * or write error; the learning-refresh runner catches it so its other
 * jobs are untouched.
 */
export async function scoreOnsaleRefresh(db: Db, opts: { now: Date; dryRun?: boolean }): Promise<ScoringResult & { rows: OutcomeRow[] }> {
  const today = opts.now.toISOString().slice(0, 10);
  const latest = await db.from("ad_daily_insights").select("date").order("date", { ascending: false }).limit(1);
  if (latest.error) throw new Error(`ad_daily_insights latest: ${latest.error.message}`);
  const latestDay = ((latest.data ?? []) as { date: string }[])[0]?.date ?? null;
  const empty = { scored: 0, right: 0, wrong: 0, unknown: 0, due: 0, latestDay, rows: [] as OutcomeRow[] };
  if (!latestDay) return empty;

  const [lines, proposals, existing] = await Promise.all([
    loadAllPaged<ScoreLine>(db as never, "onsale_refresh_lines", "id, proposal_id, user_id, kind, rule_id, state, target, evidence, write, applied_result, applied_at", ["id"]),
    loadAllPaged<ScoreProposal>(db as never, "onsale_refresh_proposals", "id, event_id, user_id, campaign_key, campaign_ids, run_day, window_end, objective", ["id"]),
    loadAllPaged<ExistingOutcome>(db as never, "onsale_refresh_outcomes", "line_id, outcome, week_to", ["line_id"]),
  ]);
  const byProposal = new Map(proposals.map((row) => [row.id, row]));
  const linesOf = new Map<string, ScoreLine[]>();
  for (const line of lines) linesOf.set(line.proposal_id, [...(linesOf.get(line.proposal_id) ?? []), line]);
  const due = dueLines(lines, byProposal, new Map(existing.map((row) => [row.line_id, row])), latestDay, today);
  if (!due.length) return { ...empty, due: 0 };

  const eventIds = [...new Set(due.map((item) => item.proposal.event_id))];
  const events = await loadAllPaged<{ id: string; client_id: string | null }>(db as never, "events", "id, client_id", ["id"], (q) => q.in("id", eventIds));
  const clientOf = new Map(events.map((row) => [row.id, row.client_id]));
  const needsScores = due.some((item) => item.line.kind === "add_creative");
  const scoreRows = needsScores
    ? await loadAllPaged<{ id: string; event_id: string; creative_name: string; score: number; fetched_at: string }>(db as never, "creative_scores", "id, event_id, creative_name, score, fetched_at", ["id"], (q) => q.in("event_id", eventIds).eq("axis", "convert"))
    : [];
  const latestRun = new Map<string, string>();
  for (const row of scoreRows) if (!latestRun.has(row.event_id) || row.fetched_at > latestRun.get(row.event_id)!) latestRun.set(row.event_id, row.fetched_at);
  const scoresFor = (eventId: string) => new Map(scoreRows.filter((row) => row.event_id === eventId && row.fetched_at === latestRun.get(eventId)).map((row) => [row.creative_name, num(row.score)]));

  // One read of ad-days per (campaigns, week).
  const cache = new Map<string, InsightRow[]>();
  const rowsFor = async (campaignIds: string[], week: { from: string; to: string }): Promise<InsightRow[]> => {
    const key = `${[...campaignIds].sort().join(",")}|${week.from}`;
    if (!cache.has(key)) {
      cache.set(
        key,
        campaignIds.length
          ? await loadAllPaged<InsightRow>(db as never, "ad_daily_insights", "meta_ad_id, meta_adset_id, meta_campaign_id, date, ad_name, spend, landing_page_views, actions", ["date", "meta_ad_id"], (q) => q.in("meta_campaign_id", campaignIds).gte("date", week.from).lte("date", week.to))
          : [],
      );
    }
    return cache.get(key)!;
  };

  const scoredAt = opts.now.toISOString();
  const rows: OutcomeRow[] = [];
  for (const { line, proposal, week } of due) {
    const judgement = judgeLine(line, { objective: proposal.objective, rows: await rowsFor(proposal.campaign_ids ?? [], week), scores: scoresFor(proposal.event_id), addedBySameProposal: addedAdNames(linesOf.get(proposal.id) ?? []) });
    rows.push({
      line_id: line.id,
      proposal_id: proposal.id,
      user_id: line.user_id,
      event_id: proposal.event_id,
      client_id: clientOf.get(proposal.event_id) ?? null,
      rule_id: line.rule_id,
      kind: line.kind,
      applied: wasApplied(line),
      outcome: judgement.outcome,
      reason: judgement.reason,
      week_from: week.from,
      week_to: week.to,
      figures: judgement.figures,
      scored_at: scoredAt,
    });
  }
  if (!opts.dryRun) {
    for (let i = 0; i < rows.length; i += 500) {
      const written = await db.from("onsale_refresh_outcomes").upsert(rows.slice(i, i + 500), { onConflict: "line_id" });
      if (written.error) throw new Error(`onsale_refresh_outcomes: ${written.error.message}`);
    }
  }
  return {
    scored: rows.length,
    right: rows.filter((row) => row.outcome === "right").length,
    wrong: rows.filter((row) => row.outcome === "wrong").length,
    unknown: rows.filter((row) => row.outcome === "unknown").length,
    due: due.length,
    latestDay,
    rows,
  };
}
