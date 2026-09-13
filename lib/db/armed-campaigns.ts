/**
 * Fleet read for armed campaigns and per-event campaign lists.
 * Session-scoped for owners; operators use a service-role client the
 * route builds after the allowlist check.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { migrateDraft } from "@/lib/autosave";
import {
  describeCarrierMismatch,
  describeCodeEventMismatch,
  formatWiredEventLabel,
  joinEventWarnings,
  resolveDraftEventId,
  type CampaignEventIdentity,
} from "@/lib/campaign-event";
import { impactFromRows, IMPACT_SERIES_DAYS } from "@/lib/optimisation/armed-impact";
import {
  armFromDraftFlags,
  assertArmedEventId,
  controlsFromStrategy,
  lastDecisionFromRows,
  lastWriteFromRows,
  nextOptimisationTickAt,
  type ArmedCampaignRow,
} from "@/lib/optimisation/armed-read-model";
import {
  presentDecisionRow,
  type DecisionRowInput,
  type DecisionRowView,
} from "@/lib/optimisation/automation-ui";
import type { CampaignDraft, CampaignObjective } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

function anySb(supabase: SupabaseClient): AnySupabase {
  return supabase as unknown as AnySupabase;
}

interface DraftFleetRow {
  id: string;
  user_id: string;
  name: string | null;
  objective: string | null;
  status: string | null;
  event_id: string | null;
  draft_json: unknown;
  optimisation_automation_enabled: boolean | null;
  optimisation_automation_live: boolean | null;
}

export type ArmedFleetQuery =
  | { kind: "armed" }
  | { kind: "event"; eventId: string };

/**
 * Badge count only. One `count: exact, head: true` — no draft_json,
 * no events, no 2N decisions. Same `_enabled` filter and owner scope
 * as the Armed tab read.
 */
export async function countArmedCampaigns(
  supabase: SupabaseClient,
  viewer: { userId: string; isOperator: boolean },
): Promise<number> {
  const sb = anySb(supabase);
  let q = sb
    .from("campaign_drafts")
    .select("id", { count: "exact", head: true })
    .eq("optimisation_automation_enabled", true);
  if (!viewer.isOperator) {
    q = q.eq("user_id", viewer.userId);
  }
  const { count, error } = await q;
  if (error) {
    throw new Error(`countArmedCampaigns: ${error.message}`);
  }
  return count ?? 0;
}

