/**
 * The creative tests' daily read (docs/design-record/2026-11-16-creative-testing-3.html
 * TF2, and docs/design-record/2026-11-18-creative-testing-6.html TF5–TF8, HT1–HT2).
 *
 * TF9 (2026-11-18-creative-testing-7.html): the end day decides. A test ad set
 * ends at 23:59 London on its end day (day 4, then 8 and 12 after extensions).
 * That day's 08:00 read makes TF6's call and writes it that morning, so an
 * extension lands before the ad set stops and a stop pauses it at that read. With
 * no benchmark nothing is written, and the morning after is the test's last read
 * (TF2 may still find a winner, else "No clear winner by day 4"). A missed end
 * day (no read for it) falls back to the next morning's read, writes included.
 * Never a write after 23:00 London, from a read that doesn't cover the whole of
 * the day before (no successful ad-daily-insights run today), or on any other day.
 *
 * At 08:00 London, for every running test in a {code} · Tests ad set:
 *   1. its variants' spend and results since its ad set started, to yesterday
 *      (ad_daily_insights, restated by the 02:30 UTC ad-daily-insights run);
 *   2. TF5's benchmark over the same days, for the kinds it applies to;
 *   3. TF2's read with TF5 / TF6 (benchmark-call.ts) → one creative_test_reads
 *      row per test per London day (upserted, so a rerun replaces the day's);
 *   4. the decision's write, behind its gates, once per test per decision:
 *      - extend: the ad set's end_time to 23:59 London on day 8 (or 12), after
 *        the extra hold is re-checked against R5's 20 % cap
 *        (lib/meta/adset-end-time-write.ts, ledger op adset_end_time_update);
 *      - stop: the ad set paused (lib/meta/adset-status-write.ts, ledger op
 *        adset_status_update), the test "stopped".
 *      Then the test row: extensions, hold_minor and extension_evidence, or its
 *      state. TF2's own end states (no clear winner, not enough variants) are
 *      recorded with no write; "Ready to call" waits for Matas.
 *
 * Never: a write while a gate is off, a resume, a write to anything but the
 * test's own ad set (its launched_ad_sets row must be source_type
 * "creative_test"), a second extension of the same number, or a test of an
 * archived client. Reads from Meta: none (the figures are the app's rows);
 * writes: at most two POSTs a test, each on the ledger.
 *
 * Killswitch: ENABLE_CREATIVE_TESTS_READ must be exactly "1" for the read.
 * Writes also need CREATIVE_TESTS_READ_WRITES_ENABLED and CREATIVE_TESTS_CREATE_ENABLED
 * exactly "true" (and OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED for a pause). With
 * writes off, the read still lands and the panel shows the decision.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadArchivedClientIds } from "../db/client-status.ts";
import { ReadWritesDisabledError, readWritesEnabled, writeAdSetEndTime, type AdSetEndTimeGraph } from "../meta/adset-end-time-write.ts";
import { AdSetStatusWritesDisabledError, writeAdSetStatus, type AdSetStatusGraph } from "../meta/adset-status-write.ts";
import type { MetaWriteContext } from "../meta/write-idempotency.ts";
import { MOVE_CAP_SHARE, remainingPlan, spendToDate } from "../onsale-refresh/plan-guard.ts";
import { resultsOf, type AdDay } from "./approve.ts";
import { showBenchmark } from "./benchmark.ts";
import { benchmarkApplies, marks, readWithBenchmark, type BenchmarkRead, type ExtensionEvidence } from "./benchmark-call.ts";
import { isLondonReadHour, londonDay, readTest, type FastCallRead, type VariantFigures } from "./fast-call.ts";
import { HOLDS_AD_SET, type TestState } from "./plan.ts";
import type { ResultEvent, TestKind } from "./words.ts";

type Db = Pick<SupabaseClient, "from">;
type Row = Record<string, unknown>;

export const READ_ENV = "ENABLE_CREATIVE_TESTS_READ";

export function readEnabled(env: Record<string, string | undefined>): boolean {
  return env[READ_ENV] === "1";
}

export type ReadGraph = AdSetEndTimeGraph & AdSetStatusGraph;

export type ReadRecord = {
  testId: string;
  eventCode: string;
  readDay: string;
  state: string;
  text: string;
  /** What the decision asked for, and what happened. */
  action: "none" | "extend" | "stop";
  wrote: boolean;
  pending: string | null;
};

