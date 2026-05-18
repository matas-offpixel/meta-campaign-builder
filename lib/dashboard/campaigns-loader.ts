import "server-only";

/**
 * lib/dashboard/campaigns-loader.ts
 *
 * Server loader for the internal `/clients/[id]/campaigns` tab. Reads
 * `active_creatives_snapshots` for the client's events, joins them
 * with the canonical event-code metrics, and produces an aggregated
 * `CampaignsAggregateRow[]` ready for the table.
 *
 * Data flow:
 *
 *   loadClientPortalByClientId  →  events + dailyRollups + tier-channel
 *   loadEventCodeLifetimeMetaCacheForClient  →  metaRegs per event_code
 *   active_creatives_snapshots                →  per-event payload
 *           ↓
 *   computeCanonicalEventMetricsByEventCode (per event_code metrics)
 *           ↓
 *   aggregateCampaignsFromSnapshots (campaign + ad-set rows)
 *
 * Stays read-time only — never goes live to Meta. Snapshot freshness
 * is whatever the existing 6-hour cron has produced
 * (per `project_active_creatives_snapshot_cache.md`); the surface
 * exposes a "Last refreshed" timestamp + manual refresh button so
 * operators can self-serve when stale.
 */

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  loadClientPortalByClientId,
  type DailyRollupRow,
  type PortalEvent,
} from "@/lib/db/client-portal-server";
import { loadEventCodeLifetimeMetaCacheForClient } from "@/lib/db/event-code-lifetime-meta-cache";
import { computeCanonicalEventMetricsByEventCode } from "./canonical-event-metrics.ts";
import {
  aggregateCampaignsFromSnapshots,
  type CampaignsSnapshotInput,
  type CampaignsAggregateRow,
} from "./campaigns-aggregator.ts";
import {
  type AttributionClassification,
} from "./attribution-state.ts";
import { selectLatestSnapshotsByEvent } from "@/lib/reporting/creative-patterns-snapshots";
import { getCurrentBuildVersion } from "@/lib/build-version";
import type { ShareActiveCreativesResult } from "@/lib/reporting/share-active-creatives";

interface SnapshotRow {
  event_id: string;
  payload: ShareActiveCreativesResult;
  fetched_at: string;
  build_version: string | null;
  is_stale: boolean;
}

/**
 * What the campaigns tab needs to render. The component receives
 * the aggregated rows directly; the helper metadata lets the header
 * render "Last refreshed", an empty-state, and the event-code
 * filter dropdown.
 */
export interface ClientCampaignsData {
  rows: CampaignsAggregateRow[];
  /**
   * Most recent `fetched_at` across the snapshots used. `null` means
   * the cron hasn't populated any snapshot yet — render "Never" + a
   * refresh button.
   */
  lastRefreshedAt: string | null;
  /**
   * `(event_code, ticketsTrue)` map — surfaced for the table's
   * "Sales (est.)" tooltip + the event-code filter chip count.
   */
  ticketsTrueByEventCode: Record<string, number>;
  /** Inherits-from-which: list of events backing each event_code. */
  eventCodes: Array<{
    eventCode: string;
    eventNames: string[];
    /** Convenience for rendering chips: `<EVENT_CODE> · NAME`. */
    label: string;
    /** Number of campaigns under this event_code. */
    campaignCount: number;
    /** Whether the snapshot under this code is stale (any sibling). */
    isStale: boolean;
  }>;
  /** Distinct campaign names for the filter dropdown / search. */
  campaignNames: string[];
  /**
   * `true` when at least one event matched a snapshot. `false`
   * triggers an empty-state in the UI.
   */
  hasData: boolean;
}

/**
 * Server-side load for the campaigns tab.
 *
 * Failure mode: returns `{ rows: [], hasData: false }` rather than
 * throwing — the surface renders the empty state with the refresh
 * button so operators can recover without a hard error.
 */
