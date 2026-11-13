/**
 * Gather one CampaignInput per on-sale campaign from what the app already
 * has: ad_daily_insights (results in actions, spend, days), creative_scores
 * (convert axis, significance), interest_clusters.live_evidence, the
 * ticket-warning rows, events.budget_marketing, the ticketing link, and
 * the cycle's Drive folders (one listChildren per owner type folder).
 *
 * Reads only. Every table read is paginated with .range (PostgREST's
 * 1,000-row cap) and ordered by a unique key, then deduped: an unordered
 * page can repeat rows, which inflated the first dry run. Archived
 * clients are left out (lib/db/client-status.ts). Meta is never called;
 * the Drive read is the only call out, and a run with no Drive
 * credentials still produces every line but the adds.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadArchivedClientIds } from "../db/client-status.ts";
import { driveFromEnv, FOLDER_MIME, type DriveApi, type DriveFile } from "../drive/client.ts";
import { kindForFile } from "../drive/tree.ts";
import { loadAdContextIndex, resolveAdContext, type AdContextIndex } from "../learning/ad-facts.ts";
import { CONFIDENCE_SCORE, type Confidence } from "../learning/shrink.ts";
import type { PhaseConfig, ResultEvent } from "./phase-config.ts";
import { isOnSale } from "./on-sale.ts";
import type { PurchaseRead } from "./purchases.ts";
import { chooseObjective, type AdInput, type AdSetInput, type CampaignInput, type ClaimInput, type ClusterInput, type SupplyFile, type SupplyMix } from "./rules.ts";
import { addDaysIso, planRun, type RunPlan } from "./schedule.ts";

type Db = Pick<SupabaseClient, "from">;

export type EventRow = {
  id: string;
  name: string;
  event_code: string | null;
  event_date: string | null;
  general_sale_at: string | null;
  status: string | null;
  client_id: string | null;
  budget_marketing: number | string | null;
  drive_folder_id: string | null;
  /** The show's page and ticket link: E1's own-domain test reads them. */
  signup_url?: string | null;
  ticket_url?: string | null;
};

type InsightRow = {
  meta_ad_id: string;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
  ad_account_id: string | null;
  date: string;
  ad_name: string | null;
  adset_name: string | null;
  campaign_name: string | null;
  spend: number | string;
  landing_page_views: number | string;
  purchases: number | string;
  actions: { action_type?: string; value?: string | number }[] | null;
};

const PAGE = 1000;

/**
 * Every row of a table, 1,000 at a time, ordered by `orderBy` (a unique
 * key, or a key set that is unique together) so pages never overlap, and
 * deduped on that key in case they do.
 */
export async function loadAll<T extends Record<string, unknown>>(db: Db, table: string, columns: string, orderBy: readonly string[], filter?: (q: any) => any): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    let query = db.from(table).select(columns);
    if (filter) query = filter(query);
    for (const column of orderBy) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const chunk = (data ?? []) as unknown as T[];
    for (const row of chunk) {
      const key = orderBy.map((column) => String(row[column] ?? "")).join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    if (chunk.length < PAGE) break;
  }
  return rows;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Meta's canonical IC total: omni_initiated_checkout. The pixel-only and onsite rows are parts of it. */
export const IC_ACTION = "omni_initiated_checkout";

export function actionCount(actions: InsightRow["actions"], type: string): number {
  if (!Array.isArray(actions)) return 0;
  return actions.filter((action) => action?.action_type === type).reduce((sum, action) => sum + num(action.value), 0);
}

export function resultOf(row: InsightRow, resultEvent: ResultEvent): number {
  if (resultEvent === "initiate_checkout") return actionCount(row.actions, IC_ACTION);
  if (resultEvent === "landing_page_view") return num(row.landing_page_views);
  return actionCount(row.actions, "omni_complete_registration");
}

/** Events on sale (G2's shared predicate, on-sale.ts) for an active client. */
export async function loadOnSaleEvents(db: Db, today: string): Promise<EventRow[]> {
  const archived = await loadArchivedClientIds(db as SupabaseClient);
  const events = await loadAll<EventRow>(db, "events", "id, name, event_code, event_date, general_sale_at, status, client_id, budget_marketing, drive_folder_id, signup_url, ticket_url", ["id"], (q) =>
    q.gte("event_date", today).neq("status", "cancelled"),
  );
  return events.filter((event) => event.client_id && !archived.has(event.client_id) && isOnSale(event, today));
}

