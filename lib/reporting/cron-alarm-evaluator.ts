/**
 * The watcher. Reads what each cron recorded, decides which zeros are
 * faults, and says so in Slack once a day per condition.
 *
 * DB-only by construction: the rollup legs record the evidence they saw
 * (claimed campaign ids, spend observed) into `cron_runs.detail`, so this
 * never has to call Meta to judge a zero. That keeps the watcher cheap,
 * fast and immune to the rate limits of the thing it is watching.
 *
 * It records its own `cron_runs` row. If the watcher stops, nothing else
 * can report that — every other alarm depends on it — so it is in
 * CRON_ALARMS like everything else.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { notify } from "../notify/slack.ts";
import type { NotifyOptions, NotifyResult } from "../notify/slack.ts";
import { ARCHIVED } from "../db/client-status.ts";
import {
  ALERT_DEDUPE_WINDOW_MS,
  CRON_ALARMS,
  ROLLUP_SPEND_LOOKBACK_DAYS,
  TIER_CHANNEL_WINDOW_DAYS,
  alarmDedupeKey,
  type AlarmCondition,
} from "./cron-alarm-config.ts";
import { evaluateCronAlarms, type AlarmEvidence, type CronRunFact } from "./cron-alarm-rules.ts";
import { recordCronRun } from "./cron-run-log.ts";

export const CRON_ALARM_EVALUATOR_NAME = "cron-alarm-evaluator";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

export interface EvaluatorResult {
  ok: boolean;
  conditions: AlarmCondition[];
  alerted: { dedupeKey: string; result: NotifyResult }[];
  evidence: Omit<AlarmEvidence, "latestRunByCron">;
  cronsSeen: number;
}

/** Latest run per cron name, across the longest window any spec cares about. */
async function loadLatestRuns(db: Db, now: Date): Promise<Map<string, CronRunFact>> {
  const longest = Math.max(...CRON_ALARMS.map((s) => s.intervalMinutes)) * 4;
  const since = new Date(now.getTime() - longest * 60_000).toISOString();
  const latest = new Map<string, CronRunFact>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("cron_runs")
      .select("cron_name, started_at, ok, rows_written, rows_considered, detail")
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(`cron_runs read failed: ${error.message}`);
    const page = data ?? [];
    for (const row of page as Record<string, unknown>[]) {
      const name = String(row.cron_name);
      // Ordered newest first, so the first sighting of a name is its latest run.
      if (latest.has(name)) continue;
      latest.set(name, {
        cronName: name,
        startedAt: String(row.started_at),
        ok: Boolean(row.ok),
        rowsWritten: Number(row.rows_written ?? 0),
        rowsConsidered: Number(row.rows_considered ?? 0),
        detail: (row.detail ?? {}) as Record<string, unknown>,
      });
    }
    if (page.length < 1000) break;
  }
  return latest;
}

/**
 * The three evidence counts, all excluding archived clients BY RULE —
 * an archived client must never make a cron look broken, and the next one
 * archived has to behave the same without anybody editing this file.
 */