export async function loadClientCampaignsData(
  clientId: string,
): Promise<ClientCampaignsData> {
  const portal = await loadClientPortalByClientId(clientId);
  if (!portal.ok) {
    return emptyResult();
  }

  const supabase = createServiceRoleClient();

  // Lifetime cache rows live on `portal.lifetimeMetaByEventCode`
  // already, but a defensive re-load here keeps this loader self-
  // contained (the portal can succeed with an empty cache list).
  const cacheRows =
    portal.lifetimeMetaByEventCode.length > 0
      ? portal.lifetimeMetaByEventCode
      : await loadEventCodeLifetimeMetaCacheForClient(supabase, clientId);

  // Per-event_code rollups.
  const rollupsByEventCode = new Map<string, DailyRollupRow[]>();
  const eventsByEventCode = new Map<
    string,
    Array<{ id: string; event_code: string | null }>
  >();
  const eventCodeByEventId = new Map<string, string>();
  const tierChannelTicketsByEventId = new Map<string, number | null>();

  for (const ev of portal.events as PortalEvent[]) {
    const code = ev.event_code;
    if (!code) continue;
    eventCodeByEventId.set(ev.id, code);
    tierChannelTicketsByEventId.set(ev.id, ev.tier_channel_sales_tickets);
    let bucket = eventsByEventCode.get(code);
    if (!bucket) {
      bucket = [];
      eventsByEventCode.set(code, bucket);
    }
    bucket.push({ id: ev.id, event_code: code });
  }

  for (const row of portal.dailyRollups as DailyRollupRow[]) {
    const code = eventCodeByEventId.get(row.event_id);
    if (!code) continue;
    let bucket = rollupsByEventCode.get(code);
    if (!bucket) {
      bucket = [];
      rollupsByEventCode.set(code, bucket);
    }
    bucket.push(row);
  }

  // Canonical metrics per event_code → ticketsTrue + attribution.
  const canonicalByCode = computeCanonicalEventMetricsByEventCode({
    cacheRows,
    rollupsByEventCode,
    eventsByEventCode,
    tierChannelTicketsByEventId,
  });

  const ticketsTrueByEventCode = new Map<string, number>();
  const attributionByEventCode = new Map<string, AttributionClassification>();
  for (const [code, m] of canonicalByCode) {
    ticketsTrueByEventCode.set(code, m.ticketsTrue);
    attributionByEventCode.set(code, m.attribution);
  }

  // Snapshot fetch — `lifetime` preset matches the cron entry for
  // the share-page active-creatives surface. We deliberately don't
  // SHA-gate (build_version) here — same rationale as the patterns
  // page (`creative-patterns-cross-event.ts`): we read creative
  // metadata + spend for an internal surface, not the share page,
  // and excluding stale-build rows would hollow the page out
  // between deploys.
  const eventIds = portal.events
    .map((e) => e.id)
    .filter((id) => eventCodeByEventId.has(id));
  const snapshotInputs: CampaignsSnapshotInput[] = [];
  let lastRefreshedAt: string | null = null;
  const isStaleByEventCode = new Map<string, boolean>();
  if (eventIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as unknown as any;
    const { data, error } = await sb
      .from("active_creatives_snapshots")
      .select("event_id, payload, fetched_at, build_version, is_stale")
      .in("event_id", eventIds)
      .eq("date_preset", "lifetime")
      .is("custom_since", null)
      .is("custom_until", null)
      .order("fetched_at", { ascending: false });
    if (error) {
      console.warn("[campaigns-loader] snapshot read failed", error.message);
    } else {
      const rows = (data ?? []) as SnapshotRow[];
      const latest = selectLatestSnapshotsByEvent(rows);
      const buildVersion = getCurrentBuildVersion();
      for (const row of latest) {
        const eventCode = eventCodeByEventId.get(row.event_id) ?? null;
        if (!eventCode) continue;
        // We do NOT skip on build-version mismatch (see comment
        // above); we only flag staleness so the header can show a
        // banner.
        const stale =
          row.is_stale === true ||
          (row.build_version != null && row.build_version !== buildVersion);
        if (stale) isStaleByEventCode.set(eventCode, true);
        snapshotInputs.push({
          eventId: row.event_id,
          eventCode,
          payload: row.payload,
          fetchedAt: row.fetched_at,
        });
        if (!lastRefreshedAt || row.fetched_at > lastRefreshedAt) {
          lastRefreshedAt = row.fetched_at;
        }
      }
    }
  }

  const rows = aggregateCampaignsFromSnapshots({
    snapshots: snapshotInputs,
    ticketsTrueByEventCode,
    attributionByEventCode,
  });

  // Build the event-code chip list for the filter row.
  const campaignsByCode = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const code of row.eventCodes) {
      let bucket = campaignsByCode.get(code);
      if (!bucket) {
        bucket = new Set<string>();
        campaignsByCode.set(code, bucket);
      }
      bucket.add(row.campaignId);
    }
  }
  const eventNamesByCode = new Map<string, string[]>();
  const eventNameById = new Map<string, string>();
  for (const ev of portal.events as PortalEvent[]) {
    eventNameById.set(ev.id, ev.name);
    if (!ev.event_code) continue;
    let bucket = eventNamesByCode.get(ev.event_code);
    if (!bucket) {
      bucket = [];
      eventNamesByCode.set(ev.event_code, bucket);
    }
    bucket.push(ev.name);
  }
  const eventCodes = [...campaignsByCode.entries()]
    .map(([code, campaignIds]) => ({
      eventCode: code,
      eventNames: (eventNamesByCode.get(code) ?? []).sort(),
      label: code,
      campaignCount: campaignIds.size,
      isStale: isStaleByEventCode.get(code) === true,
    }))
    .sort((a, b) => a.eventCode.localeCompare(b.eventCode));

  const campaignNames = [
    ...new Set(
      rows
        .map((r) => r.campaignName)
        .filter((n): n is string => typeof n === "string" && n.length > 0),
    ),
  ].sort();

  return {
    rows,
    lastRefreshedAt,
    ticketsTrueByEventCode: Object.fromEntries(ticketsTrueByEventCode),
    eventCodes,
    campaignNames,
    hasData: rows.length > 0,
  };
}

function emptyResult(): ClientCampaignsData {
  return {
    rows: [],
    lastRefreshedAt: null,
    ticketsTrueByEventCode: {},
    eventCodes: [],
    campaignNames: [],
    hasData: false,
  };
}
