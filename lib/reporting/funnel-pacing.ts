import "server-only";

import type { DatePreset } from "@/lib/insights/types";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  assignEventToDashboardTab,
  categorizeEvent,
  isGeographicRegionKey,
  parseClientRegionKey,
  type ClientRegionKey,
} from "@/lib/dashboard/client-regions";
import {
  computeCanonicalEventMetricsByEventCode,
  sumCanonicalEventMetrics,
} from "@/lib/dashboard/canonical-event-metrics";
import { loadEventCodeLifetimeMetaCacheForClient } from "@/lib/db/event-code-lifetime-meta-cache";
import {
  selectLatestSnapshotsByEvent,
  type PatternSnapshotRow,
} from "@/lib/reporting/creative-patterns-snapshots";
import type { CreativePatternRegionFilter } from "@/lib/reporting/creative-patterns-cross-event";
import {
  FALLBACK_FUNNEL_TARGETS,
  FUNNEL_LPV_CLICKS_FALLBACK_RATIO,
  deriveFunnelTargetsFromSoldOutEvents,
  type DerivedFunnelTargets,
  type FunnelRollupInput,
} from "@/lib/reporting/funnel-pacing-derive";
import {
  splitEventCodeLpvByClickShare,
  sumLandingPageViewsFromSharePayload,
  type SnapshotPayloadForLpv,
} from "@/lib/reporting/funnel-pacing-payload";
import type { DailyRollupRow } from "@/lib/db/client-portal-server";

export { sumLandingPageViewsFromSharePayload } from "@/lib/reporting/funnel-pacing-payload";

