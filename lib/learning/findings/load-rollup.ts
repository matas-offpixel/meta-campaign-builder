/**
 * PR1c's loader: E3 rollup, E4 show week and E5 copy rules, read in the same
 * /api/cron/learning-findings run after pairs and curves.
 *
 * Reads (zero Meta calls):
 *   - ad_daily_insights for the last two complete London weeks (show week);
 *   - the stored test_verdict / variant_pair / phase_curve findings, with this
 *     run's rows laid over them by key (the dry run writes nothing, so it rolls
 *     up what this run would write);
 *   - clients (vertical, default pages), published drafts' pages and ad_copy
 *     for the pairs' ads (voice, as copy_features reads it);
 *   - copy_features, as stored (E5 recomputes nothing);
 *   - events (code → event, client), archived clients (lib/db/client-status.ts).
 *
 * Archived clients' rows are dropped before anything pools.
 */

import { GBP_PER_UNIT } from "../currency.ts";
import { loadPublishedPromoterPages } from "../copy-performance.ts";
import { voiceOf } from "../copy/normalise.ts";
import { axisRollup, type FindingRowLike, type RollupRow } from "./axis-rollup.ts";
import { copyRules, type CopyFeatureRow, type CopyRuleRow } from "./copy-rules.ts";
import { lastCompleteWeek, showWeek, showWeekRow, type ShowWeek, type ShowWeekRow, type WeekDay } from "./show-week.ts";
import { all, chunks, str, type Db, type Row } from "./read-all.ts";
import { campaignEventCode } from "./variant-pairs.ts";

const WEEK_COLUMNS = "date, meta_ad_id, campaign_name, ad_name, ad_account_id, spend, landing_page_views, registrations, purchases, actions, promoted_event, optimization_goal, campaign_objective";
const FINDING_COLUMNS = "id, kind, scope, scope_id, client_id, stage, week_start, subject, verdict, ratio, results, spend_gbp, confidence, evidence";
const COPY_COLUMNS = "feature, value, field, stage, voice, scope, scope_id, events_n, ads_n, spend, results, index_vs_event, confidence, proven";

export type RollupRead = {
  showWeeks: ShowWeek[];
  showWeekRows: ShowWeekRow[];
  rollupRows: RollupRow[];
  copyRuleRows: CopyRuleRow[];
  /** What pooled: stored rows read, this run's laid over them. */
  pooled: { stored: number; thisRun: number; pooled: number; voices: Record<string, number> };
  timings: { showWeekMs: number; rollupMs: number; copyRulesMs: number };
};

const keyOf = (r: { kind: string; scope: string; scope_id: string | null; stage: string | null; week_start?: string | null; subject: string | null }) => [r.kind, r.scope, r.scope_id ?? "", r.stage ?? "", r.week_start ?? "", r.subject ?? ""].join("\u0000");

