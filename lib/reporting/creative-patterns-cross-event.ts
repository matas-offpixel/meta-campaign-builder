import "server-only";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  CREATIVE_TAG_DIMENSIONS,
  type CreativeTagDimension,
} from "@/lib/db/creative-tags";
import type { DatePreset } from "@/lib/insights/types";
import type { ShareActiveCreativesResult } from "@/lib/reporting/share-active-creatives";
import type { ConceptGroupRow } from "@/lib/reporting/group-creatives";
import { selectLatestSnapshotsByEvent } from "@/lib/reporting/creative-patterns-snapshots";
import {
  bucketEventToClientRegion,
  parseClientRegionKey,
  type ClientRegionKey,
} from "@/lib/dashboard/client-regions";

const PAGE_SIZE = 1000;
const DEFAULT_SINCE_DAYS = 90;
const TOP_CREATIVE_LIMIT = 3;
const REGISTRATION_PHASE_RE = /(?:PRESALE|SIGNUP|LEAD)/i;

export type CreativePatternPhase = "registration" | "ticket_sale";
export type CreativePatternRegionFilter =
  | { type: "country"; value: string }
  | { type: "venue_code"; value: string };

export interface ConceptThumb {
  event_id: string;
  event_name: string | null;
  event_code: string | null;
  creative_name: string;
  ad_id: string;
  ad_names: string[];
  thumbnail_url: string | null;
  preview_image_url: string | null;
  preview_permalink_url: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpm: number | null;
  cpa: number | null;
  total_regs: number;
  total_purchases: number;
  tags: Array<{
    dimension: CreativeTagDimension;
    value_key: string;
    value_label: string;
  }>;
  active_since: string;
  active_until: string;
}

export interface TileRow {
  value_key: string;
  value_label: string;
  total_spend: number;
  total_purchases: number;
  total_regs: number;
  total_impressions: number;
  total_clicks: number;
  total_reach: number;
  lpv_count: number;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  cplpv: number | null;
  cpa: number | null;
  cpreg: number | null;
  cpp: number | null;
  roas: number | null;
  frequency: number | null;
  ad_count: number;
  event_count: number;
  top_creatives: ConceptThumb[];
}

export interface CreativePatternDimension {
  dimension: CreativeTagDimension;
  values: TileRow[];
}

export interface CreativePatternsSummary {
  clientId: string;
  eventCount: number;
  taggedEventCount: number;
  tagAssignmentCount: number;
  totalSpend: number;
  phaseSpend: number;
  totalAdConcepts: number;
  highestCpaDimension: {
    dimension: CreativeTagDimension;
    cpa: number;
  } | null;
  since: string;
  until: string;
  sinceDays: number;
  rollupRowsRead: number;
  assignmentRowsRead: number;
  snapshotRowsRead: number;
}

export interface ClientCreativePatternsResult {
  dimensions: CreativePatternDimension[];
  summary: CreativePatternsSummary;
}

interface EventRow {
  id: string;
  name: string | null;
  event_date: string | null;
  event_code: string | null;
  venue_city: string | null;
  venue_country: string | null;
}

interface AssignmentRow {
  event_id: string;
  creative_name: string;
  tag_id: string;
  tag:
    | {
        dimension: CreativeTagDimension | null;
        value_key: string | null;
        value_label: string | null;
      }
    | Array<{
        dimension: CreativeTagDimension | null;
        value_key: string | null;
        value_label: string | null;
      }>
    | null;
}

interface SnapshotRow {
  event_id: string;
  payload: ShareActiveCreativesResult;
  fetched_at: string;
  build_version: string | null;
}

interface RollupRow {
  event_id: string;
  date: string;
  ad_spend: number | null;
  ad_spend_allocated: number | null;
  ad_spend_presale: number | null;
}

interface TileAccumulator {
  dimension: CreativeTagDimension;
  value_key: string;
  value_label: string;
  total_spend: number;
  total_purchases: number;
  total_regs: number;
  total_impressions: number;
  total_clicks: number;
  total_reach: number;
  total_lpv: number;
  ad_count: number;
  eventIds: Set<string>;
  top_creatives: ConceptThumb[];
}

