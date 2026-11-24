/**
 * RP1's loader and run: observed tests → learning_findings (migration 264).
 *
 * The nightly /api/cron/learning-findings (04:15 UTC, after the 02:30 UTC
 * ad-daily-insights restate and the 03:30 UTC learning-refresh) and
 * scripts/learning-findings.mts both call `runLearningFindings`.
 *
 * Reads, all from the app's own tables (zero Meta calls):
 *   - ad_daily_insights of the show test campaigns ("{code} · Tests",
 *     "· AB copy test", "· Artist cards test") that delivered in the last
 *     DISCOVERY_DAYS days, then every day of those ad sets;
 *   - the show's ad-days over the test's days, for TF5's benchmark (every
 *     campaign named with its code, as read-job.ts reads them);
 *   - creative_tests.meta_adset_id: an ad set the app made a test for is its
 *     own read's, never an observed one (one ad set, one verdict);
 *   - events (code → event, client), archived clients (lib/db/client-status.ts),
 *     bm_ad_accounts currencies (lib/learning/currency.ts);
 *   - the stored test_verdict findings, for the state between reads.
 *
 * After the tests, the same run reads RP2's variant pairs and RP3's phase
 * curves (load-pairs-curves.ts) and writes their rows in the same upsert.
 *
 * Writes: one learning_findings row per observed test, upserted on
 * (kind, scope, scope_id, stage, week_start, subject), so a rerun replaces
 * the day's read. Never Meta, never creative_tests.
 *
 * Killswitch: ENABLE_LEARNING_FINDINGS must be exactly "1". Not a
 * learning-refresh job (LEARNING_JOBS): that run sits at ~185 s of its 300 s.
 *
 * learning_findings is operator-only (migration 264: service role only; the
 * app reader that PR2 adds gates on OPERATOR_USER_IDS). Relative imports only.
 */

import { loadArchivedClientIds } from "../../db/client-status.ts";
import { all, chunks, str, type Db, type Row } from "./read-all.ts";
import { deleteStaleCurveRows, readPairsAndCurves, type PairsCurvesRead } from "./load-pairs-curves.ts";
import { deleteStaleRollupRows, readRollupWeekCopy, type RollupRead } from "./load-rollup.ts";
import { GBP_PER_UNIT, KNOWN_ACCOUNT_CURRENCY } from "../currency.ts";
import { londonDay } from "../../creative-tests/fast-call.ts";
import { ROUND_TEST_CAMPAIGN_SUFFIXES } from "../../creative-tests/tests-campaign.ts";
import {
  addDays,
  findingRow,
  groupObservedTests,
  priorOf,
  readObservedTest,
  type LearningFindingRow,
  type ObservedAdDay,
  type ObservedRead,
  type ObservedTest,
  type PriorRead,
} from "./observed-tests.ts";


export const FINDINGS_ENV = "ENABLE_LEARNING_FINDINGS";

export function isLearningFindingsEnabled(env: Record<string, string | undefined>): boolean {
  return env[FINDINGS_ENV] === "1";
}

/** A test that last delivered longer ago than this is not read again (its finding stands). */
export const DISCOVERY_DAYS = 14;

export const FINDINGS_CONFLICT = "kind,scope,scope_id,stage,week_start,subject";

const TEST_CAMPAIGN_PATTERNS = ["% · Tests", ...ROUND_TEST_CAMPAIGN_SUFFIXES.map((s) => `% · ${s}`)];

const OBSERVED_COLUMNS =
  "date, meta_ad_id, meta_adset_id, meta_campaign_id, campaign_name, adset_name, ad_name, ad_account_id, spend, landing_page_views, registrations, actions, promoted_event, optimization_goal, campaign_objective";
const SHOW_COLUMNS = "date, meta_ad_id, campaign_name, spend, landing_page_views, registrations, actions";


/** The show test campaigns' ad sets that delivered in [from, to], with every day of each (to `to`). */
export async function loadObservedTestDays(db: Db, from: string, to: string): Promise<ObservedAdDay[]> {
  const recent: Row[] = [];
  for (const pattern of TEST_CAMPAIGN_PATTERNS) {
    recent.push(...(await all(db, "ad_daily_insights", "date, meta_ad_id, meta_adset_id, campaign_name", (q) => q.ilike("campaign_name", pattern).gte("date", from).lte("date", to), ["date", "meta_ad_id"])));
  }
  const adsets = [...new Set(recent.map((r) => str(r, "meta_adset_id")).filter(Boolean))];
  const days: Row[] = [];
  for (const ids of chunks(adsets, 100)) {
    days.push(...(await all(db, "ad_daily_insights", OBSERVED_COLUMNS, (q) => q.in("meta_adset_id", ids).lte("date", to), ["date", "meta_ad_id"])));
  }
  return days as unknown as ObservedAdDay[];
}

