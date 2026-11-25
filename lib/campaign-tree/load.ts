/**
 * Reads the event's campaign tree (R7): its campaigns from
 * events.meta_campaign_id, launched_ad_sets and its published drafts; their
 * names, statuses and ad sets from Meta (one batched read, GET only); and the
 * campaign_additions log.
 *
 * DB reads go through the client the caller passes (the route passes the
 * operator's session, so owner RLS applies) and are paged (PostgREST returns
 * at most 1,000 rows). Meta is read, never written. When Meta can't be read
 * the tree still lists every campaign the app knows, with its ad sets from
 * launched_ad_sets and no status.
 */

import { normalizeAdAccountId } from "../meta/ad-account.ts";
import {
  buildCampaignTree,
  stageOfCampaign,
  treeStatus,
  type TreeAdditionRow,
  type TreeAdSet,
  type TreeCampaign,
  type TreeView,
} from "./tree.ts";

type Err = { code?: string; message?: string } | null;

export interface TreeQuery {
  eq(col: string, value: unknown): TreeQuery;
  in(col: string, values: unknown[]): TreeQuery;
  order(col: string, opts?: { ascending?: boolean }): TreeQuery;
  range(from: number, to: number): PromiseLike<{ data: Record<string, unknown>[] | null; error: Err }>;
  maybeSingle(): PromiseLike<{ data: Record<string, unknown> | null; error: Err }>;
}

export interface TreeDb {
  from(table: string): { select(cols: string): TreeQuery };
}

export interface GraphCampaign {
  id: string;
  name?: string;
  effective_status?: string;
  objective?: string;
  account_id?: string;
  adsets?: { data?: Array<{ id: string; name?: string; effective_status?: string }> };
}

export interface TreeGraph {
  /** One batched GET per ≤ 50 campaign ids. Throws when Meta can't be read. */
  readCampaigns(ids: string[]): Promise<Map<string, GraphCampaign>>;
}

export interface TreeEvent {
  id: string;
  event_code: string | null;
  client_id: string | null;
  meta_campaign_id: string | null;
}

export interface LoadedTree {
  event: TreeEvent;
  view: TreeView;
  /** Every campaign, flat, as the sheet needs it. */
  campaigns: TreeCampaign[];
  /** False when Meta couldn't be read: statuses are unknown and no campaign starts ticked. */
  metaRead: boolean;
  /** Meta GETs made. */
  metaCalls: number;
}

const PAGE = 1000;
const META_ID = /^[0-9]{5,32}$/;

async function pageAll(build: () => TreeQuery): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message ?? "read failed");
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** events.meta_campaign_id is a comma list. */
export function splitCampaignIds(value: string | null | undefined): string[] {
  return [...new Set((value ?? "").split(/[,\s]+/).map((s) => s.trim()).filter((s) => META_ID.test(s)))];
}

export interface DraftForCampaign {
  id: string;
  name: string | null;
  status: string | null;
  objective: string | null;
  adAccountId: string | null;
  metaCampaignId: string | null;
}

export async function loadEventDrafts(db: TreeDb, eventId: string): Promise<DraftForCampaign[]> {
  const rows = await pageAll(() =>
    db
      .from("campaign_drafts")
      .select("id, name, status, objective, ad_account_id, metaCampaignId:draft_json->>metaCampaignId")
      .eq("event_id", eventId)
      .order("updated_at", { ascending: false }),
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: text(r.name),
    status: text(r.status),
    objective: text(r.objective),
    adAccountId: normalizeAdAccountId(text(r.ad_account_id)),
    metaCampaignId: text(r.metaCampaignId),
  }));
}

export interface LaunchedAdSetRow {
  meta_adset_id: string;
  meta_campaign_id: string | null;
  ad_account_id: string | null;
  draft_id: string | null;
  phase_at_launch: string | null;
  source_name: string | null;
}

export async function loadEventAdSets(db: TreeDb, eventId: string): Promise<LaunchedAdSetRow[]> {
  const rows = await pageAll(() =>
    db
      .from("launched_ad_sets")
      .select("meta_adset_id, meta_campaign_id, ad_account_id, draft_id, phase_at_launch, source_name, channel")
      .eq("event_id", eventId)
      .order("launched_at", { ascending: true }),
  );
  return rows
    .filter((r) => (text(r.channel) ?? "meta") === "meta")
    .map((r) => ({
      meta_adset_id: String(r.meta_adset_id),
      meta_campaign_id: text(r.meta_campaign_id),
      ad_account_id: normalizeAdAccountId(text(r.ad_account_id)),
      draft_id: text(r.draft_id),
      phase_at_launch: text(r.phase_at_launch),
      source_name: text(r.source_name),
    }));
}

/**
 * The published draft behind each campaign: a published draft on the event
 * whose metaCampaignId is the campaign, else the draft its ad sets were
 * launched from when that draft is a published one on this event.
 */
export function draftsByCampaign(drafts: DraftForCampaign[], adSets: LaunchedAdSetRow[]): Map<string, DraftForCampaign> {
  const published = drafts.filter((d) => d.status === "published");
  const byId = new Map(published.map((d) => [d.id, d]));
  const out = new Map<string, DraftForCampaign>();
  for (const d of published) {
    if (d.metaCampaignId && !out.has(d.metaCampaignId)) out.set(d.metaCampaignId, d);
  }
  for (const a of adSets) {
    if (!a.meta_campaign_id || out.has(a.meta_campaign_id) || !a.draft_id) continue;
    const d = byId.get(a.draft_id);
    if (d) out.set(a.meta_campaign_id, d);
  }
  return out;
}