export async function buildClientCreativePatterns(
  clientId: string,
  opts: {
    sinceDays?: number;
    phase?: CreativePatternPhase;
    regionFilter?: CreativePatternRegionFilter;
  } = {},
): Promise<ClientCreativePatternsResult> {
  const sinceDays = opts.sinceDays ?? DEFAULT_SINCE_DAYS;
  const phase = opts.phase ?? "ticket_sale";
  const until = new Date();
  const since = new Date(until.getTime() - sinceDays * 24 * 60 * 60 * 1000);
  const sinceYmd = toYmd(since);
  const untilYmd = toYmd(until);
  const supabase = await createClient();

  const events = applyRegionFilter(
    await fetchClientEvents(supabase, clientId),
    opts.regionFilter,
  );
  const eventIds = events.map((event) => event.id);
  const eventById = new Map(events.map((event) => [event.id, event]));
  const snapshotClient = createServiceRoleClient();

  const [assignments, snapshots, rollups] = await Promise.all([
    fetchAssignments(supabase, eventIds),
    fetchLatestSnapshots(snapshotClient, eventIds, sinceDays),
    fetchRollups(supabase, eventIds, sinceYmd, untilYmd),
  ]);
  console.log("[creative-patterns] snapshot-fetch", {
    requested: eventIds.length,
    returned: snapshots.length,
    preset: snapshotPresetForWindow(sinceDays),
  });
  const sampleTagPopulated = assignments.filter((row) => {
    const tag = Array.isArray(row.tag) ? row.tag[0] : row.tag;
    return Boolean(tag?.dimension);
  }).length;

  console.log("[creative-patterns] rows", {
    clientId,
    events: events.length,
    assignments: assignments.length,
    snapshots: snapshots.length,
    rollups: rollups.length,
    sinceDays,
  });
  console.log("[creative-patterns] tag-embed", {
    totalAssignments: assignments.length,
    populated: sampleTagPopulated,
    sample: assignments[0],
  });

  const rollupEventIds = new Set(rollups.map((row) => row.event_id));
  const totalSpend = rollups.reduce((sum, row) => sum + rollupSpend(row), 0);
  const assignmentsByEventCreative = groupAssignments(assignments);
  const tiles = new Map<string, TileAccumulator>();
  let totalAdConcepts = 0;
  let phaseSpend = 0;
  let totalGroups = 0;
  let filteredGroups = 0;

  for (const snapshot of snapshots) {
    console.log("[creative-patterns] snapshot-loop", {
      event_id: snapshot.event_id,
      in_rollup: rollupEventIds.has(snapshot.event_id),
      payload_kind: snapshot.payload.kind,
      groups: snapshot.payload.kind === "ok" ? snapshot.payload.groups.length : 0,
      assignments_for_event: [...assignmentsByEventCreative.entries()].filter(
        ([key]) => key.startsWith(`${snapshot.event_id}\u0000`),
      ).length,
    });
    if (!rollupEventIds.has(snapshot.event_id)) continue;
    if (snapshot.payload.kind !== "ok") continue;

    const event = eventById.get(snapshot.event_id);
    for (const group of snapshot.payload.groups) {
      totalGroups += 1;
      if (classifyPhaseForGroup(group) !== phase) continue;
      filteredGroups += 1;
      phaseSpend += group.spend;

      const matchedTags = tagsForGroup(
        assignmentsByEventCreative,
        snapshot.event_id,
        group,
      );
      if (matchedTags.length === 0) continue;

      totalAdConcepts += 1;
      for (const tag of matchedTags) {
        const key = `${tag.dimension}\u0000${tag.value_key}`;
        const acc = tiles.get(key) ?? createAccumulator(tag);
        addGroup(acc, snapshot.event_id, event ?? null, group, matchedTags, {
          since: sinceYmd,
          until: untilYmd,
        });
        tiles.set(key, acc);
      }
    }
  }
  console.log("[creative-patterns] phase-filter", {
    phase,
    total_groups: totalGroups,
    filtered_groups: filteredGroups,
    phase_spend: phaseSpend,
    total_spend: totalSpend,
  });

  const dimensions = CREATIVE_TAG_DIMENSIONS.map((dimension) => ({
    dimension,
    values: [...tiles.values()]
      .filter((tile) => tile.dimension === dimension)
      .map(finalizeTile)
      .sort((a, b) => b.total_spend - a.total_spend),
  }));

  return {
    dimensions,
    summary: {
      clientId,
      eventCount: events.length,
      taggedEventCount: new Set(assignments.map((row) => row.event_id)).size,
      tagAssignmentCount: assignments.length,
      totalSpend,
      phaseSpend,
      totalAdConcepts,
      highestCpaDimension: highestCpaDimension(dimensions),
      since: sinceYmd,
      until: untilYmd,
      sinceDays,
      rollupRowsRead: rollups.length,
      assignmentRowsRead: assignments.length,
      snapshotRowsRead: snapshots.length,
    },
  };
}

