/**
 * Gather one CampaignInput per on-sale campaign from what the app already
 * has: ad_daily_insights (results in actions, spend, days), creative_scores
 * (convert axis, significance), interest_clusters.live_evidence, the
 * ticket-warning rows, events.budget_marketing, the ticketing link, and
 * the cycle's Drive folders (one listChildren per owner type folder).
 *
 * Reads only. Every table read is paginated with .range (PostgREST's
 * 1,000-row cap). Archived clients are left out (lib/db/client-status.ts).
 * Meta is never called; the Drive read is the only call out, and a run
 * with no Drive credentials still produces every line but the adds.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadArchivedClientIds } from "../db/client-status.ts";
import { driveFromEnv, FOLDER_MIME, type DriveApi, type DriveFile } from "../drive/client.ts";
import { kindForFile } from "../drive/tree.ts";
import { loadAdContextIndex, resolveAdContext, type AdContextIndex } from "../learning/ad-facts.ts";
import { CONFIDENCE_SCORE, type Confidence } from "../learning/shrink.ts";
import type { PhaseConfig, ResultEvent } from "./phase-config.ts";
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

async function loadAll<T>(db: Db, table: string, columns: string, filter?: (q: any) => any): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = db.from(table).select(columns).range(from, from + PAGE - 1);
    if (filter) query = filter(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    const chunk = (data ?? []) as T[];
    rows.push(...chunk);
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

/** Events on sale for an active client, with a date still ahead. */
export async function loadOnSaleEvents(db: Db, today: string): Promise<EventRow[]> {
  const archived = await loadArchivedClientIds(db as SupabaseClient);
  const events = await loadAll<EventRow>(db, "events", "id, name, event_code, event_date, general_sale_at, status, client_id, budget_marketing, drive_folder_id", (q) =>
    q.not("general_sale_at", "is", null).gte("event_date", today).neq("status", "cancelled"),
  );
  return events.filter((event) => event.client_id && !archived.has(event.client_id) && (event.general_sale_at ?? "") <= `${today}T23:59:59Z`);
}

export type RawInsights = { rows: InsightRow[]; context: AdContextIndex };

/** Every ad-day from `since`, joined to its event by the learning loop's rule. */
export async function loadInsights(db: Db, since: string): Promise<RawInsights> {
  const [rows, context] = await Promise.all([
    loadAll<InsightRow>(db, "ad_daily_insights", "meta_ad_id, meta_adset_id, meta_campaign_id, ad_account_id, date, ad_name, adset_name, campaign_name, spend, landing_page_views, purchases, actions", (q) => q.gte("date", since)),
    loadAdContextIndex(db as SupabaseClient),
  ]);
  return { rows, context };
}

export type Aux = {
  scores: { event_id: string; creative_name: string; score: number; significance: boolean }[];
  clusters: { id: string; name: string; interests: unknown; live_evidence: { cprIndex?: number | null; confidence?: Confidence } | null }[];
  launchedAdSets: { event_id: string | null; meta_adset_id: string; interest_ids: unknown }[];
  warnings: { id: string; event_id: string; claim: string; state: string; approved_at: string | null; runs_from: string | null; runs_to: string | null; render_id: string | null }[];
  ticketing: { client_id: string; provider: string | null; status: string | null }[];
  driveFolders: { event_id: string | null; key: string; name: string; drive_folder_id: string }[];
  renderDriveIds: Set<string>;
};

export async function loadAux(db: Db, eventIds: readonly string[], clientIds: readonly string[]): Promise<Aux> {
  const inEvents = (q: any) => q.in("event_id", eventIds);
  const [scores, clusters, launchedAdSets, warnings, ticketing, driveFolders, launchedRenders] = await Promise.all([
    eventIds.length
      ? loadAll<Aux["scores"][number] & { axis: string; fetched_at: string }>(db, "creative_scores", "event_id, creative_name, axis, score, significance, fetched_at", (q) => inEvents(q).eq("axis", "convert"))
      : Promise.resolve([]),
    loadAll<Aux["clusters"][number]>(db, "interest_clusters", "id, name, interests, live_evidence", (q) => q.is("archived_at", null).not("live_evidence", "is", null)),
    eventIds.length ? loadAll<Aux["launchedAdSets"][number]>(db, "launched_ad_sets", "event_id, meta_adset_id, interest_ids", inEvents) : Promise.resolve([]),
    eventIds.length ? loadAll<Aux["warnings"][number]>(db, "ticket_warnings", "id, event_id, claim, state, approved_at, runs_from, runs_to, render_id", inEvents) : Promise.resolve([]),
    clientIds.length ? loadAll<Aux["ticketing"][number]>(db, "client_ticketing_connections", "client_id, provider, status", (q) => q.in("client_id", clientIds)) : Promise.resolve([]),
    eventIds.length ? loadAll<Aux["driveFolders"][number]>(db, "drive_folders", "event_id, key, name, drive_folder_id", (q) => inEvents(q).like("key", "03/3/wc/%")) : Promise.resolve([]),
    loadAll<{ drive_file_id: string | null }>(db, "creative_lab_renders", "drive_file_id, creative_lab_round_ads!inner(launch_state)", (q) => q.not("drive_file_id", "is", null)).catch(() => [] as { drive_file_id: string | null }[]),
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
    renderDriveIds: new Set(launchedRenders.map((row) => row.drive_file_id).filter((id): id is string => Boolean(id))),
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
    files.push({ fileId: file.id, name: file.name, owner, kind: resolvedKind, mix, path, alreadyInCampaign: renderDriveIds.has(file.id) });
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
  const clusters: ClusterInput[] = aux.clusters.map((cluster) => {
    const interests = Array.isArray(cluster.interests) ? cluster.interests.map((item) => String((item as { id?: unknown })?.id ?? item)) : [];
    return {
      id: cluster.id,
      name: cluster.name,
      index: cluster.live_evidence?.cprIndex ?? null,
      confidence: CONFIDENCE_SCORE[cluster.live_evidence?.confidence ?? "thin"] ?? 0,
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
      const setId = row.meta_adset_id ?? "";
      const set = adSets.get(setId) ?? { adsetId: setId, name: row.adset_name ?? setId, firstDay: row.date, lastDay: row.date, weekSpend: 0, weekResults: 0, totalSpend: 0, totalResults: 0, delivering: false };
      if (row.date < set.firstDay) set.firstDay = row.date;
      if (spend > 0 && row.date > set.lastDay) set.lastDay = row.date;
      set.totalSpend += spend;
      set.totalResults += results;
      if (week) {
        set.weekSpend += spend;
        set.weekResults += results;
      }
      if (spend > 0 && lastTwo.includes(row.date)) set.delivering = true;
      adSets.set(setId, set);
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
    });
  }
  campaigns.sort((a, b) => b.weekSpend - a.weekSpend);
  return { event, plan, campaigns, driveCalls: supply.driveCalls, driveReason: supply.reason };
}

export function driveForRefresh(env: Record<string, string | undefined>): { drive: DriveApi | null; reason: string | null } {
  return driveFromEnv(env);
}
