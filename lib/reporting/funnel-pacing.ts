import "server-only";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  bucketEventToClientRegion,
  parseClientRegionKey,
  type ClientRegionKey,
} from "@/lib/dashboard/client-regions";
import type { CreativePatternRegionFilter } from "@/lib/reporting/creative-patterns-cross-event";
import {
  FALLBACK_FUNNEL_TARGETS,
  deriveFunnelTargetsFromSoldOutEvents,
  rollupSpend,
  type DerivedFunnelTargets,
  type FunnelRollupInput,
} from "@/lib/reporting/funnel-pacing-derive";

type ScopeType = "client_region" | "venue_code" | "event_id";
type TargetSource = "manual" | "derived" | "fallback";
type StageStatus = "green" | "amber" | "red";

export interface FunnelPacingResult {
  scope: { type: ScopeType; value: string };
  target: FunnelTargetRow;
  sourceEventName: string | null;
  stages: FunnelStage[];
  updatedAt: string | null;
}

export interface FunnelStage {
  key: "tofu" | "mofu" | "bofu" | "sale";
  label: string;
  description: string;
  metricLabel: string;
  actual: number;
  target: number | null;
  pacingPct: number | null;
  status: StageStatus;
  spendActual: number;
  spendTarget: number | null;
}

interface EventRow {
  id: string;
  user_id: string;
  client_id: string;
  name: string;
  event_code: string | null;
  event_date: string | null;
  venue_city: string | null;
  venue_country: string | null;
  capacity: number | null;
  tickets_sold: number | null;
  status: string | null;
}

interface RollupRow extends FunnelRollupInput {
  date: string;
  meta_reach: number | null;
}

interface FunnelTargetRow {
  id?: string;
  user_id: string;
  client_id: string;
  scope_type: ScopeType;
  scope_value: string;
  tofu_target_reach: number | null;
  tofu_target_cpm: number | null;
  mofu_target_clicks: number | null;
  mofu_target_cpc: number | null;
  bofu_target_lpv: number | null;
  bofu_target_cplpv: number | null;
  bofu_target_purchases: number | null;
  bofu_target_cpa: number | null;
  tofu_to_mofu_rate: number | null;
  mofu_to_bofu_rate: number | null;
  bofu_to_sale_rate: number | null;
  source: TargetSource;
  derived_from_event_id: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export async function buildClientFunnelPacing(
  clientId: string,
  opts: { regionFilter?: CreativePatternRegionFilter; sinceDays?: number } = {},
): Promise<FunnelPacingResult> {
  const supabase = await createClient();
  const events = applyRegionFilter(await fetchEvents(supabase, clientId), opts.regionFilter);
  const scope = scopeFromFilter(opts.regionFilter);
  const target = await loadOrCreateTarget(supabase, clientId, scope, events);
  const since = new Date(Date.now() - (opts.sinceDays ?? 90) * 24 * 60 * 60 * 1000);
  const eventIds = events.map((event) => event.id);
  const rollups = await fetchRollups(supabase, eventIds, since.toISOString().slice(0, 10));
  const liveEventIds = new Set(
    events
      .filter((event) =>
        ["upcoming", "announced", "on_sale", "live"].includes(event.status ?? ""),
      )
      .map((event) => event.id),
  );
  const currentRollups = rollups.filter((row) => liveEventIds.has(row.event_id));
  const current = aggregateRollups(currentRollups);
  const sourceEventName =
    target.derived_from_event_id == null
      ? null
      : events.find((event) => event.id === target.derived_from_event_id)?.name ?? null;

  return {
    scope,
    target,
    sourceEventName,
    updatedAt: target.updated_at ?? target.created_at ?? null,
    stages: buildStages(target, current),
  };
}

export async function refreshDerivedFunnelPacingTargets(): Promise<{
  clients: number;
  refreshed: number;
}> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id")
    .limit(1000);
  if (error) throw new Error(error.message);