export function classifyPhaseForGroup(
  group: ConceptGroupRow,
): CreativePatternPhase {
  return group.campaigns.some((campaign) =>
    REGISTRATION_PHASE_RE.test(campaign.name ?? ""),
  )
    ? "registration"
    : "ticket_sale";
}

export async function clientHasTaggedEvents(clientId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select("id")
    .eq("client_id", clientId)
    .limit(500);

  if (eventsError) {
    console.warn("[creative-patterns] tagged-event check events failed", {
      clientId,
      error: eventsError.message,
    });
    return false;
  }

  const eventIds = ((events ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (eventIds.length === 0) return false;

  const { data, error } = await supabase
    .from("creative_tag_assignments")
    .select("id")
    .in("event_id", eventIds)
    .limit(1);

  if (error) {
    console.warn("[creative-patterns] tagged-event check assignments failed", {
      clientId,
      error: error.message,
    });
    return false;
  }
  return (data ?? []).length > 0;
}

async function fetchClientEvents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string,
): Promise<EventRow[]> {
  return fetchPaged<EventRow>((from, to) =>
    supabase
      .from("events")
      .select("id,name,event_date,event_code,venue_city,venue_country")
      .eq("client_id", clientId)
      .order("event_date", { ascending: false, nullsFirst: false })
      .range(from, to),
  );
}

function applyRegionFilter(
  events: EventRow[],
  filter: CreativePatternRegionFilter | undefined,
): EventRow[] {
  if (!filter) return events;
  if (filter.type === "venue_code") {
    return events.filter((event) => event.event_code === filter.value);
  }

  const region = parseClientRegionKey(filter.value) ?? regionKeyForLabel(filter.value);
  if (!region) return events;
  return events.filter((event) => bucketEventToClientRegion(event) === region);
}

function regionKeyForLabel(value: string): ClientRegionKey | null {
  const normalised = value.trim().toLowerCase();
  if (normalised === "scotland") return "scotland";
  if (normalised === "england — london" || normalised === "england - london") {
    return "england_london";
  }
  if (normalised === "england — uk" || normalised === "england - uk") {
    return "england_uk";
  }
  return null;
}

async function fetchAssignments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventIds: string[],
): Promise<AssignmentRow[]> {
  if (eventIds.length === 0) return [];
  return fetchPaged<AssignmentRow>((from, to) =>
    supabase
      .from("creative_tag_assignments")
      .select(
        "event_id,creative_name,tag_id,tag:creative_tags!creative_tag_assignments_tag_id_fkey(dimension,value_key,value_label)",
      )
      .in("event_id", eventIds)
      .order("event_id", { ascending: true })
      .order("creative_name", { ascending: true })
      .range(from, to),
  );
}