type ScopeType = "client_region" | "venue_code" | "event_id";
type TargetSource = "manual" | "derived" | "fallback";
type StageStatus = "green" | "amber" | "red";
type FunnelSupabaseClient =
  | Awaited<ReturnType<typeof createClient>>
  | ReturnType<typeof createServiceRoleClient>;

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
  opts: {
    regionFilter?: CreativePatternRegionFilter;
    sinceDays?: number;
    useServiceRole?: boolean;
  } = {},
): Promise<FunnelPacingResult> {
  const supabase = opts.useServiceRole
    ? createServiceRoleClient()
    : await createClient();
  const events = applyRegionFilter(await fetchEvents(supabase, clientId), opts.regionFilter);
  const scope = scopeFromFilter(opts.regionFilter);
  const target = await loadOrCreateTarget(supabase, clientId, scope, events);
  const sinceDays = opts.sinceDays ?? 90;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const eventIds = events.map((event) => event.id);
  const rollups = await fetchRollups(supabase, eventIds, since.toISOString().slice(0, 10));
  const liveEventIds = new Set(
    events
      .filter((event) =>
        ["upcoming", "on_sale", "live"].includes(event.status ?? ""),
      )
      .map((event) => event.id),
  );
  const currentRollups = rollups.filter((row) => liveEventIds.has(row.event_id));
  const codeByEventId = new Map<string, string | null>();
  for (const event of events) codeByEventId.set(event.id, event.event_code);

  // PR #418 (audit Section 5 — kills Cat A + Cat B + Cat F at TOFU):
  // Pre-PR `aggregateRollups` summed `meta_reach` across rollup rows,
  // which N-counts (sibling events share the same campaign-wide reach
  // per day) AND Cat-B-overcounts (daily-deduped reach summed across
  // days ≠ lifetime unique reach). Post-PR the canonical helper
  // resolves reach from `event_code_lifetime_meta_cache` per
  // `event_code`, then sums across the venue codes the live events
  // belong to. Each cache row is a campaign-window dedup so the
  // event_code-level sum is structurally safe.
  const liveEvents = events.filter((event) => liveEventIds.has(event.id));
  const lifetimeCacheRows =
    await loadEventCodeLifetimeMetaCacheForClient(supabase, clientId);
  const baseCurrent = aggregateRollupsWithCanonical(
    currentRollups,
    liveEvents,
    lifetimeCacheRows,
  );
  const lpvByEvent = await resolveLpvByEventIds(
    [...liveEventIds],
    currentRollups,
    sinceDays,
    codeByEventId,
  );
  let lpvTotal = 0;
  for (const id of liveEventIds) {
    lpvTotal += lpvByEvent.get(id) ?? 0;
  }
  const current = { ...baseCurrent, lpv: lpvTotal };

  const scale = Math.max(1, liveEventIds.size);
  const scaledTarget = scaleFunnelTargetVolumes(target, scale);

  const sourceEventName =
    target.derived_from_event_id == null
      ? null
      : events.find((event) => event.id === target.derived_from_event_id)?.name ?? null;

  return {
    scope,
    target,
    sourceEventName,
    updatedAt: target.updated_at ?? target.created_at ?? null,
    stages: buildStages(scaledTarget, current),
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
      const region = assignEventToDashboardTab(event);
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
  supabase: FunnelSupabaseClient,
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
  supabase: FunnelSupabaseClient,
  clientId: string,
  scope: { type: ScopeType; value: string },
  events: EventRow[],
  allowFallback: boolean,
): Promise<FunnelTargetRow> {
  const userId = events[0]?.user_id;
  if (!userId) throw new Error("No events available for funnel pacing scope");

  const soldOutEvents = await resolveFunnelBenchmarkEvents(
    supabase,
    clientId,
    scope,
    events,
  );
  const rollups = await fetchRollups(
    supabase,
    soldOutEvents.map((event) => event.id),
    daysAgoYmd(180),
  );
  const soldOutCodeByEventId = new Map<string, string | null>();
  for (const e of soldOutEvents) soldOutCodeByEventId.set(e.id, e.event_code);
  const lpvByEvent = await resolveLpvByEventIds(
    soldOutEvents.map((e) => e.id),
    rollups,
    180,
    soldOutCodeByEventId,
  );
  const derived = deriveFunnelTargetsFromSoldOutEvents(
    soldOutEvents,
    rollups,
    lpvByEvent,
  );
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
  supabase: FunnelSupabaseClient,
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
  supabase: FunnelSupabaseClient,
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

async function resolveFunnelBenchmarkEvents(
  supabase: FunnelSupabaseClient,
  clientId: string,
  scope: { type: ScopeType; value: string },
  scopedEvents: EventRow[],
): Promise<EventRow[]> {
  if (scope.type !== "client_region") {
    return soldOutBenchmarkEvents(scopedEvents);
  }

  const region = parseClientRegionKey(scope.value);
  if (!region) {
    return soldOutBenchmarkEvents(scopedEvents);
  }

  if (region === "club_football") {
    const sold = soldOutBenchmarkEvents(scopedEvents);
    const leeds = sold.find(
      (e) => (e.event_code ?? "").toUpperCase() === "LEEDS26-FACUP",
    );
    return leeds ? [leeds] : sold;
  }

  if (region === "op_own") {
    return soldOutBenchmarkEvents(scopedEvents);
  }

  if (isGeographicRegionKey(region)) {
    const all = await fetchEvents(supabase, clientId);
    const wcOnly = all.filter((e) => categorizeEvent(e) === "wc26");
    return soldOutBenchmarkEvents(wcOnly);
  }

  return soldOutBenchmarkEvents(scopedEvents);
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
  return events.filter((event) => assignEventToDashboardTab(event) === region);
}

function scopeFromFilter(
  filter: CreativePatternRegionFilter | undefined,
): { type: ScopeType; value: string } {
  if (!filter) return { type: "client_region", value: "all" };
  if (filter.type === "venue_code") return { type: "venue_code", value: filter.value };
  return { type: "client_region", value: filter.value };
}

/**
 * Canonical replacement for the old `aggregateRollups` (PR #418).
 *
 * **Reach** is now sourced from `event_code_lifetime_meta_cache` via
 * the canonical helper. The cache holds one cross-campaign
 * deduplicated number per `(client_id, event_code)`, populated by the
 * cron + admin backfill route which both call the two-pass
 * `fetchEventLifetimeMetaMetrics`. Summing reach across *event_codes*
 * is structurally safe (each cache row is its own campaign-window
 * dedup; two venues' campaigns may share a few overlap users but the
 * audit accepts that ±2-3% drift at venue-aggregate scope — the Cat A
 * + Cat B compounded ~8.74× was the real bug).
 *
 * **Spend / link clicks** come from rollups via the canonical helper's
 * sibling-deduped sum. **Purchases** stays as a per-event-day rollup
 * sum (`tickets_sold`) — the field is per-event correct (provider-
 * sourced delta), no dedup needed.
 *
 * On TOTAL cache miss (no rows for any of the live event_codes the
 * scope covers), `reach` falls through as `null`. The TOFU stage
 * renders `actual=0` + `pacingPct=null` (status `red`) — the audit's
 * preferred posture vs the pre-PR 8x-inflated number.
 */
function aggregateRollupsWithCanonical(
  rows: RollupRow[],
  liveEvents: EventRow[],
  cacheRows: ReadonlyArray<{
    client_id: string;
    event_code: string;
    meta_reach: number | null;
    meta_impressions: number | null;
    meta_link_clicks: number | null;
    meta_regs: number | null;
    meta_video_plays_3s: number | null;
    meta_video_plays_15s: number | null;
    meta_video_plays_p100: number | null;
    meta_engagements: number | null;
    campaign_names: string[];
    fetched_at: string;
    created_at: string;
    updated_at: string;
  }>,
): { spend: number; reach: number; clicks: number; purchases: number } {
  // Group live events + their rollup rows by event_code. Events with
  // no event_code fall through to a synthetic `__nocode__` bucket so
  // their spend / clicks still aggregate (no reach since no cache row
  // can exist without an event_code).
  const NO_CODE = "__nocode__";
  const eventsByCode = new Map<
    string,
    Array<{ id: string; event_code: string | null }>
  >();
  for (const event of liveEvents) {
    const code = event.event_code ?? NO_CODE;
    const list = eventsByCode.get(code) ?? [];
    list.push({ id: event.id, event_code: event.event_code });
    eventsByCode.set(code, list);
  }
  const rollupsByCode = new Map<string, DailyRollupRow[]>();
  const eventIdToCode = new Map<string, string>();
  for (const event of liveEvents) {
    eventIdToCode.set(event.id, event.event_code ?? NO_CODE);
  }
  for (const row of rows) {
    const code = eventIdToCode.get(row.event_id);
    if (!code) continue;
    const list = rollupsByCode.get(code) ?? [];
    list.push(row as unknown as DailyRollupRow);
    rollupsByCode.set(code, list);
  }

  // PR #419 (audit follow-up — Bug 1, +507% Manchester drift):
  // Pre-fix `cacheRows` was the client-wide cache (all 18 venues),
  // and `computeCanonicalEventMetricsByEventCode` UNIONs cache codes
  // with rollup/event codes when building its iteration set. That
  // pulled every venue's cache reach into the result map even when
  // the pacing scope was just one venue, and `sumCanonicalEventMetrics`
  // then summed the lot (Manchester pacing showed 4.89M instead of the
  // 805k cache row).
  //
  // The fix is caller-side: scope `cacheRows` to the same event_codes
  // the live events resolve to (`eventsByCode.keys()`) BEFORE handing
  // to the helper. The helper's union behaviour is preserved for
  // surfaces that intentionally want partial-coverage signal (see the
  // pinned tests in `canonical-event-metrics-pinned.test.ts`).
  const inScopeEventCodes = new Set(eventsByCode.keys());
  const scopedCacheRows = cacheRows.filter((row) =>
    inScopeEventCodes.has(row.event_code),
  );

  const canonicalByCode = computeCanonicalEventMetricsByEventCode({
    cacheRows: scopedCacheRows,
    rollupsByEventCode: rollupsByCode,
    eventsByEventCode: eventsByCode,
  });
  const total = sumCanonicalEventMetrics([...canonicalByCode.values()]);

  // Purchases = per-event tickets_sold sum across the rollup window.
  // Rollup tickets are per-event-day deltas (provider-sourced) so a
  // simple sum is correct.
  let purchases = 0;
  for (const row of rows) purchases += row.tickets_sold ?? 0;

  return {
    spend: total.spend,
    // `reach` from canonical is `number | null`. Pre-PR aggregator
    // returned `number` (always); to keep the FunnelStage signature
    // unchanged we coerce null → 0 — the stage already renders
    // `actual=0` + red status when pacing pct is null.
    reach: total.reach ?? 0,
    clicks: total.linkClicksRollupSum,
    purchases,
  };
}


function scaleFunnelTargetVolumes(row: FunnelTargetRow, scale: number): FunnelTargetRow {
  return {
    ...row,
    tofu_target_reach: scaleVolume(row.tofu_target_reach, scale),
    mofu_target_clicks: scaleVolume(row.mofu_target_clicks, scale),
    bofu_target_lpv: scaleVolume(row.bofu_target_lpv, scale),
    bofu_target_purchases: scaleVolume(row.bofu_target_purchases, scale),
  };
}

function scaleVolume(value: number | null | undefined, scale: number): number | null {
  if (value == null) return null;
  return Math.round(value * scale);
}

/** Matches creative snapshot warming: `last_30d` only when the rollup window is 30 days. */
function funnelSnapshotPresetForWindow(sinceDays: number): DatePreset {
  return sinceDays === 30 ? "last_30d" : "maximum";
}

/**
 * Resolve a per-event LPV map, deduped across sibling events that share
 * an `event_code`.
 *
 * `fetchActiveCreativesForEvent` matches campaigns by `event_code`
 * substring, so every sibling event (e.g. the four WC26 fixtures at one
 * venue) ends up storing the same campaign-wide LPV in its snapshot.
 * The previous implementation summed those duplicates and produced
 * BOFU LPV > MOFU clicks at venue scope (the bug in PR #291). The dedup
 * step here picks one representative LPV per event_code (latest
 * fetched_at — the only thing meaningfully different across snapshots
 * of the same Meta data) and splits it across siblings by their rollup
 * click share so per-event values stay sensible and the scope-level
 * sum equals the real campaign LPV.
 */
async function resolveLpvByEventIds(
  eventIds: string[],
  rollups: RollupRow[],
  sinceDays: number,
  codeByEventId: ReadonlyMap<string, string | null>,
): Promise<Map<string, number>> {
  const preset = funnelSnapshotPresetForWindow(sinceDays);
  const snapshotSums = await fetchSnapshotLpvSumByEvent(eventIds, preset);
  const idSet = new Set(eventIds);
  const clicksByEvent = new Map<string, number>();
  for (const row of rollups) {
    if (!idSet.has(row.event_id)) continue;
    clicksByEvent.set(
      row.event_id,
      (clicksByEvent.get(row.event_id) ?? 0) + (row.link_clicks ?? 0),
    );
  }

  const idsByCode = new Map<string, string[]>();
  const ungrouped: string[] = [];
  for (const id of eventIds) {
    const code = codeByEventId.get(id) ?? null;
    if (!code) {
      ungrouped.push(id);
      continue;
    }
    const list = idsByCode.get(code) ?? [];
    list.push(id);
    idsByCode.set(code, list);
  }

  const out = new Map<string, number>();
  const computeFallback = (id: string): number => {
    const clicks = clicksByEvent.get(id) ?? 0;
    return Math.round(clicks * FUNNEL_LPV_CLICKS_FALLBACK_RATIO);
  };

  for (const id of ungrouped) {
    if (snapshotSums.has(id)) {
      out.set(id, snapshotSums.get(id)!);
    } else {
      out.set(id, computeFallback(id));
    }
  }

  for (const ids of idsByCode.values()) {
    const withSnapshot = ids.filter((id) => snapshotSums.has(id));
    if (withSnapshot.length === 0) {
      for (const id of ids) out.set(id, computeFallback(id));
      continue;
    }
    let codeLpv = 0;
    for (const id of withSnapshot) {
      const v = snapshotSums.get(id) ?? 0;
      if (v > codeLpv) codeLpv = v;
    }
    const split = splitEventCodeLpvByClickShare(ids, codeLpv, clicksByEvent);
    for (const [id, value] of split) out.set(id, value);
  }

  return out;
}

type ActiveCreativesSnapRow = PatternSnapshotRow & {
  payload: SnapshotPayloadForLpv;
};

async function fetchSnapshotLpvSumByEvent(
  eventIds: string[],
  preset: DatePreset,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (eventIds.length === 0) return result;

  const sr = createServiceRoleClient();
  const chunkSize = 120;
  for (let i = 0; i < eventIds.length; i += chunkSize) {
    const chunk = eventIds.slice(i, i + chunkSize);
    const { data, error } = await sr
      .from("active_creatives_snapshots")
      .select("event_id,payload,fetched_at,build_version")
      .in("event_id", chunk)
      .eq("date_preset", preset)
      .order("fetched_at", { ascending: false })
      .limit(8000);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ActiveCreativesSnapRow[];
    const latest = selectLatestSnapshotsByEvent(rows);
    for (const row of latest) {
      result.set(row.event_id, sumLandingPageViewsFromSharePayload(row.payload));
    }
  }
  return result;
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

function targetTable(supabase: FunnelSupabaseClient) {
  // Generated Supabase types lag new migrations in this repo; keep the
  // untyped escape hatch local to the new table.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase.from("event_funnel_targets" as never) as any;
}