export type RawInsights = { rows: InsightRow[]; context: AdContextIndex };

/**
 * Every ad-day, joined to its event by the learning loop's rule. All of
 * them: spend to date is an event's all-time spend, so no lower bound,
 * and the result does not depend on which other events are in the run.
 * Ordered by (date, meta_ad_id), the table's unique key, and deduped.
 */
export async function loadInsights(db: Db): Promise<RawInsights> {
  const [rows, context] = await Promise.all([
    loadAll<InsightRow>(db, "ad_daily_insights", "meta_ad_id, meta_adset_id, meta_campaign_id, ad_account_id, date, ad_name, adset_name, campaign_name, spend, landing_page_views, purchases, actions", ["date", "meta_ad_id"]),
    loadAdContextIndex(db as SupabaseClient),
  ]);
  return { rows, context };
}

export type Aux = {
  scores: { event_id: string; creative_name: string; score: number; significance: boolean }[];
  clusters: { id: string; name: string; interests: unknown; live_evidence: { cprIndex?: number | null; confidence?: Confidence; perClient?: { clientId: string; client: string; cprIndex: number | null; confidence: Confidence }[] } | null }[];
  launchedAdSets: { event_id: string | null; meta_adset_id: string; interest_ids: unknown }[];
  warnings: { id: string; event_id: string; claim: string; state: string; approved_at: string | null; runs_from: string | null; runs_to: string | null; render_id: string | null }[];
  ticketing: { client_id: string; provider: string | null; status: string | null }[];
  driveFolders: { event_id: string | null; key: string; name: string; drive_folder_id: string }[];
  /** Drive file ids of renders a Lab launch put into this event's campaigns (round_ads.launch_state = launched). */
  renderDriveIds: Set<string>;
};

type LaunchedRenderRow = { drive_file_id: string | null; creative_lab_round_ads: { launch_state: string | null; round: { event_id: string | null } | null }[] | null };

export async function loadAux(db: Db, eventIds: readonly string[], clientIds: readonly string[]): Promise<Aux> {
  const inEvents = (q: any) => q.in("event_id", eventIds);
  const [scores, clusters, launchedAdSets, warnings, ticketing, driveFolders, launchedRenders] = await Promise.all([
    eventIds.length
      ? loadAll<Aux["scores"][number] & { id: string; axis: string; fetched_at: string }>(db, "creative_scores", "id, event_id, creative_name, axis, score, significance, fetched_at", ["id"], (q) => inEvents(q).eq("axis", "convert"))
      : Promise.resolve([]),
    loadAll<Aux["clusters"][number]>(db, "interest_clusters", "id, name, interests, live_evidence", ["id"], (q) => q.is("archived_at", null).not("live_evidence", "is", null)),
    eventIds.length ? loadAll<Aux["launchedAdSets"][number]>(db, "launched_ad_sets", "event_id, meta_adset_id, interest_ids", ["meta_adset_id"], inEvents) : Promise.resolve([]),
    eventIds.length ? loadAll<Aux["warnings"][number]>(db, "ticket_warnings", "id, event_id, claim, state, approved_at, runs_from, runs_to, render_id", ["id"], inEvents) : Promise.resolve([]),
    clientIds.length ? loadAll<Aux["ticketing"][number] & { id: string }>(db, "client_ticketing_connections", "id, client_id, provider, status", ["id"], (q) => q.in("client_id", clientIds)) : Promise.resolve([]),
    eventIds.length ? loadAll<Aux["driveFolders"][number] & { id: string }>(db, "drive_folders", "id, event_id, key, name, drive_folder_id", ["id"], (q) => inEvents(q).like("key", "03/3/wc/%")) : Promise.resolve([]),
    loadAll<LaunchedRenderRow & { id: string }>(db, "creative_lab_renders", "id, drive_file_id, creative_lab_round_ads!inner(launch_state, round:creative_lab_rounds(event_id))", ["id"], (q) => q.not("drive_file_id", "is", null).eq("creative_lab_round_ads.launch_state", "launched")).catch(() => [] as (LaunchedRenderRow & { id: string })[]),
  ]);
  // The latest run's convert scores only.
  const latest = new Map<string, string>();
  for (const row of scores) {
    const have = latest.get(row.event_id);
    if (!have || row.fetched_at > have) latest.set(row.event_id, row.fetched_at);
  }
  return {
    scores: scores.filter((row) => latest.get(row.event_id) === row.fetched_at),
    clusters,
    launchedAdSets,
    warnings,
    ticketing,
    driveFolders,
    renderDriveIds: new Set(
      launchedRenders
        .filter((row) => (row.creative_lab_round_ads ?? []).some((ad) => ad.launch_state === "launched" && (!ad.round?.event_id || eventIds.includes(ad.round.event_id))))
        .map((row) => row.drive_file_id)
        .filter((id): id is string => Boolean(id)),
    ),
  };
}