async function fetchLatestSnapshots(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventIds: string[],
  sinceDays: number,
): Promise<SnapshotRow[]> {
  if (eventIds.length === 0) return [];
  const preset = snapshotPresetForWindow(sinceDays);
  const rows = await fetchPaged<SnapshotRow>((from, to) =>
    supabase
      .from("active_creatives_snapshots")
      .select("event_id,payload,fetched_at,build_version")
      .in("event_id", eventIds)
      .eq("date_preset", preset)
      // Unlike public share reads, the internal patterns page intentionally
      // accepts stale-build snapshots. It reads creative metadata and
      // thumbnails, not display-render-sensitive metrics, and SHA-gating here
      // leaves most events empty between 6h cron refreshes after each deploy.
      .order("fetched_at", { ascending: false })
      .range(from, to),
  );

  return selectLatestSnapshotsByEvent(rows);
}

async function fetchRollups(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventIds: string[],
  sinceYmd: string,
  untilYmd: string,
): Promise<RollupRow[]> {
  if (eventIds.length === 0) return [];
  return fetchPaged<RollupRow>((from, to) =>
    supabase
      .from("event_daily_rollups")
      .select("event_id,date,ad_spend,ad_spend_allocated,ad_spend_presale")
      .in("event_id", eventIds)
      .gte("date", sinceYmd)
      .lte("date", untilYmd)
      .order("date", { ascending: true })
      .range(from, to),
  );
}