/** Every ad-day of campaigns named with the show's code on [from, to] (TF5's rows, as read-job.ts reads them). */
export function loadShowDays(db: Db, eventCode: string, from: string, to: string): Promise<Row[]> {
  return all(db, "ad_daily_insights", SHOW_COLUMNS, (q) => q.ilike("campaign_name", `%${eventCode}%`).gte("date", from).lte("date", to), ["date", "meta_ad_id"]);
}

/** TF9: today's ad-daily-insights run restated yesterday (a successful run that started on today's London day and wasn't skipped). */
async function insightsRestated(db: Db, readOn: string): Promise<boolean> {
  const res = await db.from("cron_runs").select("cron_name, started_at, ok, detail").eq("cron_name", "ad-daily-insights").order("started_at", { ascending: false }).range(0, 19);
  if (res.error) return false;
  return ((res.data ?? []) as Row[]).some((run) => run.ok === true && londonDay(str(run, "started_at")) === readOn && !((run.detail as Row | null)?.skippedReason));
}

/** Missing table (migration 264 not applied yet): PostgREST's PGRST205 / Postgres 42P01. */
function isMissingTable(err: { message: string; code?: string } | null): boolean {
  return Boolean(err && (err.code === "PGRST205" || err.code === "42P01" || /does not exist|could not find the table/i.test(err.message)));
}

export type ObservedRecord = {
  test: ObservedTest;
  read: ObservedRead | null;
  /** Why the test got no read this run. */
  skipped: "app_test" | "archived_client" | "finding_stands" | null;
  eventId: string | null;
  clientId: string | null;
  currency: string;
  row: LearningFindingRow | null;
};

export type FindingsResult =
  | { ok: true; skippedReason: string }
  | {
      ok: boolean;
      dryRun: boolean;
      readOn: string;
      covered: boolean;
      tests: number;
      /** Rows written, every kind. */
      written: number;
      writtenByKind: { test_verdict: number; variant_pair: number; phase_curve: number; show_week: number; axis_rollup: number; copy_rule: number };
      skipped: { appTest: number; archivedClient: number; findingStands: number };
      findingsTable: "present" | "missing";
      records: ObservedRecord[];
      /** RP2 / RP3, after the tests. */
      pairsCurves: PairsCurvesRead;
      /** PR1c: E3 rollup, E4 show week, E5 copy rules, after pairs and curves. Rollup and copy rules aren't written on a run narrowed to events. */
      rollup: RollupRead;
      timings: { testsMs: number; pairsCurvesMs: number; rollupMs: number; writeMs: number; totalMs: number };
      errors: { adsetId: string; error: string }[];
    };