export async function loadArmedCampaignRows(
  supabase: SupabaseClient,
  query: ArmedFleetQuery,
  viewer: { userId: string; isOperator: boolean },
): Promise<ArmedCampaignRow[]> {
  const sb = anySb(supabase);
  let q = sb
    .from("campaign_drafts")
    .select(
      "id, user_id, name, objective, status, event_id, draft_json, optimisation_automation_enabled, optimisation_automation_live",
    )
    .order("updated_at", { ascending: false });

  if (query.kind === "armed") {
    q = q.eq("optimisation_automation_enabled", true);
  } else {
    assertArmedEventId(query.eventId);
    const eventId = query.eventId;
    q = q.or(`event_id.eq.${eventId},draft_json->settings->>eventId.eq.${eventId}`);
  }
  if (!viewer.isOperator) {
    q = q.eq("user_id", viewer.userId);
  }

  const { data, error } = await q;
  if (error) {
    throw new Error(`loadArmedCampaignRows: ${error.message}`);
  }
  const rows = (data ?? []) as DraftFleetRow[];

  const parsed = rows.map((row) => parseFleetRow(row)).filter((item): item is ParsedFleet => item != null);

  const filtered =
    query.kind === "event"
      ? parsed.filter((item) => item.resolvedEventId === query.eventId)
      : parsed;

  const eventIds = [
    ...new Set(
      filtered
        .flatMap((item) => [item.resolvedEventId, item.columnEventId, item.jsonEventId])
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const draftIds = filtered.map((item) => item.row.id);
  const [eventsById, decisionsByDraft, impactRowsByDraft] = await Promise.all([
    loadEventsById(sb, eventIds),
    loadLatestDecisions(sb, draftIds),
    loadImpactRows(sb, draftIds),
  ]);
  const nextTickAt = nextOptimisationTickAt().toISOString();
  const seriesSince = new Date(Date.now() - IMPACT_SERIES_DAYS * 24 * 60 * 60 * 1000);

  const rank: Record<ArmedCampaignRow["arm"], number> = {
    live: 0,
    shadow: 1,
    off: 2,
  };
  return filtered.map((item) => {
    const resolvedEvent = item.resolvedEventId
      ? (eventsById.get(item.resolvedEventId) ?? null)
      : null;
    const jsonEvent = item.jsonEventId ? (eventsById.get(item.jsonEventId) ?? null) : null;
    const columnEvent = item.columnEventId
      ? (eventsById.get(item.columnEventId) ?? null)
      : null;
    const decisions = decisionsByDraft.get(item.row.id) ?? [];
    const draft = item.draft;
    const controls = controlsFromStrategy(
      draft.optimisationStrategy,
      (draft.settings.objective ?? item.row.objective ?? "registration") as CampaignObjective,
      draft.budgetSchedule?.currency || "GBP",
    );
    return {
      id: item.row.id,
      name: draft.settings.campaignName || item.row.name || "Untitled campaign",
      status: item.row.status ?? draft.status ?? "draft",
      ownerUserId: item.row.user_id,
      ownerLabel: item.row.user_id === viewer.userId ? "you" : "another operator",
      canWrite: viewer.isOperator || item.row.user_id === viewer.userId,
      arm: armFromDraftFlags(
        item.row.optimisation_automation_enabled === true,
        item.row.optimisation_automation_live === true,
      ),
      eventId: item.resolvedEventId,
      eventLabel: resolvedEvent ? formatWiredEventLabel(resolvedEvent) : null,
      eventWarning: joinEventWarnings(
        describeCodeEventMismatch({
          campaignCode: draft.settings.campaignCode,
          campaignName: draft.settings.campaignName || item.row.name,
          event: resolvedEvent,
        }),
        describeCarrierMismatch({
          jsonEventId: item.jsonEventId,
          columnEventId: item.columnEventId,
          jsonEvent,
          columnEvent,
        }),
      ),
      lastDecision: lastDecisionFromRows(decisions),
      lastWrite: lastWriteFromRows(decisions),
      controls,
      nextTickAt,
      impact: impactFromRows(impactRowsByDraft.get(item.row.id) ?? [], {
        metric: controls.primaryMetric,
        metricWindow: controls.primaryMetricWindow,
        seriesSince,
      }),
    };
  }).sort((a, b) => rank[a.arm] - rank[b.arm] || a.name.localeCompare(b.name));
}

interface ParsedFleet {
  row: DraftFleetRow;
  draft: CampaignDraft;
  jsonEventId: string | null;
  columnEventId: string | null;
  resolvedEventId: string | null;
}

function parseFleetRow(row: DraftFleetRow): ParsedFleet | null {
  try {
    const draft = migrateDraft(row.draft_json as Record<string, unknown>);
    const jsonEventId = draft.settings.eventId?.trim() || null;
    const columnEventId = row.event_id?.trim() || null;
    return {
      row,
      draft,
      jsonEventId,
      columnEventId,
      resolvedEventId: resolveDraftEventId(jsonEventId, columnEventId),
    };
  } catch {
    return null;
  }
}

async function loadEventsById(
  sb: AnySupabase,
  ids: string[],
): Promise<Map<string, CampaignEventIdentity>> {
  const map = new Map<string, CampaignEventIdentity>();
  if (ids.length === 0) return map;
  const { data, error } = await sb
    .from("events")
    .select("id, event_code, name, venue_city, venue_name, event_date, client_id")
    .in("id", ids);
  if (error) {
    console.warn("loadArmedCampaignRows events:", error.message);
    return map;
  }
  for (const event of (data ?? []) as CampaignEventIdentity[]) {
    map.set(event.id, event);
  }
  return map;
}

const DECISION_SELECT =
  "draft_id, decided_at, metric, metric_value, metric_window, rule_matched, action_recommended, budget_before_pence, budget_after_pence, applied, dry_run, reason_text, channel, scope, campaign_id, adset_id, meta_response_json";

/**
 * Latest decision and latest applied write, per draft. A global newest-N
 * fetch would return only skip_event_passed from the two Live campaigns
 * (~70/day) and hide a write from 10 Sep.
 */
async function loadLatestDecisions(
  sb: AnySupabase,
  draftIds: string[],
): Promise<Map<string, DecisionRowView[]>> {
  const map = new Map<string, DecisionRowView[]>();
  if (draftIds.length === 0) return map;

  await Promise.all(
    draftIds.map(async (draftId) => {
      const [latest, write] = await Promise.all([
        sb
          .from("campaign_automation_decisions")
          .select(DECISION_SELECT)
          .eq("draft_id", draftId)
          .order("decided_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        sb
          .from("campaign_automation_decisions")
          .select(DECISION_SELECT)
          .eq("draft_id", draftId)
          .eq("applied", true)
          .order("decided_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (latest.error) {
        console.warn("loadArmedCampaignRows decisions:", latest.error.message);
        return;
      }
      if (write.error) {
        console.warn("loadArmedCampaignRows writes:", write.error.message);
      }
      const rows: DecisionRowView[] = [];
      const last = latest.data as (DecisionRowInput & { draft_id: string }) | null;
      const applied = write.data as (DecisionRowInput & { draft_id: string }) | null;
      if (last) rows.push(presentDecisionRow(last));
      if (
        applied &&
        (!last || last.decided_at !== applied.decided_at || last.applied !== true)
      ) {
        rows.push(presentDecisionRow(applied));
      }
      if (rows.length > 0) map.set(draftId, rows);
    }),
  );
  return map;
}

/**
 * One fleet scan — applied writes (all time) plus ticks in the last
 * IMPACT_SERIES_DAYS. Date-only `gte` so the PostgREST `.or()` has no
 * colons. Aggregates happen in process, not a third per-draft query.
 *
 * No index covers `(draft_id, decided_at desc)` — campaign_id / adset_id
 * / channel only. Seq scan. Say so; do not migrate.
 */
async function loadImpactRows(
  sb: AnySupabase,
  draftIds: string[],
): Promise<Map<string, DecisionRowView[]>> {
  const map = new Map<string, DecisionRowView[]>();
  if (draftIds.length === 0) return map;
  const sinceDay = new Date(Date.now() - IMPACT_SERIES_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const { data, error } = await sb
    .from("campaign_automation_decisions")
    .select(DECISION_SELECT)
    .in("draft_id", draftIds)
    .or(`applied.eq.true,decided_at.gte.${sinceDay}`)
    .order("decided_at", { ascending: true })
    .limit(5000);
  if (error) {
    console.warn("loadArmedCampaignRows impact:", error.message);
    return map;
  }
  for (const raw of (data ?? []) as Array<DecisionRowInput & { draft_id: string | null }>) {
    if (!raw.draft_id) continue;
    const list = map.get(raw.draft_id) ?? [];
    list.push(presentDecisionRow(raw));
    map.set(raw.draft_id, list);
  }
  return map;
}