/** The ad-days of one event, by the learning loop's join. */
export function rowsForEvent(raw: RawInsights, eventId: string): InsightRow[] {
  return raw.rows.filter((row) => resolveAdContext({ meta_ad_id: row.meta_ad_id, meta_adset_id: row.meta_adset_id, campaign_name: row.campaign_name, ad_account_id: row.ad_account_id }, raw.context).eventId === eventId);
}

const MIX_FOLDERS: Record<string, SupplyMix> = { ugc: "ugc", cta: "cta", "no cta": "no_cta" };

/**
 * The cycle folder's approved finals: every file under {owner} / Videos |
 * Statics, and under a UGC / CTA / No CTA folder inside those when the
 * tree has one. The legacy UGC folder straight under the cycle counts as
 * UGC. One listChildren per folder; the count is returned.
 */
export async function loadCycleSupply(drive: DriveApi | null, folders: Aux["driveFolders"], eventId: string, cycleMonday: string, renderDriveIds: ReadonlySet<string>): Promise<{ files: SupplyFile[]; driveCalls: number; reason: string | null }> {
  if (!drive) return { files: [], driveCalls: 0, reason: "Drive is not configured" };
  const prefix = `03/3/wc/${cycleMonday}`;
  const mine = folders.filter((folder) => folder.event_id === eventId && folder.key.startsWith(prefix));
  const owners = new Map(mine.filter((folder) => /\/owner\/[^/]+$/.test(folder.key)).map((folder) => [folder.key, folder.name]));
  const typeFolders = mine.filter((folder) => /\/owner\/[^/]+\/(videos|statics)$/.test(folder.key));
  const legacyUgc = mine.find((folder) => folder.key === `${prefix}/ugc`);
  const files: SupplyFile[] = [];
  let driveCalls = 0;
  const add = (file: DriveFile, owner: string, kind: "video" | "static" | null, mix: SupplyMix, path: string) => {
    const resolvedKind = kind ?? kindForFile(file);
    if (!resolvedKind || file.trashed) return;
    files.push({ fileId: file.id, name: file.name, owner, kind: resolvedKind, mix, path, alreadyInCampaign: renderDriveIds.has(file.id), matchedBy: "lab_launch" });
  };
  for (const folder of typeFolders) {
    const ownerKey = folder.key.replace(/\/(videos|statics)$/, "");
    const owner = owners.get(ownerKey) ?? "—";
    const kind = folder.key.endsWith("/videos") ? "video" : "static";
    const children = await drive.listChildren(folder.drive_folder_id);
    driveCalls += 1;
    for (const child of children) {
      if (child.mimeType === FOLDER_MIME) {
        const mix = MIX_FOLDERS[child.name.trim().toLowerCase()] ?? "unknown";
        const inner = await drive.listChildren(child.id);
        driveCalls += 1;
        for (const file of inner) if (file.mimeType !== FOLDER_MIME) add(file, owner, kind, mix, `${owner} / ${folder.name} / ${child.name}`);
        continue;
      }
      add(child, owner, kind, "unknown", `${owner} / ${folder.name}`);
    }
  }
  if (legacyUgc) {
    const children = await drive.listChildren(legacyUgc.drive_folder_id);
    driveCalls += 1;
    for (const file of children) if (file.mimeType !== FOLDER_MIME) add(file, "—", null, "ugc", "UGC");
  }
  return { files, driveCalls, reason: null };
}