export async function runLearningFindings(input: {
  env: Record<string, string | undefined>;
  db: Db;
  now?: Date;
  /** The London day to read as (YYYY-MM-DD). Default today. */
  readOn?: string;
  dryRun?: boolean;
  eventCodes?: string[];
}): Promise<FindingsResult> {
  if (!isLearningFindingsEnabled(input.env)) return { ok: true, skippedReason: "killswitch" };
  const { db } = input;
  const now = input.now ?? new Date();
  const readOn = input.readOn ?? londonDay(now.toISOString());
  const yesterday = addDays(readOn, -1);
  const dryRun = input.dryRun === true;
  const started = Date.now();

  const days = await loadObservedTestDays(db, addDays(readOn, -DISCOVERY_DAYS), yesterday);
  let tests = groupObservedTests(days);
  if (input.eventCodes?.length) tests = tests.filter((t) => input.eventCodes!.includes(t.eventCode));
  const adsetIds = tests.map((t) => t.adsetId);
  const codes = [...new Set(tests.map((t) => t.eventCode))];

  const [appTests, events, archived, accounts, covered] = await Promise.all([
    adsetIds.length ? all(db, "creative_tests", "id, meta_adset_id", (q) => q.in("meta_adset_id", adsetIds), ["id"]) : Promise.resolve([]),
    codes.length ? all(db, "events", "id, event_code, client_id", (q) => q.in("event_code", codes), ["id"]) : Promise.resolve([]),
    loadArchivedClientIds(db as never),
    all(db, "bm_ad_accounts", "id, ad_account_id, currency", (q) => q, ["id"]),
    insightsRestated(db, readOn),
  ]);
  const appAdSets = new Set(appTests.map((t) => str(t, "meta_adset_id")));
  const eventByCode = new Map<string, Row>();
  for (const e of events) if (!eventByCode.has(str(e, "event_code"))) eventByCode.set(str(e, "event_code"), e);
  const currencyOf = new Map<string, string>();
  for (const a of accounts) if (str(a, "currency")) currencyOf.set(str(a, "ad_account_id").replace(/^act_/, ""), str(a, "currency").toUpperCase());
  const accountCurrency = (id: string | null) => {
    const bare = String(id ?? "").replace(/^act_/, "");
    return currencyOf.get(bare) ?? KNOWN_ACCOUNT_CURRENCY[bare] ?? "GBP";
  };

  // The stored findings: the state between reads. Before migration 264 is applied, none.
  let findingsTable: "present" | "missing" = "present";
  const priors = new Map<string, PriorRead>();
  if (adsetIds.length) {
    const res = await db.from("learning_findings").select("subject, evidence").eq("kind", "test_verdict").in("subject", adsetIds).range(0, 999);
    if (isMissingTable(res.error)) findingsTable = "missing";
    else if (res.error) throw new Error(`learning_findings: ${res.error.message}`);
    for (const row of (res.data ?? []) as Row[]) {
      const prior = priorOf(row);
      if (prior) priors.set(str(row, "subject"), prior);
    }
  }
  if (!dryRun && findingsTable === "missing") throw new Error("learning_findings: migration 264 isn't applied");

  const records: ObservedRecord[] = [];
  const errors: { adsetId: string; error: string }[] = [];
  const skipped = { appTest: 0, archivedClient: 0, findingStands: 0 };
  const showDaysCache = new Map<string, Row[]>();
  const computedAt = now.toISOString();

  for (const test of tests) {
    const event = eventByCode.get(test.eventCode) ?? null;
    const eventId = event ? str(event, "id") || null : null;
    const clientId = event ? str(event, "client_id") || null : null;
    const currency = accountCurrency(test.adAccountId);
    const base = { test, eventId, clientId, currency };
    if (appAdSets.has(test.adsetId)) {
      skipped.appTest += 1;
      records.push({ ...base, read: null, skipped: "app_test", row: null });
      continue;
    }
    if (clientId && archived.has(clientId)) {
      skipped.archivedClient += 1;
      records.push({ ...base, read: null, skipped: "archived_client", row: null });
      continue;
    }
    try {
      const first = test.days.reduce((m, d) => (d.date < m ? d.date : m), test.days[0]?.date ?? yesterday);
      const key = `${test.eventCode}|${first}`;
      let showDays = showDaysCache.get(key);
      if (!showDays) {
        showDays = await loadShowDays(db, test.eventCode, first, yesterday);
        showDaysCache.set(key, showDays);
      }
      const read = readObservedTest({ test, showDays: showDays as never, readOn, prior: priors.get(test.adsetId) ?? null, covered, currency });
      if (!read) {
        skipped.findingStands += 1;
        records.push({ ...base, read: null, skipped: "finding_stands", row: null });
        continue;
      }
      const row = findingRow(test, read, { eventId, clientId, gbpRate: GBP_PER_UNIT[currency] ?? 1, currency, computedAt });
      records.push({ ...base, read, skipped: null, row });
    } catch (err) {
      errors.push({ adsetId: test.adsetId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const testsDone = Date.now();

  // RP2 / RP3: variant pairs and phase curves, over the same window.
  const pairsCurves = await readPairsAndCurves({ db, readOn, discoveryDays: DISCOVERY_DAYS, archived, accountCurrency, eventCodes: input.eventCodes, computedAt });
  const pairsDone = Date.now();

  const testRows = records.map((r) => r.row).filter((r): r is LearningFindingRow => r != null);
  // PR1c: show week, the cross-show rollup (stored rows with this run's over them) and copy rules.
  const rollup = await readRollupWeekCopy({ db, readOn, archived, accountCurrency, runRows: [...testRows, ...pairsCurves.pairRows, ...pairsCurves.curveRows] as never, eventCodes: input.eventCodes, computedAt, findingsTable: findingsTable === "present" });
  const narrowed = Boolean(input.eventCodes?.length);
  const rollupDone = Date.now();

  const writtenByKind = { test_verdict: 0, variant_pair: 0, phase_curve: 0, show_week: 0, axis_rollup: 0, copy_rule: 0 };
  const rows: { kind: keyof typeof writtenByKind }[] = dedupeOnKey([...testRows, ...pairsCurves.pairRows, ...pairsCurves.curveRows, ...rollup.showWeekRows, ...(narrowed ? [] : [...rollup.rollupRows, ...rollup.copyRuleRows])]);
  if (!dryRun && rows.length) {
    for (const batch of chunks(rows, 200)) {
      const res = await db.from("learning_findings").upsert(batch, { onConflict: FINDINGS_CONFLICT });
      if (res.error) {
        errors.push({ adsetId: "*", error: `learning_findings: ${res.error.message}` });
        break;
      }
      for (const row of batch) writtenByKind[row.kind] += 1;
    }
    if (!errors.length) {
      const byShow = new Map<string, string[]>();
      for (const row of pairsCurves.curveRows) byShow.set(row.scope_id, [...(byShow.get(row.scope_id) ?? []), row.subject]);
      const stale = await deleteStaleCurveRows(db, byShow);
      if (stale) errors.push({ adsetId: "*", error: stale });
      // Rollup and copy-rule rows this run didn't write are gone from the data: never on a narrowed run.
      if (!narrowed && !errors.length) {
        const staleRollup = await deleteStaleRollupRows(db, computedAt);
        if (staleRollup) errors.push({ adsetId: "*", error: staleRollup });
      }
    }
  }
  const written = Object.values(writtenByKind).reduce((a, b) => a + b, 0);
  const end = Date.now();

  return { ok: errors.length === 0, dryRun, readOn, covered, tests: tests.length, written, writtenByKind, skipped, findingsTable, records, pairsCurves, rollup, timings: { testsMs: testsDone - started, pairsCurvesMs: pairsDone - testsDone, rollupMs: rollupDone - pairsDone, writeMs: end - rollupDone, totalMs: end - started }, errors };
}

/** One row per unique key (a batch upsert can't touch a row twice); the last wins. */
function dedupeOnKey<T extends { kind: string; scope: string; scope_id: string | null; stage: string | null; week_start: string | null; subject: string | null }>(rows: readonly T[]): T[] {
  const byKey = new Map<string, T>();
  for (const r of rows) byKey.set([r.kind, r.scope, r.scope_id, r.stage, r.week_start, r.subject].map((v) => v ?? "\u0001").join("\u0000"), r);
  return [...byKey.values()];
}

/** The cron's response body: one short line per test, no ad-days. */
export function summariseFindings(result: FindingsResult): Record<string, unknown> {
  if ("skippedReason" in result) return result;
  const { records, pairsCurves, rollup, ...rest } = result;
  return {
    ...rest,
    records: records.map((r) => ({ eventCode: r.test.eventCode, adsetId: r.test.adsetId, adsetName: r.test.adsetName, state: r.read?.state ?? null, text: r.read?.text ?? null, readDay: r.read?.readDay ?? null, skipped: r.skipped })),
    pairs: { compared: pairsCurves.pairs.length, notCompared: pairsCurves.notCompared.length, verdicts: countBy(pairsCurves.pairs.map((p) => p.verdict)) },
    curves: { shows: pairsCurves.shows, withPhaseData: pairsCurves.curves.filter((c) => c.state === "curve").length, noPhaseData: pairsCurves.curves.filter((c) => c.state === "no_phase_data").length, rows: pairsCurves.curveRows.length },
    pairsCurvesTimings: pairsCurves.timings,
    showWeek: { shows: rollup.showWeekRows.length },
    axisRollup: { rows: rollup.rollupRows.length, notThin: rollup.rollupRows.filter((r) => r.confidence !== "thin").length, pooled: rollup.pooled },
    copyRules: { rows: rollup.copyRuleRows.length },
    rollupTimings: rollup.timings,
  };
}

function countBy(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

/** The cron_runs detail (no rows, no names: counts only). */
export function learningFindingsRunLog(body: Record<string, unknown>): { rows: number; considered: number; detail: Record<string, unknown> } {
  const skippedBy = (body.skipped ?? {}) as Record<string, number>;
  const verdicts: Record<string, number> = {};
  for (const r of (Array.isArray(body.records) ? body.records : []) as { state?: string | null }[]) {
    if (r.state) verdicts[r.state] = (verdicts[r.state] ?? 0) + 1;
  }
  return {
    rows: typeof body.written === "number" ? body.written : 0,
    considered: typeof body.tests === "number" ? body.tests : 0,
    detail: {
      readOn: body.readOn ?? null,
      covered: body.covered ?? null,
      tests: body.tests ?? 0,
      written: body.written ?? 0,
      writtenByKind: body.writtenByKind ?? null,
      pairs: body.pairs ?? null,
      curves: body.curves ?? null,
      timings: body.timings ?? null,
      showWeek: body.showWeek ?? null,
      axisRollup: body.axisRollup ?? null,
      copyRules: body.copyRules ?? null,
      skipped: skippedBy,
      verdicts,
      skippedReason: body.skippedReason ?? null,
      errors: Array.isArray(body.errors) ? body.errors.length : 0,
    },
  };
}