  let refreshed = 0;
  for (const client of (data ?? []) as Array<{ id: string }>) {
    const events = await fetchEvents(supabase, client.id);
    const grouped = new Map<ClientRegionKey, EventRow[]>();
    for (const event of events) {
      const region = bucketEventToClientRegion(event);
      const list = grouped.get(region) ?? [];
      list.push(event);
      grouped.set(region, list);
    }
    for (const [region, regionEvents] of grouped) {
      await deriveAndUpsertTarget(supabase, client.id, {
        type: "client_region",
        value: region,
      }, regionEvents, false);
      refreshed += 1;
    }
  }

  return { clients: (data ?? []).length, refreshed };
}

function buildStages(
  target: FunnelTargetRow,
  current: { spend: number; reach: number; clicks: number; lpv: number; purchases: number },
): FunnelStage[] {
  return [
    stage("tofu", "TOFU", "Top of Funnel — getting reach in front of new audiences.", "Reach", current.reach, target.tofu_target_reach, current.spend, spendTarget(target.tofu_target_reach, target.tofu_target_cpm, 1000)),
    stage("mofu", "MOFU", "Middle of Funnel — turning attention into qualified traffic.", "Clicks", current.clicks, target.mofu_target_clicks, current.spend, spendTarget(target.mofu_target_clicks, target.mofu_target_cpc)),
    stage("bofu", "BOFU", "Bottom of Funnel — getting landing-page intent ready to convert.", "LPV", current.lpv, target.bofu_target_lpv, current.spend, spendTarget(target.bofu_target_lpv, target.bofu_target_cplpv)),
    stage("sale", "Sale Outcome", "Final conversion — purchases against the sellout benchmark.", "Purchases", current.purchases, target.bofu_target_purchases, current.spend, spendTarget(target.bofu_target_purchases, target.bofu_target_cpa)),
  ];
}

function stage(
  key: FunnelStage["key"],
  label: string,
  description: string,
  metricLabel: string,
  actual: number,
  target: number | null,
  spendActual: number,
  spendTargetValue: number | null,
): FunnelStage {
  const pacingPct = target && target > 0 ? (actual / target) * 100 : null;
  return {
    key,
    label,
    description,
    metricLabel,
    actual,
    target,
    pacingPct,
    status: statusForPct(pacingPct),
    spendActual,
    spendTarget: spendTargetValue,
  };
}

async function loadOrCreateTarget(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string,
  scope: { type: ScopeType; value: string },
  events: EventRow[],
): Promise<FunnelTargetRow> {
  const { data, error } = await targetTable(supabase)
    .select("*")
    .eq("client_id", clientId)
    .eq("scope_type", scope.type)
    .eq("scope_value", scope.value)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data as FunnelTargetRow;

  return deriveAndUpsertTarget(supabase, clientId, scope, events, true);
}

async function deriveAndUpsertTarget(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string,
  scope: { type: ScopeType; value: string },
  events: EventRow[],
  allowFallback: boolean,
): Promise<FunnelTargetRow> {
  const userId = events[0]?.user_id;
  if (!userId) throw new Error("No events available for funnel pacing scope");

  const soldOutEvents = soldOutBenchmarkEvents(events);
  const rollups = await fetchRollups(
    supabase,
    soldOutEvents.map((event) => event.id),
    daysAgoYmd(180),
  );
  const derived = deriveFunnelTargetsFromSoldOutEvents(soldOutEvents, rollups);
  if (!derived && !allowFallback) {
    throw new Error("No sold-out events available for derived funnel pacing target");
  }
  const source: TargetSource = derived ? "derived" : "fallback";
  const target = targetPayload(
    userId,
    clientId,
    scope,
    derived ?? FALLBACK_FUNNEL_TARGETS,
    source,
  );
  const { data, error } = await targetTable(supabase)
    .upsert(target, { onConflict: "client_id,scope_type,scope_value" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as FunnelTargetRow;
}

function targetPayload(
  userId: string,
  clientId: string,
  scope: { type: ScopeType; value: string },
  derived: DerivedFunnelTargets,
  source: TargetSource,
): FunnelTargetRow {
  return {
    user_id: userId,
    client_id: clientId,
    scope_type: scope.type,
    scope_value: scope.value,
    tofu_target_reach: derived.tofu_target_reach,
    tofu_target_cpm: derived.tofu_target_cpm,
    mofu_target_clicks: derived.mofu_target_clicks,
    mofu_target_cpc: derived.mofu_target_cpc,
    bofu_target_lpv: derived.bofu_target_lpv,
    bofu_target_cplpv: derived.bofu_target_cplpv,
    bofu_target_purchases: derived.bofu_target_purchases,
    bofu_target_cpa: derived.bofu_target_cpa,
    tofu_to_mofu_rate: derived.tofu_to_mofu_rate,
    mofu_to_bofu_rate: derived.mofu_to_bofu_rate,
    bofu_to_sale_rate: derived.bofu_to_sale_rate,
    source,
    derived_from_event_id: derived.derived_from_event_id,
  };
}

async function fetchEvents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string,
): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from("events")
    .select("id,user_id,client_id,name,event_code,event_date,venue_city,venue_country,capacity,tickets_sold,status")
    .eq("client_id", clientId)
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as EventRow[];
}