async function loadEvidence(db: Db, now: Date): Promise<Omit<AlarmEvidence, "latestRunByCron">> {
  const today = now.toISOString().slice(0, 10);
  const spendSince = new Date(now.getTime() - ROLLUP_SPEND_LOOKBACK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const tierCutoff = new Date(now.getTime() - TIER_CHANNEL_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const { data: archivedRows } = await db.from("clients").select("id").eq("status", ARCHIVED);
  const archived = new Set((archivedRows ?? []).map((r: { id: string }) => r.id));

  // (1) Events whose rollup saw Meta spend in the lookback window.
  const { data: spendRows } = await db
    .from("event_daily_rollups")
    .select("event_id, ad_spend, events!inner(client_id)")
    .gte("date", spendSince)
    .gt("ad_spend", 0);
  const spendEvents = new Set<string>();
  for (const row of (spendRows ?? []) as Record<string, unknown>[]) {
    const ev = row.events as { client_id?: string } | { client_id?: string }[] | null;
    const clientId = (Array.isArray(ev) ? ev[0]?.client_id : ev?.client_id) ?? null;
    if (clientId && archived.has(clientId)) continue;
    spendEvents.add(String(row.event_id));
  }

  // (2) Events with a ticket source whose show has not happened yet.
  const { data: connRows } = await db
    .from("client_ticketing_connections")
    .select("client_id")
    .eq("status", "active");
  const sourcedClients = new Set(
    (connRows ?? [])
      .map((r: { client_id: string }) => r.client_id)
      .filter((id: string) => !archived.has(id)),
  );
  let eventsExpectingTickets = 0;
  if (sourcedClients.size > 0) {
    const { count } = await db
      .from("events")
      .select("id", { count: "exact", head: true })
      .in("client_id", [...sourcedClients])
      .gte("event_date", today);
    eventsExpectingTickets = count ?? 0;
  }

  // (3) Events with tier-channel sales still inside the snapshot window.
  const { data: tcsRows } = await db
    .from("tier_channel_sales")
    .select("event_id, events!inner(client_id, event_date)")
    .limit(1000);
  const inWindow = new Set<string>();
  for (const row of (tcsRows ?? []) as Record<string, unknown>[]) {
    const ev = row.events as { client_id?: string; event_date?: string | null } | null;
    const rel = Array.isArray(ev) ? ev[0] : ev;
    if (!rel) continue;
    if (rel.client_id && archived.has(rel.client_id)) continue;
    if (!rel.event_date || rel.event_date >= tierCutoff) inWindow.add(String(row.event_id));
  }

  return {
    eventsWithRecentMetaSpend: spendEvents.size,
    eventsExpectingTickets,
    eventsInTierChannelWindow: inWindow.size,
  };
}

function describe(condition: AlarmCondition): string {
  if (condition.kind === "not_reporting") {
    const seen = condition.lastSeenAt ? `last seen ${condition.lastSeenAt}` : "never reported";
    return `:rotating_light: *${condition.cronName}* has not reported — ${seen} (due after ${condition.dueAfterMinutes} min).`;
  }
  return `:warning: *${condition.cronName}* wrote 0 rows, which is implausible — ${condition.reason}.`;
}

export async function runCronAlarmEvaluator(
  db: Db,
  deps: { notify: (opts: NotifyOptions) => Promise<NotifyResult>; now?: Date },
): Promise<EvaluatorResult> {
  const now = deps.now ?? new Date();
  const startedAt = now.toISOString();
  let conditions: AlarmCondition[] = [];
  const alerted: { dedupeKey: string; result: NotifyResult }[] = [];
  let evidence: Omit<AlarmEvidence, "latestRunByCron"> = {
    eventsWithRecentMetaSpend: 0,
    eventsExpectingTickets: 0,
    eventsInTierChannelWindow: 0,
  };
  let cronsSeen = 0;
  let ok = true;
  let error: string | null = null;

  try {
    const [latestRunByCron, loaded] = await Promise.all([loadLatestRuns(db, now), loadEvidence(db, now)]);
    evidence = loaded;
    cronsSeen = latestRunByCron.size;
    conditions = evaluateCronAlarms({ ...loaded, latestRunByCron }, now);

    for (const condition of conditions) {
      const dedupeKey = alarmDedupeKey(condition);
      const result = await deps.notify({
        channel: "ads_ops",
        text: describe(condition),
        dedupeKey,
        dedupeWindowMs: ALERT_DEDUPE_WINDOW_MS,
      });
      alerted.push({ dedupeKey, result });
    }
  } catch (err) {
    ok = false;
    error = err instanceof Error ? err.message : String(err);
    console.error(`[cron-alarm-evaluator] ${error}`);
  }

  // The watcher logs itself like any other cron. `rowsWritten` is the
  // number of alarms raised: zero is the healthy case here, which is why
  // this entry's zeroRule is "never".
  await recordCronRun(db, {
    cronName: CRON_ALARM_EVALUATOR_NAME,
    startedAt,
    ok,
    rowsWritten: conditions.length,
    rowsConsidered: cronsSeen,
    detail: { evidence, conditions },
    error,
  });

  return { ok, conditions, alerted, evidence, cronsSeen };
}

export { notify };
