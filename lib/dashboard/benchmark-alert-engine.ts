/**
 * Nightly benchmark sweep for `benchmark_alerts` (Meta snapshots + rollups).
 * GET /api/cron/benchmark-alerts (service role).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TablesInsert } from "@/lib/db/database.types";
import type { ConceptGroupRow } from "@/lib/reporting/group-creatives";
import type { ShareActiveCreativesResult } from "@/lib/reporting/share-active-creatives";

const DATE_PRESET = "last_14d" as const;

export interface BenchmarkAlertThresholds {
  fatigueFrequencyMin: number;
  fatigueCtrRatio: number;
  scalingCpcRatio: number;
  scalingMinClicks: number;
  cpaRatioCritical: number;
  stalledSpendMin: number;
  audienceCpcHighRatio: number;
  audienceCpcLowRatio: number;
  audienceMinSpend: number;
  breakoutMinRegs: number;
}

export function loadBenchmarkAlertThresholds(): BenchmarkAlertThresholds {
  const env = (k: string, d: number) => {
    const v = process.env[k];
    if (v == null || v === "") return d;
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  return {
    fatigueFrequencyMin: env("BENCHMARK_ALERT_FATIGUE_FREQ_MIN", 3.5),
    fatigueCtrRatio: env("BENCHMARK_ALERT_FATIGUE_CTR_RATIO", 0.7),
    scalingCpcRatio: env("BENCHMARK_ALERT_SCALING_CPC_RATIO", 0.5),
    scalingMinClicks: env("BENCHMARK_ALERT_SCALING_MIN_CLICKS", 1000),
    cpaRatioCritical: env("BENCHMARK_ALERT_CPA_RATIO", 2),
    stalledSpendMin: env("BENCHMARK_ALERT_STALLED_SPEND_MIN", 100),
    audienceCpcHighRatio: env("BENCHMARK_ALERT_AUDIENCE_CPC_HIGH_RATIO", 2.5),
    audienceCpcLowRatio: env("BENCHMARK_ALERT_AUDIENCE_CPC_LOW_RATIO", 0.5),
    audienceMinSpend: env("BENCHMARK_ALERT_AUDIENCE_MIN_SPEND", 50),
    breakoutMinRegs: env("BENCHMARK_ALERT_BREAKOUT_MIN_REGS", 25),
  };
}

export interface BenchmarkSweepSummary {
  ok: boolean;
  clientsConsidered: number;
  clientsProcessed: number;
  alertsInserted: number;
  alertsDismissed: number;
  errors: string[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function pctDev(metric: number, bench: number): number | null {
  if (!Number.isFinite(metric) || !Number.isFinite(bench) || bench === 0) return null;
  return ((metric - bench) / bench) * 100;
}

function alertKey(a: string, e: string, i: string): string {
  return `${a}\0${e}\0${i}`;
}

function asOk(p: unknown): Extract<ShareActiveCreativesResult, { kind: "ok" }> | null {
  if (!p || typeof p !== "object") return null;
  if ((p as { kind?: string }).kind !== "ok") return null;
  return p as Extract<ShareActiveCreativesResult, { kind: "ok" }>;
}

type AdsetAgg = { spend: number; clicks: number; name: string | null };

function accumulateAdsetBuckets(groups: ConceptGroupRow[]): Map<string, AdsetAgg> {
  const map = new Map<string, AdsetAgg>();
  for (const g of groups) {
    const ids = g.adsets ?? [];
    const n = Math.max(1, ids.length);
    for (const a of ids) {
      const cur = map.get(a.id) ?? { spend: 0, clicks: 0, name: a.name };
      cur.spend += g.spend / n;
      cur.clicks += g.clicks / n;
      if (!cur.name && a.name) cur.name = a.name;
      map.set(a.id, cur);
    }
  }
  return map;
}

export async function runBenchmarkAlertSweep(
  supabase: SupabaseClient,
  thresholds: BenchmarkAlertThresholds = loadBenchmarkAlertThresholds(),
): Promise<BenchmarkSweepSummary> {
  const summary: BenchmarkSweepSummary = {
    ok: true,
    clientsConsidered: 0,
    clientsProcessed: 0,
    alertsInserted: 0,
    alertsDismissed: 0,
    errors: [],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: clientRows, error: clientErr } = await db
    .from("clients")
    .select("id, user_id, status")
    .eq("status", "active");
  if (clientErr) {
    summary.ok = false;
    summary.errors.push(clientErr.message);
    return summary;
  }
  const clients = (clientRows ?? []) as Array<{ id: string; user_id: string }>;
  summary.clientsConsidered = clients.length;
  for (const client of clients) {
    try {
      const r = await processClient(db, client, thresholds);
      summary.clientsProcessed += 1;
      summary.alertsInserted += r.inserted;
      summary.alertsDismissed += r.dismissed;
    } catch (e) {
      summary.ok = false;
      summary.errors.push(`client=${client.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return summary;
}

async function processClient(
  db: SupabaseClient,
  client: { id: string; user_id: string },
  t: BenchmarkAlertThresholds,
): Promise<{ inserted: number; dismissed: number }> {
  let inserted = 0;
  let dismissed = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = db as any;
  const { data: evRows } = await sb
    .from("events")
    .select("id, meta_campaign_id")
    .eq("client_id", client.id);
  const events = (evRows ?? []) as Array<{ id: string; meta_campaign_id: string | null }>;
  if (events.length === 0) return { inserted: 0, dismissed: 0 };
  const eventIds = events.map((e) => e.id);
  const { data: snapRows, error: snapErr } = await sb
    .from("active_creatives_snapshots")
    .select("event_id, payload, fetched_at")
    .in("event_id", eventIds)
    .eq("date_preset", DATE_PRESET)
    .is("custom_since", null)
    .is("custom_until", null)
    .order("fetched_at", { ascending: false });
  if (snapErr) throw new Error(snapErr.message);
  const latestByEvent = new Map<string, Extract<ShareActiveCreativesResult, { kind: "ok" }>>();
  for (const row of snapRows ?? []) {
    const eid = row.event_id as string;
    if (latestByEvent.has(eid)) continue;
    const ok = asOk(row.payload);
    if (ok) latestByEvent.set(eid, ok);
  }
  const canEvaluateCreatives = (): boolean => latestByEvent.size > 0;
  const allGroups: Array<{ eventId: string; group: ConceptGroupRow }> = [];
  for (const [eventId, payload] of latestByEvent) {
    for (const group of payload.groups) allGroups.push({ eventId, group });
  }
  const cpcs = allGroups.map(({ group: g }) => g.cpc).filter((x): x is number => x != null && Number.isFinite(x) && x > 0);
  const ctrs = allGroups.map(({ group: g }) => g.ctr).filter((x): x is number => x != null && Number.isFinite(x));
  const cprs = allGroups.filter(({ group: g }) => g.registrations >= 1 && g.cpr != null).map(({ group: g }) => g.cpr as number);
  const medianCpc = median(cpcs);
  const medianCtr = median(ctrs);
  const medianCpr = median(cprs);
  const adsetBuckets = accumulateAdsetBuckets(allGroups.map((x) => x.group));
  const adsetCpcs: number[] = [];
  for (const [, agg] of adsetBuckets) {
    if (agg.clicks < 10 || agg.spend < 5) continue;
    const cpc = agg.spend / agg.clicks;
    if (Number.isFinite(cpc)) adsetCpcs.push(cpc);
  }
  const medianAdsetCpc = median(adsetCpcs);
  const activeKeys = new Set<string>();
  async function insertAlert(row: TablesInsert<"benchmark_alerts">) {
    activeKeys.add(alertKey(row.alert_type as string, row.entity_type as string, row.entity_id));
    const { error } = await sb.from("benchmark_alerts").insert(row);
    if (error?.code === "23505") return;
    if (error) throw new Error(error.message);
    inserted += 1;
  }
  for (const { eventId, group: g } of allGroups) {
    if (g.any_ad_active === false) continue;
    const name = g.display_name || g.ad_names[0] || "Creative";
    if (medianCtr != null && g.frequency != null && g.frequency > t.fatigueFrequencyMin && g.ctr != null && g.ctr < medianCtr * t.fatigueCtrRatio) {
      await insertAlert({
        user_id: client.user_id, client_id: client.id, event_id: eventId, alert_type: "creative_fatigue",
        entity_type: "creative_concept", entity_id: g.group_key, entity_name: name, metric: "ctr",
        metric_value: g.ctr, benchmark_value: medianCtr, deviation_pct: pctDev(g.ctr, medianCtr),
        severity: "warning", status: "open",
      });
    }
    if (medianCpc != null && g.cpc != null && g.cpc < medianCpc * t.scalingCpcRatio && g.clicks > t.scalingMinClicks) {
      await insertAlert({
        user_id: client.user_id, client_id: client.id, event_id: eventId, alert_type: "creative_scaling",
        entity_type: "creative_concept", entity_id: g.group_key, entity_name: name, metric: "cpc",
        metric_value: g.cpc, benchmark_value: medianCpc, deviation_pct: pctDev(g.cpc, medianCpc),
        severity: "info", status: "open",
      });
    }
    if (medianCpr != null && g.registrations >= 3 && g.cpr != null && g.cpr > medianCpr * t.cpaRatioCritical) {
      await insertAlert({
        user_id: client.user_id, client_id: client.id, event_id: eventId, alert_type: "audience_underperform",
        entity_type: "creative_concept", entity_id: g.group_key, entity_name: name, metric: "cpa",
        metric_value: g.cpr, benchmark_value: medianCpr, deviation_pct: pctDev(g.cpr, medianCpr),
        severity: "critical", status: "open",
      });
    }
  }
  if (medianAdsetCpc != null) {
    for (const [adsetId, agg] of adsetBuckets) {
      if (agg.spend < t.audienceMinSpend || agg.clicks < 5) continue;
      const cpc = agg.spend / agg.clicks;
      if (!Number.isFinite(cpc)) continue;
      const eventIdForAdset = inferPrimaryEventForAdset(allGroups, adsetId);
      if (cpc > medianAdsetCpc * t.audienceCpcHighRatio) {
        await insertAlert({
          user_id: client.user_id, client_id: client.id, event_id: eventIdForAdset, alert_type: "audience_underperform",
          entity_type: "adset", entity_id: adsetId, entity_name: agg.name, metric: "cpc",
          metric_value: cpc, benchmark_value: medianAdsetCpc, deviation_pct: pctDev(cpc, medianAdsetCpc),
          severity: "warning", status: "open",
        });
      }
      if (cpc < medianAdsetCpc * t.audienceCpcLowRatio && agg.spend > t.audienceMinSpend) {
        await insertAlert({
          user_id: client.user_id, client_id: client.id, event_id: eventIdForAdset, alert_type: "audience_outperform",
          entity_type: "adset", entity_id: adsetId, entity_name: agg.name, metric: "cpc",
          metric_value: cpc, benchmark_value: medianAdsetCpc, deviation_pct: pctDev(cpc, medianAdsetCpc),
          severity: "info", status: "open",
        });
      }
    }
  }
  const yesterday = utcYmdDaysAgo(1);
  const { data: rollupRows } = await sb
    .from("event_daily_rollups")
    .select("event_id, date, ad_spend, meta_regs")
    .eq("user_id", client.user_id)
    .in("event_id", eventIds)
    .eq("date", yesterday);
  const rollByEventDate = new Map<string, { spend: number; regs: number }>();
  for (const r of rollupRows ?? []) {
    rollByEventDate.set(`${r.event_id as string}\0${r.date as string}`, {
      spend: Number(r.ad_spend ?? 0),
      regs: Number(r.meta_regs ?? 0),
    });
  }
  for (const ev of events) {
    const y = rollByEventDate.get(`${ev.id}\0${yesterday}`);
    if (!y) continue;
    const { spend: spendY, regs: regsY } = y;
    if (spendY >= t.stalledSpendMin && regsY === 0 && ev.meta_campaign_id?.trim()) {
      await insertAlert({
        user_id: client.user_id, client_id: client.id, event_id: ev.id, alert_type: "campaign_stalled",
        entity_type: "campaign", entity_id: ev.meta_campaign_id.trim(), entity_name: "Meta campaign",
        metric: "conversions", metric_value: regsY, benchmark_value: null, deviation_pct: null,
        severity: "warning", status: "open",
      });
    }
    if (regsY >= t.breakoutMinRegs && spendY > 0 && ev.meta_campaign_id?.trim()) {
      await insertAlert({
        user_id: client.user_id, client_id: client.id, event_id: ev.id, alert_type: "campaign_breakout",
        entity_type: "campaign", entity_id: ev.meta_campaign_id.trim(), entity_name: "Meta campaign",
        metric: "registrations", metric_value: regsY, benchmark_value: null, deviation_pct: null,
        severity: "info", status: "open",
      });
    }
  }
  const { data: openRows } = await sb
    .from("benchmark_alerts")
    .select("id, alert_type, entity_type, entity_id, event_id")
    .eq("user_id", client.user_id)
    .eq("client_id", client.id)
    .eq("status", "open");
  for (const row of openRows ?? []) {
    const entityType = row.entity_type as string;
    const eventId = row.event_id as string | null;
    if (entityType !== "campaign" && !canEvaluateCreatives()) continue;
    if (entityType === "campaign" && eventId) {
      if (!rollByEventDate.get(`${eventId}\0${yesterday}`)) continue;
    }
    const k = alertKey(row.alert_type as string, entityType, row.entity_id as string);
    if (!activeKeys.has(k)) {
      const { error } = await sb.from("benchmark_alerts").update({ status: "dismissed", acknowledged_at: null }).eq("id", row.id);
      if (!error) dismissed += 1;
    }
  }
  return { inserted, dismissed };
}

function utcYmdDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function inferPrimaryEventForAdset(
  grouped: Array<{ eventId: string; group: ConceptGroupRow }>,
  adsetId: string,
): string | null {
  const spendByEvent = new Map<string, number>();
  for (const { eventId, group: g } of grouped) {
    if (!g.adsets.some((a) => a.id === adsetId)) continue;
    spendByEvent.set(eventId, (spendByEvent.get(eventId) ?? 0) + g.spend);
  }
  let best: string | null = null;
  let max = 0;
  for (const [eid, sp] of spendByEvent) {
    if (sp > max) {
      max = sp;
      best = eid;
    }
  }
  return best;
}