export async function readRollupWeekCopy(input: {
  db: Db;
  readOn: string;
  archived: ReadonlySet<string>;
  accountCurrency: (adAccountId: string | null) => string;
  /** This run's test_verdict, variant_pair and phase_curve rows. */
  runRows: readonly (FindingRowLike & { week_start: string | null })[];
  eventCodes?: string[];
  computedAt: string;
  /** False before migration 264 is applied (dry run only): nothing stored to read. */
  findingsTable?: boolean;
}): Promise<RollupRead> {
  const { db, readOn } = input;
  const t0 = Date.now();

  // E4: the last two complete weeks of every show's campaigns.
  const { weekStart, weekEnd, lastWeekStart } = lastCompleteWeek(readOn);
  const weekDays = (await all(db, "ad_daily_insights", WEEK_COLUMNS, (q) => q.gte("date", lastWeekStart).lte("date", weekEnd), ["date", "meta_ad_id"])) as unknown as (WeekDay & { ad_account_id: string | null })[];
  const byShow = new Map<string, (WeekDay & { ad_account_id: string | null })[]>();
  for (const d of weekDays) {
    const code = campaignEventCode(d.campaign_name);
    if (!code || (input.eventCodes?.length && !input.eventCodes.includes(code))) continue;
    const list = byShow.get(code) ?? [];
    list.push(d);
    byShow.set(code, list);
  }
  const events = byShow.size ? await all(db, "events", "id, event_code, client_id", (q) => q.in("event_code", [...byShow.keys()]), ["id"]) : [];
  const eventOf = new Map<string, Row>();
  for (const e of events) if (!eventOf.has(str(e, "event_code"))) eventOf.set(str(e, "event_code"), e);
  const showWeeks: ShowWeek[] = [];
  const showWeekRows: ShowWeekRow[] = [];
  for (const [code, days] of [...byShow].sort(([a], [b]) => a.localeCompare(b))) {
    const event = eventOf.get(code);
    if (!event) continue;
    const clientId = str(event, "client_id") || null;
    if (clientId && input.archived.has(clientId)) continue;
    const currency = input.accountCurrency(days.find((d) => d.date >= weekStart)?.ad_account_id ?? days[0]?.ad_account_id ?? null);
    const gbpRate = GBP_PER_UNIT[currency] ?? 1;
    const w = showWeek({ eventCode: code, days, readOn, gbpRate });
    if (!w) continue;
    showWeeks.push(w);
    showWeekRows.push(showWeekRow(w, { eventId: str(event, "id"), clientId, gbpRate, currency, computedAt: input.computedAt }));
  }
  const t1 = Date.now();

  // E3: stored rows with this run's over them, archived clients out.
  const stored = input.findingsTable === false ? [] : ((await all(db, "learning_findings", FINDING_COLUMNS, (q) => q.in("kind", ["test_verdict", "variant_pair", "phase_curve"]), ["id"])) as unknown as (FindingRowLike & { week_start: string | null })[]);
  const pooledMap = new Map<string, FindingRowLike & { week_start: string | null }>();
  for (const r of stored) pooledMap.set(keyOf(r), r);
  for (const r of input.runRows) pooledMap.set(keyOf(r), r);
  const pooledRows = [...pooledMap.values()].filter((r) => !(r.client_id && input.archived.has(r.client_id)) && (!input.eventCodes?.length || input.eventCodes.includes(r.scope_id ?? "")));
  const clients = await all(db, "clients", "id, vertical, default_page_ids", (q) => q, ["id"]);
  const verticalOf = new Map(clients.map((c) => [str(c, "id"), str(c, "vertical") || null]));
  const promoterPages = new Map<string, string[]>(clients.map((c) => [str(c, "id"), [...(((c.default_page_ids as string[] | null) ?? []))]]));
  const pairAds = new Set<string>();
  for (const r of pooledRows) {
    if (r.kind !== "variant_pair") continue;
    const e = (r.evidence ?? {}) as { a?: { adIds?: string[] }; b?: { adIds?: string[] } };
    for (const id of [...(e.a?.adIds ?? []), ...(e.b?.adIds ?? [])]) pairAds.add(id);
  }
  const voices = new Map<string, string>();
  if (pairAds.size) {
    for (const page of await loadPublishedPromoterPages(db as never)) {
      const id = page.meta_page_id?.trim();
      if (!page.client_id || !id) continue;
      const list = promoterPages.get(page.client_id) ?? [];
      if (!list.includes(id)) list.push(id);
      promoterPages.set(page.client_id, list);
    }
    const clientOfAd = new Map<string, string | null>();
    for (const r of pooledRows) {
      if (r.kind !== "variant_pair") continue;
      const e = (r.evidence ?? {}) as { a?: { adIds?: string[] }; b?: { adIds?: string[] } };
      for (const id of [...(e.a?.adIds ?? []), ...(e.b?.adIds ?? [])]) clientOfAd.set(id, r.client_id);
    }
    for (const ids of chunks([...pairAds].sort(), 200)) {
      for (const c of await all(db, "ad_copy", "meta_ad_id, effective_object_story_id", (q) => q.in("meta_ad_id", ids), ["meta_ad_id"])) {
        const client = clientOfAd.get(str(c, "meta_ad_id")) ?? null;
        voices.set(str(c, "meta_ad_id"), voiceOf(str(c, "effective_object_story_id") || null, client ? (promoterPages.get(client) ?? []) : []).voice);
      }
    }
  }
  const rollupRows = axisRollup({ rows: pooledRows, verticalOf, voiceOf: voices, computedAt: input.computedAt });
  const t2 = Date.now();

  // E5: copy_features as stored, client-scope rows of archived clients out.
  const features = (await all(db, "copy_features", COPY_COLUMNS, (q) => q, ["feature", "value", "field", "stage", "voice", "scope", "scope_id"])) as unknown as CopyFeatureRow[];
  const copyRuleRows = copyRules(features.filter((f) => !(f.scope === "client" && input.archived.has(f.scope_id))), input.computedAt);
  const t3 = Date.now();

  const voiceCounts: Record<string, number> = {};
  for (const v of voices.values()) voiceCounts[v] = (voiceCounts[v] ?? 0) + 1;
  return {
    showWeeks,
    showWeekRows,
    rollupRows,
    copyRuleRows,
    pooled: { stored: stored.length, thisRun: input.runRows.length, pooled: pooledRows.length, voices: voiceCounts },
    timings: { showWeekMs: t1 - t0, rollupMs: t2 - t1, copyRulesMs: t3 - t2 },
  };
}

/** Rollup and copy-rule rows a later night no longer has: every row of the kind this run didn't write. */
export async function deleteStaleRollupRows(db: Db, computedAt: string): Promise<string | null> {
  for (const kind of ["axis_rollup", "copy_rule"]) {
    const q = db.from("learning_findings").delete().eq("kind", kind) as unknown as { lt(c: string, v: string): PromiseLike<{ error: { message: string } | null }> };
    const res = await q.lt("computed_at", computedAt);
    if (res.error) return `learning_findings: ${res.error.message}`;
  }
  return null;
}