export async function loadCampaignTree(
  db: TreeDb,
  graph: TreeGraph | null,
  eventId: string,
  options: { timeZone?: string } = {},
): Promise<LoadedTree | null> {
  const { data: eventRow, error } = await db
    .from("events")
    .select("id, event_code, client_id, meta_campaign_id")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !eventRow) return null;
  const event: TreeEvent = {
    id: String(eventRow.id),
    event_code: text(eventRow.event_code),
    client_id: text(eventRow.client_id),
    meta_campaign_id: text(eventRow.meta_campaign_id),
  };

  const [drafts, adSets, additionRows] = await Promise.all([
    loadEventDrafts(db, eventId),
    loadEventAdSets(db, eventId),
    pageAll(() =>
      db
        .from("campaign_additions")
        .select("id, meta_campaign_id, stage, kind, meta_adset_ids, detail, onsale_refresh_line_id, created_at")
        .eq("event_id", eventId)
        .order("created_at", { ascending: true }),
    ).catch(() => [] as Record<string, unknown>[]),
  ]);

  const eventCampaignIds = splitCampaignIds(event.meta_campaign_id);
  const byCampaign = draftsByCampaign(drafts, adSets);
  const ids = [
    ...new Set([
      ...eventCampaignIds,
      ...adSets.map((a) => a.meta_campaign_id).filter((id): id is string => Boolean(id && META_ID.test(id))),
      ...[...byCampaign.keys()].filter((id) => META_ID.test(id)),
    ]),
  ];

  let meta = new Map<string, GraphCampaign>();
  let metaRead = false;
  let metaCalls = 0;
  if (graph && ids.length > 0) {
    try {
      metaCalls = Math.ceil(ids.length / 50);
      meta = await graph.readCampaigns(ids);
      metaRead = true;
    } catch {
      metaRead = false;
    }
  }

  const campaigns: TreeCampaign[] = [];
  for (const id of ids) {
    const live = meta.get(id);
    const status = metaRead ? treeStatus(live?.effective_status) : null;
    if (status === "gone") continue;
    const draft = byCampaign.get(id) ?? null;
    const known = adSets.filter((a) => a.meta_campaign_id === id);
    let campaignAdSets: TreeAdSet[];
    if (live?.adsets?.data) {
      campaignAdSets = [];
      for (const a of live.adsets.data) {
        const s = treeStatus(a.effective_status);
        if (s === "gone") continue;
        campaignAdSets.push({ id: String(a.id), name: text(a.name) ?? String(a.id), status: s });
      }
    } else {
      campaignAdSets = known.map((a) => ({ id: a.meta_adset_id, name: a.source_name ?? a.meta_adset_id, status: null }));
    }
    const name = text(live?.name) ?? draft?.name ?? id;
    campaigns.push({
      metaCampaignId: id,
      name,
      stage: stageOfCampaign({
        name,
        draftObjective: draft?.objective,
        phaseAtLaunch: known.find((a) => a.phase_at_launch)?.phase_at_launch ?? null,
        metaObjective: live?.objective,
      }),
      status,
      adSets: campaignAdSets,
      draftId: draft?.id ?? null,
      adAccountId:
        normalizeAdAccountId(text(live?.account_id)) ??
        draft?.adAccountId ??
        known.find((a) => a.ad_account_id)?.ad_account_id ??
        null,
    });
  }

  const additions: TreeAdditionRow[] = additionRows.map((r) => ({
    id: String(r.id),
    meta_campaign_id: String(r.meta_campaign_id),
    stage: String(r.stage),
    kind: r.kind === "audience" ? "audience" : "creative",
    meta_adset_ids: Array.isArray(r.meta_adset_ids) ? (r.meta_adset_ids as string[]) : [],
    detail: (r.detail ?? {}) as Record<string, unknown>,
    onsale_refresh_line_id: text(r.onsale_refresh_line_id),
    created_at: String(r.created_at),
  }));

  return {
    event,
    view: buildCampaignTree({ campaigns, additions, eventCampaignIds, timeZone: options.timeZone }),
    campaigns,
    metaRead,
    metaCalls,
  };
}

/** The ledger's draft for each campaign the sheet ticked, or the campaigns that have none. */
export async function resolveLedgerDrafts(
  db: TreeDb,
  eventId: string,
  campaignIds: string[],
): Promise<{ ok: true; drafts: Map<string, string> } | { ok: false; missing: string[] }> {
  const [drafts, adSets] = await Promise.all([loadEventDrafts(db, eventId), loadEventAdSets(db, eventId)]);
  const byCampaign = draftsByCampaign(drafts, adSets);
  const out = new Map<string, string>();
  const missing: string[] = [];
  for (const id of campaignIds) {
    const draft = byCampaign.get(id);
    if (draft) out.set(id, draft.id);
    else missing.push(id);
  }
  return missing.length ? { ok: false, missing } : { ok: true, drafts: out };
}

// ─── Ledger keys (meta_write_idempotency) ────────────────────────────────

/**
 * A tree run's creative: one per campaign and creative (bulk-attach reuses it
 * across the campaign's ad sets). Recorded as `creative_upload`, the ledger's
 * only creative kind, keyed apart from any upload by `source`.
 */
export function treeCreativeLedgerKey(input: { runId: string; campaignId: string; creativeId: string }) {
  return { source: "campaign_tree", run_id: input.runId, campaign_id: input.campaignId, creative_id: input.creativeId };
}

/** A tree run's ad: one per campaign, ad set and creative (`ad_create`). The Meta creative id is left out, so a retry that has to remake the creative still finds the ad. */
export function treeAdLedgerKey(input: { runId: string; campaignId: string; adSetId: string; creativeId: string }) {
  return {
    source: "campaign_tree",
    run_id: input.runId,
    campaign_id: input.campaignId,
    adset_id: input.adSetId,
    creative_id: input.creativeId,
  };
}