async function fetchRollups(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventIds: string[],
  sinceYmd: string,
): Promise<RollupRow[]> {
  if (eventIds.length === 0) return [];
  const { data, error } = await supabase
    .from("event_daily_rollups")
    .select("event_id,date,ad_spend,ad_spend_allocated,ad_spend_presale,link_clicks,tickets_sold,meta_reach")
    .in("event_id", eventIds)
    .gte("date", sinceYmd)
    .limit(10000);
  if (error) throw new Error(error.message);
  return (data ?? []) as RollupRow[];
}

function applyRegionFilter(
  events: EventRow[],
  filter: CreativePatternRegionFilter | undefined,
): EventRow[] {
  if (!filter) return events;
  if (filter.type === "venue_code") {
    return events.filter((event) => event.event_code === filter.value);
  }
  const region = parseClientRegionKey(filter.value);
  if (!region) return events;
  return events.filter((event) => bucketEventToClientRegion(event) === region);
}

function scopeFromFilter(
  filter: CreativePatternRegionFilter | undefined,
): { type: ScopeType; value: string } {
  if (!filter) return { type: "client_region", value: "all" };
  if (filter.type === "venue_code") return { type: "venue_code", value: filter.value };
  return { type: "client_region", value: filter.value };
}

function aggregateRollups(rows: RollupRow[]) {
  return rows.reduce(
    (sum, row) => ({
      spend: sum.spend + rollupSpend(row),
      reach: sum.reach + (row.meta_reach ?? 0),
      clicks: sum.clicks + (row.link_clicks ?? 0),
      lpv: sum.lpv + (row.link_clicks ?? 0),
      purchases: sum.purchases + (row.tickets_sold ?? 0),
    }),
    { spend: 0, reach: 0, clicks: 0, lpv: 0, purchases: 0 },
  );
}

function soldOutBenchmarkEvents(events: EventRow[]): EventRow[] {
  const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
  return events.filter((event) => {
    const capacity = event.capacity ?? 0;
    const sold = event.tickets_sold ?? 0;
    const eventTime = event.event_date ? new Date(`${event.event_date}T00:00:00Z`).getTime() : 0;
    return capacity > 0 && sold / capacity >= 0.95 && eventTime < Date.now() && eventTime > cutoff;
  });
}

function statusForPct(value: number | null): StageStatus {
  if (value == null || value < 80) return "red";
  if (value < 100) return "amber";
  return "green";
}

function spendTarget(
  target: number | null,
  unitCost: number | null,
  divisor = 1,
): number | null {
  if (!target || !unitCost) return null;
  return (target / divisor) * unitCost;
}

function daysAgoYmd(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function targetTable(supabase: Awaited<ReturnType<typeof createClient>>) {
  // Generated Supabase types lag new migrations in this repo; keep the
  // untyped escape hatch local to the new table.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase.from("event_funnel_targets" as never) as any;
}