export type ReadResult =
  | { ok: true; skippedReason: string }
  | { ok: boolean; readDay: string; tests: number; records: ReadRecord[]; writes: number; errors: { testId: string; error: string }[] };

const str = (row: Row | null | undefined, key: string): string => String(row?.[key] ?? "").trim();
const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

async function all(db: Db, table: string, columns: string, apply: (q: ReturnType<ReturnType<Db["from"]>["select"]>) => unknown, order: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const query = apply(db.from(table).select(columns)) as { order: (c: string, o: { ascending: boolean }) => { range: (a: number, b: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> } };
    const res = await query.order(order, { ascending: true }).range(from, from + 999);
    if (res.error) throw new Error(`${table}: ${res.error.message}`);
    const page = (res.data ?? []) as Row[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** R5: what the 20 % cap has left for more hold, minor units, after every test ad set the event holds now. No budget: no room. */
export function capLeftMinor(input: { budget: number | null; spendToDate: number; heldMinor: number }): number {
  const remaining = remainingPlan(input.budget, input.spendToDate);
  if (remaining == null || remaining <= 0) return 0;
  return Math.max(0, Math.floor(remaining * MOVE_CAP_SHARE * 100) - input.heldMinor);
}

export type ShowDays = (eventCode: string, fromDay: string, toDay: string) => Promise<Row[]>;

/** TF9: no write after 23:00 London on the end day. */
export const WRITE_CUTOFF_HOUR = 23;

export function londonHour(at: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(at));
}

/** Whether today's ad-daily-insights run restated yesterday: a successful run that started on today's London day and wasn't skipped. */
async function insightsRestated(db: Db, readDay: string): Promise<boolean> {
  const res = await db.from("cron_runs").select("cron_name, started_at, ok, detail").eq("cron_name", "ad-daily-insights").order("started_at", { ascending: false }).range(0, 9);
  if (res.error) return false;
  return ((res.data ?? []) as Row[]).some((run) => run.ok === true && londonDay(str(run, "started_at")) === readDay && !((run.detail as Row | null)?.skippedReason));
}

/** TF9: where this read sits against the test's end day. */
export type EndDayPhase = "before" | "end_day" | "after_end";

/** ad_daily_insights rows of every campaign named with the show's code, paged. */
function showDaysFromDb(db: Db, eventCode: string, fromDay: string, toDay: string): Promise<Row[]> {
  return all(db, "ad_daily_insights", "date, meta_ad_id, campaign_name, spend, landing_page_views, registrations, actions", (q) => (q as unknown as { ilike: (c: string, v: string) => { gte: (c: string, v: string) => { lte: (c: string, v: string) => unknown } } }).ilike("campaign_name", `%${eventCode}%`).gte("date", fromDay).lte("date", toDay), "date");
}

export async function runCreativeTestsRead(input: {
  env: Record<string, string | undefined>;
  db: Db;
  graph: ReadGraph | null;
  now?: Date;
  force?: boolean;
  eventCodes?: string[];
  /** The show's ad-days for TF5 (every campaign named with its code), [from, to]. Tests pass a fake; the default reads ad_daily_insights. */
  showDays?: ShowDays;
}): Promise<ReadResult> {
  if (!readEnabled(input.env)) return { ok: true, skippedReason: "killswitch" };
  const now = input.now ?? new Date();
  if (!input.force && !isLondonReadHour(now.toISOString())) return { ok: true, skippedReason: "not_08_london" };
  const { db } = input;
  const readDay = londonDay(now.toISOString());
  const yesterday = addDays(readDay, -1);
  const writesOn = readWritesEnabled(input.env) && input.graph != null;
  // TF9: a write only from a read that covers the whole of yesterday (the 02:30 UTC restate ran today), and never after 23:00 London.
  const covered = await insightsRestated(db, readDay);
  const late = londonHour(now) >= WRITE_CUTOFF_HOUR;

  const running = await all(db, "creative_tests", "*", (q) => (q as unknown as { eq: (c: string, v: string) => { eq: (c: string, v: string) => unknown } }).eq("state", "running").eq("runs_in", "tests_adset"), "id");
  const archived = await loadArchivedClientIds(db as never);
  const records: ReadRecord[] = [];
  const errors: { testId: string; error: string }[] = [];
  let writes = 0;

  for (const test of running) {
    const testId = str(test, "id");
    try {
      const event = (await db.from("events").select("id, event_code, client_id, budget_marketing").eq("id", str(test, "event_id")).maybeSingle()).data as Row | null;
      if (!event) continue;
      if (str(event, "client_id") && archived.has(str(event, "client_id"))) continue;
      const eventCode = str(event, "event_code");
      if (input.eventCodes?.length && !input.eventCodes.includes(eventCode)) continue;
      const record = await readOne(db, { test, event, eventCode, now, readDay, yesterday, writesOn, covered, late, env: input.env, graph: input.graph, showDays: input.showDays ?? ((code, from, to) => showDaysFromDb(db, code, from, to)) });
      if (record.wrote) writes += 1;
      records.push(record);
    } catch (err) {
      errors.push({ testId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { ok: errors.length === 0, readDay, tests: records.length, records, writes, errors };
}

async function readOne(
  db: Db,
  ctx: { test: Row; event: Row; eventCode: string; now: Date; readDay: string; yesterday: string; writesOn: boolean; covered: boolean; late: boolean; env: Record<string, string | undefined>; graph: ReadGraph | null; showDays: ShowDays },
): Promise<ReadRecord> {
  const { test, event, eventCode, now, readDay, yesterday } = ctx;
  const testId = str(test, "id");
  const kind = str(test, "kind") as TestKind;
  const result = (str(test, "result_event") || "initiate_checkout") as ResultEvent;
  const startedAt = str(test, "started_at") || str(test, "approved_at") || now.toISOString();
  const startDay = londonDay(startedAt);

  // 1. The variants' figures, from the ad set's start day to yesterday.
  const variants = (await all(db, "creative_test_variants", "id, position, label, meta_ad_id, state", (q) => (q as unknown as { eq: (c: string, v: string) => unknown }).eq("test_id", testId), "id")).sort((a, b) => num(a.position) - num(b.position));
  const adIds = variants.map((v) => str(v, "meta_ad_id")).filter(Boolean);
  const days = adIds.length ? await all(db, "ad_daily_insights", "date, meta_ad_id, spend, landing_page_views, registrations, actions, campaign_name", (q) => (q as unknown as { in: (c: string, v: string[]) => { gte: (c: string, v: string) => { lte: (c: string, v: string) => unknown } } }).in("meta_ad_id", adIds).gte("date", startDay).lte("date", yesterday), "date") : [];
  const figures: VariantFigures[] = variants.map((v) => {
    const own = days.filter((d) => str(d, "meta_ad_id") === str(v, "meta_ad_id"));
    return { id: str(v, "id"), label: str(v, "label"), spend: Math.round(own.reduce((s, d) => s + num(d.spend), 0) * 100) / 100, results: own.reduce((s, d) => s + resultsOf(d as unknown as AdDay, result), 0), muted: str(v, "state") === "muted" };
  });
  const spent = figures.some((f) => f.spend > 0);
  let firstDeliveryAt = str(test, "first_delivery_at") || null;
  if (!firstDeliveryAt && spent) {
    // The insights are daily, so first delivery is taken as the ad set's start.
    firstDeliveryAt = startedAt;
    const set = await db.from("creative_tests").update({ first_delivery_at: firstDeliveryAt }).eq("id", testId);
    if (set.error) throw new Error(`creative_tests: ${set.error.message}`);
  }

  // TF9: the end day (day 4, 8 or 12), and whether its read ran.
  const extensions = num(test.extensions);
  const endDay = addDays(startDay, 4 * (extensions + 1));
  const phase: EndDayPhase = readDay < endDay ? "before" : readDay === endDay ? "end_day" : "after_end";
  let endDayReadRan = false;
  if (phase === "after_end") {
    const prior = await db.from("creative_test_reads").select("read_day").eq("test_id", testId).eq("read_day", endDay).maybeSingle();
    endDayReadRan = Boolean(prior.data);
  }
  // The missed end day: the next morning's read decides and may write.
  const fallback = phase === "after_end" && !endDayReadRan;
  const decides = phase === "end_day" || fallback;
  const tf2Final = phase === "after_end";

  // 2. TF5's benchmark over the same days, and R5's room, for the kinds it applies to.
  const benchmarked = benchmarkApplies(kind);
  const evidence = (test.extension_evidence ?? null) as ExtensionEvidence | null;
  let read: FastCallRead | BenchmarkRead;
  let bench: { cost: number | null; spend: number; results: number } | null = null;
  if (benchmarked) {
    const showDays = await ctx.showDays(eventCode, startDay, yesterday);
    bench = showBenchmark(showDays as unknown as AdDay[], { eventCode, result, fromDay: startDay, toDay: yesterday });
    const held = (await all(db, "creative_tests", "id, state, hold_minor", (q) => (q as unknown as { eq: (c: string, v: string) => unknown }).eq("event_id", str(event, "id")), "id")).filter((t) => HOLDS_AD_SET.includes(str(t, "state") as TestState)).reduce((s, t) => s + num(t.hold_minor), 0);
    const budget = event.budget_marketing == null || str(event, "budget_marketing") === "" ? null : Number(event.budget_marketing);
    // After an end day whose read ran and didn't extend, the ad set has ended: no extension is possible now, so the call can only stop.
    const capLeft = phase === "after_end" && endDayReadRan ? 0 : capLeftMinor({ budget, spendToDate: budget == null ? 0 : await spendToDate(db as never, str(event, "id")), heldMinor: held });
    read = readWithBenchmark({ firstDeliveryAt, startedAt, readAt: now.toISOString(), variants: figures, result, benchmark: bench.cost, extensions, evidence, dailyMinor: num(test.daily_budget_minor), capLeftMinor: capLeft, currency: str(test, "currency") || null, boundaryReached: phase !== "before", tf2Final });
  } else {
    read = readTest({ firstDeliveryAt, readAt: now.toISOString(), variants: figures, result, final: tf2Final });
  }
  const action = "action" in read ? read.action : { kind: "none" as const };

  // 3. The day's read.
  const row = {
    user_id: str(test, "user_id"),
    test_id: testId,
    read_day: readDay,
    read_at: now.toISOString(),
    hours: read.hours,
    spend_total: read.spendTotal,
    variants: figures.map((f) => ({ variantId: f.id, spend: f.spend, results: f.results, ...(f.muted ? { muted: true } : {}) })),
    state: "stage" in read && read.stage !== "tf2" ? read.stage : read.state,
    leader_variant_id: read.leaderId,
    winner_variant_id: read.winnerId,
    meta_calls: 0,
    not_read: null as string | null,
    ...(benchmarked ? { benchmark_cost: bench?.cost ?? null, benchmark_spend: bench?.spend ?? null, benchmark_results: bench?.results ?? null } : {}),
  };
  const out: ReadRecord = { testId, eventCode, readDay, state: row.state, text: read.text, action: action.kind === "extend" ? "extend" : action.kind === "stop" ? "stop" : "none", wrote: false, pending: null };

  // 4. The decision's write and the test row.
  const whyNot = !decides ? "not an end day" : !ctx.covered ? "yesterday's insights aren't restated yet" : ctx.late ? "after 23:00 London" : null;
  if ((action.kind === "extend" || action.kind === "stop") && whyNot && phase === "after_end" && action.kind === "stop") {
    // TF9: the end day's read ran and wrote nothing; the ad set ended at 23:59, so the stop is recorded with no Meta write.
    const done = await db.from("creative_tests").update({ state: "stopped", ended_at: now.toISOString() }).eq("id", testId).eq("state", "running");
    if (done.error) throw new Error(`creative_tests: ${done.error.message}`);
  } else if ((action.kind === "extend" || action.kind === "stop") && whyNot) {
    out.pending = whyNot;
  } else if (action.kind === "extend" || action.kind === "stop") {
    const adsetId = str(test, "meta_adset_id");
    const launched = adsetId ? ((await db.from("launched_ad_sets").select("meta_adset_id, draft_id, source_type").eq("meta_adset_id", adsetId).maybeSingle()).data as Row | null) : null;
    // Only ever the test's own ad set: never a main campaign's.
    if (!launched || str(launched, "source_type") !== "creative_test") {
      out.pending = "not a creative test ad set";
      row.not_read = out.pending;
    } else if (!ctx.writesOn) {
      out.pending = "writes off";
    } else {
      const ledger: MetaWriteContext = { supabase: db, userId: str(test, "user_id"), draftId: str(launched, "draft_id"), eventId: str(event, "id") };
      try {
        if (action.kind === "extend") {
          await writeAdSetEndTime({ env: ctx.env, ledger, graph: ctx.graph!, adsetId, endTime: action.endTime, key: `creative_test:${testId}:extension:${action.extension}` });
          const kept: ExtensionEvidence = { ...(evidence ?? {}), ...(action.extension === 1 ? { day4: marks((read as BenchmarkRead).variants) } : { day8: marks((read as BenchmarkRead).variants), second: action.earnedBy }) };
          // Once per extension: only from the count before it, so a rerun never adds the hold twice.
          const done = await db.from("creative_tests").update({ extensions: action.extension, hold_minor: num(test.hold_minor) + action.extraHoldMinor, extension_evidence: kept }).eq("id", testId).eq("extensions", action.extension - 1);
          if (done.error) throw new Error(`creative_tests: ${done.error.message}`);
        } else {
          await writeAdSetStatus({ env: ctx.env, ledger, graph: ctx.graph!, adsetId, status: "PAUSED", key: `creative_test:${testId}:stop` });
          const done = await db.from("creative_tests").update({ state: "stopped", ended_at: now.toISOString() }).eq("id", testId).eq("state", "running");
          if (done.error) throw new Error(`creative_tests: ${done.error.message}`);
        }
        out.wrote = true;
      } catch (err) {
        if (err instanceof ReadWritesDisabledError || err instanceof AdSetStatusWritesDisabledError) out.pending = "writes off";
        else {
          row.not_read = err instanceof Error ? err.message : String(err);
          await upsertRead(db, row);
          throw err;
        }
      }
    }
  } else if (read.state === "no_clear_winner" || read.state === "not_enough_variants") {
    // TF2's own end states: recorded, nothing written to Meta (TF-B's pause line is Matas's).
    const done = await db.from("creative_tests").update({ state: read.state, ended_at: now.toISOString() }).eq("id", testId).eq("state", "running");
    if (done.error) throw new Error(`creative_tests: ${done.error.message}`);
  }
  await upsertRead(db, row);
  return out;
}

async function upsertRead(db: Db, row: Record<string, unknown>): Promise<void> {
  const res = await db.from("creative_test_reads").upsert(row, { onConflict: "test_id,read_day" });
  if (res.error) throw new Error(`creative_test_reads: ${res.error.message}`);
}