async function fetchPaged<T>(
  buildQuery: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

function groupAssignments(
  assignments: AssignmentRow[],
): Map<string, Array<{ dimension: CreativeTagDimension; value_key: string; value_label: string }>> {
  const out = new Map<
    string,
    Array<{ dimension: CreativeTagDimension; value_key: string; value_label: string }>
  >();

  for (const row of assignments) {
    const tag = Array.isArray(row.tag) ? row.tag[0] : row.tag;
    if (!tag?.dimension || !tag.value_key || !tag.value_label) continue;
    const key = assignmentKey(row.event_id, row.creative_name);
    const tags = out.get(key) ?? [];
    tags.push({
      dimension: tag.dimension,
      value_key: tag.value_key,
      value_label: tag.value_label,
    });
    out.set(key, tags);
  }

  return out;
}

function tagsForGroup(
  assignments: Map<
    string,
    Array<{ dimension: CreativeTagDimension; value_key: string; value_label: string }>
  >,
  eventId: string,
  group: ConceptGroupRow,
): Array<{ dimension: CreativeTagDimension; value_key: string; value_label: string }> {
  const names = [group.display_name, ...group.ad_names]
    .map((name) => name.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: Array<{
    dimension: CreativeTagDimension;
    value_key: string;
    value_label: string;
  }> = [];

  for (const name of names) {
    const rows = assignments.get(assignmentKey(eventId, name)) ?? [];
    for (const row of rows) {
      const key = `${row.dimension}\u0000${row.value_key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

function createAccumulator(tag: {
  dimension: CreativeTagDimension;
  value_key: string;
  value_label: string;
}): TileAccumulator {
  return {
    dimension: tag.dimension,
    value_key: tag.value_key,
    value_label: tag.value_label,
    total_spend: 0,
    total_purchases: 0,
    total_regs: 0,
    total_impressions: 0,
    total_clicks: 0,
    total_reach: 0,
    total_lpv: 0,
    ad_count: 0,
    eventIds: new Set(),
    top_creatives: [],
  };
}

function addGroup(
  acc: TileAccumulator,
  eventId: string,
  event: EventRow | null,
  group: ConceptGroupRow,
  tags: Array<{ dimension: CreativeTagDimension; value_key: string; value_label: string }>,
  activeRange: { since: string; until: string },
): void {
  acc.total_spend += group.spend;
  acc.total_purchases += group.purchases;
  acc.total_regs += group.registrations;
  acc.total_impressions += group.impressions;
  acc.total_clicks += group.clicks;
  acc.total_reach += group.reach;
  acc.total_lpv += group.landingPageViews;
  acc.ad_count += group.ad_count;
  acc.eventIds.add(eventId);
  acc.top_creatives.push({
    event_id: eventId,
    event_name: event?.name ?? null,
    event_code: event?.event_code ?? null,
    creative_name: group.display_name,
    ad_id: group.representative_thumbnail_ad_id ?? group.representative_ad_id,
    ad_names: group.ad_names,
    thumbnail_url: group.representative_thumbnail,
    preview_image_url: group.representative_preview.image_url,
    preview_permalink_url: group.representative_preview.instagram_permalink_url,
    spend: group.spend,
    impressions: group.impressions,
    clicks: group.clicks,
    ctr: group.ctr,
    cpm: group.cpm,
    cpa:
      group.purchases + group.registrations > 0
        ? group.spend / (group.purchases + group.registrations)
        : null,
    total_regs: group.registrations,
    total_purchases: group.purchases,
    tags,
    active_since: activeRange.since,
    active_until: activeRange.until,
  });
  acc.top_creatives.sort(
    (a, b) => b.spend - a.spend || (b.ctr ?? 0) - (a.ctr ?? 0),
  );
  acc.top_creatives = acc.top_creatives.slice(0, TOP_CREATIVE_LIMIT);
}

function finalizeTile(acc: TileAccumulator): TileRow {
  const acquisition = acc.total_purchases + acc.total_regs;
  return {
    value_key: acc.value_key,
    value_label: acc.value_label,
    total_spend: acc.total_spend,
    total_purchases: acc.total_purchases,
    total_regs: acc.total_regs,
    total_impressions: acc.total_impressions,
    total_clicks: acc.total_clicks,
    total_reach: acc.total_reach,
    lpv_count: acc.total_lpv,
    ctr:
      acc.total_impressions > 0
        ? (acc.total_clicks / acc.total_impressions) * 100
        : null,
    cpm: safeRate(acc.total_spend, acc.total_impressions, 1000),
    cpc: safeRate(acc.total_spend, acc.total_clicks),
    cplpv: safeRate(acc.total_spend, acc.total_lpv),
    cpa: acquisition > 0 ? acc.total_spend / acquisition : null,
    cpreg: safeRate(acc.total_spend, acc.total_regs),
    cpp: safeRate(acc.total_spend, acc.total_purchases),
    roas: null,
    frequency: safeRate(acc.total_impressions, acc.total_reach),
    ad_count: acc.ad_count,
    event_count: acc.eventIds.size,
    top_creatives: acc.top_creatives,
  };
}

function safeRate(
  numerator: number,
  denominator: number,
  multiplier = 1,
): number | null {
  if (denominator <= 0) return null;
  const value = (numerator / denominator) * multiplier;
  return Number.isFinite(value) ? value : null;
}

function highestCpaDimension(
  dimensions: CreativePatternDimension[],
): CreativePatternsSummary["highestCpaDimension"] {
  let highest: CreativePatternsSummary["highestCpaDimension"] = null;
  for (const dimension of dimensions) {
    const spend = dimension.values.reduce((sum, row) => sum + row.total_spend, 0);
    const acquisitions = dimension.values.reduce(
      (sum, row) => sum + row.total_purchases + row.total_regs,
      0,
    );
    if (spend <= 0 || acquisitions <= 0) continue;
    const cpa = spend / acquisitions;
    if (!highest || cpa > highest.cpa) highest = { dimension: dimension.dimension, cpa };
  }
  return highest;
}

function rollupSpend(row: RollupRow): number {
  return (
    row.ad_spend_allocated ??
    row.ad_spend ??
    0
  ) + (row.ad_spend_presale ?? 0);
}

function assignmentKey(eventId: string, creativeName: string): string {
  return `${eventId}\u0000${creativeName}`;
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function snapshotPresetForWindow(sinceDays: number): DatePreset {
  // Cron only warms `maximum`, `last_30d`, `last_14d`, and `last_7d`.
  // Use the true 30-day snapshot when available; longer client-level
  // windows intentionally fall back to the broadest warmed creative snapshot
  // while rollup summaries remain date-windowed.
  return sinceDays === 30 ? "last_30d" : "maximum";
}