export type EventInputs = {
  event: EventRow;
  plan: RunPlan;
  campaigns: CampaignInput[];
  driveCalls: number;
  driveReason: string | null;
};

function onSaleDayOf(event: EventRow): string | null {
  return event.general_sale_at ? event.general_sale_at.slice(0, 10) : null;
}

/** Every campaign of one event with spend in the window or since on sale, as CampaignInputs. */
export async function buildEventInputs(args: {
  event: EventRow;
  day: string;
  shadow: boolean;
  config: PhaseConfig;
  raw: RawInsights;
  aux: Aux;
  drive: DriveApi | null;
  /** The event's purchase read (purchase-read.ts); absent = not read. */
  purchases?: PurchaseRead;
}): Promise<EventInputs> {
  const { event, config, aux } = args;
  const plan = planRun({ day: args.day, eventDate: event.event_date, config, shadow: args.shadow });
  const rows = rowsForEvent(args.raw, event.id).filter((row) => row.date <= plan.window.end);
  const onSaleDay = onSaleDayOf(event);
  const sinceDay = onSaleDay && onSaleDay <= plan.window.end ? onSaleDay : plan.window.start;
  const last14From = addDaysIso(plan.window.end, -13);
  const last14 = { ic: 0, purchases: 0, lpv: 0 };
  const sinceOnSale = { ic: 0, purchases: 0, fromDay: sinceDay };
  let spendToDate = 0;
  for (const row of rows) {
    spendToDate += num(row.spend);
    if (row.date >= last14From) {
      last14.ic += actionCount(row.actions, IC_ACTION);
      last14.purchases += num(row.purchases);
      last14.lpv += num(row.landing_page_views);
    }
    if (row.date >= sinceDay) {
      sinceOnSale.ic += actionCount(row.actions, IC_ACTION);
      sinceOnSale.purchases += num(row.purchases);
    }
  }
  const resultEvent = chooseObjective({ last14 }, config);
  const budget = event.budget_marketing == null ? null : num(event.budget_marketing);
  const ticketing = aux.ticketing.filter((row) => row.client_id === event.client_id && (row.status ?? "active") !== "error");
  const scores = new Map(aux.scores.filter((row) => row.event_id === event.id).map((row) => [row.creative_name, row]));
  const usedInterests = new Set<string>();
  for (const set of aux.launchedAdSets.filter((set) => set.event_id === event.id)) {
    for (const id of Array.isArray(set.interest_ids) ? set.interest_ids : []) usedInterests.add(String((id as { id?: unknown })?.id ?? id));
  }
  // G1: the client's own results only — the perClient entry for this event's client, never the pooled index.
  const clusters: ClusterInput[] = aux.clusters.map((cluster) => {
    const interests = Array.isArray(cluster.interests) ? cluster.interests.map((item) => String((item as { id?: unknown })?.id ?? item)) : [];
    const own = (cluster.live_evidence?.perClient ?? []).find((entry) => entry.clientId === event.client_id) ?? null;
    return {
      id: cluster.id,
      name: cluster.name,
      client: own?.client ?? null,
      index: own?.cprIndex ?? null,
      confidence: own ? (CONFIDENCE_SCORE[own.confidence] ?? 0) : 0,
      confidenceWord: own?.confidence ?? "thin",
      usedOnEvent: interests.length > 0 && interests.every((id) => usedInterests.has(id)),
    };
  });
  const claims: ClaimInput[] = aux.warnings
    .filter((row) => row.event_id === event.id && (row.state === "live" || row.state === "scheduled") && row.approved_at)
    .map((row) => ({ id: row.id, claim: row.claim, approvedAt: row.approved_at, runsFrom: row.runs_from, runsTo: row.runs_to, renderId: row.render_id }));

  const supply = plan.runKind === "mid_cycle" || plan.showWeek ? { files: [], driveCalls: 0, reason: null } : await loadCycleSupply(args.drive, aux.driveFolders, event.id, plan.cycleMonday, aux.renderDriveIds);

  // Campaigns by name; a rebuilt campaign under the same name is the same campaign.
  const byName = new Map<string, InsightRow[]>();
  for (const row of rows) {
    const key = (row.campaign_name ?? row.meta_campaign_id ?? "—").trim();
    const list = byName.get(key) ?? [];
    list.push(row);
    byName.set(key, list);
  }
  const campaigns: CampaignInput[] = [];
  for (const [campaignKey, campaignRows] of byName) {
    const inWindow = campaignRows.filter((row) => row.date >= plan.window.start && row.date <= plan.window.end);
    const since = campaignRows.filter((row) => row.date >= sinceDay);
    if (!inWindow.some((row) => num(row.spend) > 0)) continue;
    const ads = new Map<string, AdInput>();
    const adSets = new Map<string, AdSetInput>();
    let weekSpend = 0;
    let weekResults = 0;
    let totalSpend = 0;
    let totalResults = 0;
    let totalFirstDay: string | null = null;
    const lastTwo = [plan.window.end, addDaysIso(plan.window.end, -1)];
    for (const row of since) {
      const spend = num(row.spend);
      const results = resultOf(row, resultEvent);
      const week = row.date >= plan.window.start;
      totalSpend += spend;
      totalResults += results;
      if (spend > 0 && (!totalFirstDay || row.date < totalFirstDay)) totalFirstDay = row.date;
      if (week) {
        weekSpend += spend;
        weekResults += results;
      }
      const score = scores.get(row.ad_name ?? "");
      const ad = ads.get(row.meta_ad_id) ?? {
        adId: row.meta_ad_id,
        adsetId: row.meta_adset_id ?? "",
        name: row.ad_name ?? row.meta_ad_id,
        firstDay: row.date,
        lastDay: row.date,
        weekSpend: 0,
        weekResults: 0,
        totalSpend: 0,
        totalResults: 0,
        convertScore: score?.score ?? null,
        significant: score?.significance ?? false,
      };
      if (row.date < ad.firstDay) ad.firstDay = row.date;
      if (row.date > ad.lastDay) ad.lastDay = row.date;
      ad.totalSpend += spend;
      ad.totalResults += results;
      if (week) {
        ad.weekSpend += spend;
        ad.weekResults += results;
      }
      ads.set(row.meta_ad_id, ad);
      // F4: an ad set is its name within the campaign; the 6 Nov rebuild's copy of an ad set is the same ad set.
      const setId = row.meta_adset_id ?? "";
      const setKey = (row.adset_name ?? setId).trim();
      const set = adSets.get(setKey) ?? { adsetId: setId, adsetIds: [], name: setKey, firstDay: row.date, lastDay: row.date, weekSpend: 0, weekResults: 0, totalSpend: 0, totalResults: 0, delivering: false };
      if (setId && !set.adsetIds.includes(setId)) set.adsetIds.push(setId);
      if (setId && (spend > 0 ? row.date >= set.lastDay : !set.adsetId)) set.adsetId = setId;
      if (row.date < set.firstDay) set.firstDay = row.date;
      if (spend > 0 && row.date > set.lastDay) set.lastDay = row.date;
      set.totalSpend += spend;
      set.totalResults += results;
      if (week) {
        set.weekSpend += spend;
        set.weekResults += results;
      }
      if (spend > 0 && lastTwo.includes(row.date)) set.delivering = true;
      adSets.set(setKey, set);
    }
    campaigns.push({
      eventId: event.id,
      eventCode: event.event_code,
      eventName: event.name,
      campaignKey,
      campaignIds: [...new Set(campaignRows.map((row) => row.meta_campaign_id).filter((id): id is string => Boolean(id)))],
      onSaleDay,
      plan,
      resultEvent,
      weekSpend,
      weekResults,
      totalSpend,
      totalResults,
      totalFirstDay,
      ads: [...ads.values()],
      adSets: [...adSets.values()],
      clusters,
      supply: supply.files,
      claims,
      budgetGbp: budget,
      spendToDateGbp: spendToDate,
      ticketingLinked: ticketing.length > 0,
      ticketingProvider: ticketing[0]?.provider ?? null,
      last14,
      sinceOnSale,
      purchases: args.purchases,
    });
  }
  campaigns.sort((a, b) => b.weekSpend - a.weekSpend);
  return { event, plan, campaigns, driveCalls: supply.driveCalls, driveReason: supply.reason };
}

export function driveForRefresh(env: Record<string, string | undefined>): { drive: DriveApi | null; reason: string | null } {
  return driveFromEnv(env);
}
