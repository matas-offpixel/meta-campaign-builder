/**
 * The Retargeting campaign's daily read (docs/design-record/2026-11-17-retargeting-campaign.html,
 * RT1, RT4, RT7, RT8; HR3). PR A: the Create line and the not-proposed
 * states. PR B adds the tiers' figures and the moves, holds and cuts.
 *
 * Every morning at 08:00 London over the last 7 days (to yesterday), for
 * every on-sale show to its show day (it carries on through show week, as
 * the on-sale refresh doesn't): the show's purchase read (the on-sale
 * refresh's, Meta reads only), its on-sale campaigns' ad-days, its source
 * set (pixel, page and ticket URLs, the promoter / event / venue / lineup
 * pages and whether the operator's Facebook user holds a role on each,
 * its role lists) and its money, into one proposal under campaign_key
 * `{code} · Retargeting` (run_kind retargeting, migration 256) with at most
 * one line, the Create line. Earlier unanswered lines expire.
 *
 * Writes proposals only, never to Meta. Killswitch: ENABLE_RETARGETING_READ
 * must be exactly "1"; a dry run writes nothing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { applyGates, type ArmMode } from "../onsale-refresh/apply-gates.ts";
import { buildEventInputs, loadAll, loadAux, loadInsights, loadOnSaleEvents, rowsForEvent, type EventRow } from "../onsale-refresh/load.ts";
import { ONSALE_PHASE } from "../onsale-refresh/phase-config.ts";
import { loadPurchaseReads, type RefreshGraph } from "../onsale-refresh/purchase-read.ts";
import { committedGbpOf, type PcBudgets } from "../onsale-refresh/purchase-campaign.ts";
import { moveGuard } from "../onsale-refresh/plan-guard.ts";
import { RETARGETING } from "../onsale-refresh/rules.ts";
import { addDaysIso, planRun, todayLondon } from "../onsale-refresh/schedule.ts";
import { urlFragment, type SourceList, type SourcePage, type SourceSet } from "./audiences.ts";
import { readRunning, type RunningRead } from "./delivery.ts";
import { planRetargeting, retargetingOnSaleDay, type LiveRead, type RetargetingInput, type RetargetingPlan } from "./plan.ts";
import { isRetargetingCampaignName, isTestsCampaignName, retargetingCampaignName, TIERS, type Tier } from "./words.ts";

type Db = Pick<SupabaseClient, "from">;

export const RETARGETING_READ_ENV = "ENABLE_RETARGETING_READ";

export function isRetargetingReadEnabled(env: Record<string, string | undefined>): boolean {
  return env[RETARGETING_READ_ENV] === "1";
}

/** 08:00 London: vercel.json runs "0 7,8 * * *" (UTC) and the read acts on the London 08:00 one. */
export function isEightLondon(now: Date): boolean {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(now) === "08";
}

const MAX_REUSED_ADS = 6;
const PAGE_TASKS = new Set(["ADVERTISE", "FULL_CONTROL", "MANAGE", "CREATE_ADS"]);

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** The pages the operator's Facebook user holds a role on (at least ADVERTISE), with their Instagram accounts. Null when not read. */
export async function pagesWithRole(graph: RefreshGraph | null): Promise<{ roles: Map<string, string | null>; calls: number } | null> {
  if (!graph) return null;
  const roles = new Map<string, string | null>();
  let calls = 0;
  let after: string | null = null;
  try {
    for (let page = 0; page < 10; page += 1) {
      calls += 1;
      const body = (await graph.graphGet("/me/accounts", { fields: "id,tasks,instagram_business_account{id}", limit: "100", ...(after ? { after } : {}) })) as { data?: { id: string; tasks?: string[]; instagram_business_account?: { id?: string } }[]; paging?: { cursors?: { after?: string }; next?: string } };
      for (const row of body.data ?? []) if ((row.tasks ?? []).some((task) => PAGE_TASKS.has(task))) roles.set(row.id, row.instagram_business_account?.id ?? null);
      after = body.paging?.next ? (body.paging.cursors?.after ?? null) : null;
      if (!after) break;
    }
  } catch {
    return null;
  }
  return { roles, calls };
}

type SourceRows = {
  clients: { id: string; name: string | null; default_page_ids: string[] | null; default_instagram_actor_id: string | null }[];
  events: { id: string; venue_id: string | null }[];
  venues: { id: string; name: string | null; meta_page_id: string | null; meta_page_name: string | null }[];
  lineup: { event_id: string; artist_id: string; billing_order: number | null }[];
  artists: { id: string; name: string | null; meta_page_id: string | null; meta_page_name: string | null }[];
  lists: { event_id: string | null; name: string; list_role: string | null; meta_audience_id: string | null; status: string; source_meta: { uploadedAt?: string } | null; updated_at: string }[];
};

/** The source-set reads: the client's pages, the venue's, the lineup's, and the shows' role lists. Paged. */
export async function loadSourceRows(db: Db, eventIds: readonly string[], clientIds: readonly string[]): Promise<SourceRows> {
  if (!eventIds.length) return { clients: [], events: [], venues: [], lineup: [], artists: [], lists: [] };
  const [clients, events, lineup, lists] = await Promise.all([
    loadAll<SourceRows["clients"][number]>(db, "clients", "id, name, default_page_ids, default_instagram_actor_id", ["id"], (q) => q.in("id", clientIds)),
    loadAll<SourceRows["events"][number]>(db, "events", "id, venue_id", ["id"], (q) => q.in("id", eventIds)),
    loadAll<SourceRows["lineup"][number] & { id: string }>(db, "event_artists", "id, event_id, artist_id, billing_order", ["id"], (q) => q.in("event_id", eventIds)).catch(() => []),
    loadAll<SourceRows["lists"][number] & { id: string }>(db, "meta_custom_audiences", "id, event_id, name, list_role, meta_audience_id, status, source_meta, updated_at", ["id"], (q) => q.in("event_id", eventIds).eq("audience_subtype", "customer_list")).catch(() => []),
  ]);
  const venueIds = [...new Set(events.map((row) => row.venue_id).filter((id): id is string => Boolean(id)))];
  const artistIds = [...new Set(lineup.map((row) => row.artist_id))];
  const [venues, artists] = await Promise.all([
    venueIds.length ? loadAll<SourceRows["venues"][number]>(db, "venues", "id, name, meta_page_id, meta_page_name", ["id"], (q) => q.in("id", venueIds)).catch(() => []) : Promise.resolve([]),
    artistIds.length ? loadAll<SourceRows["artists"][number]>(db, "artists", "id, name, meta_page_id, meta_page_name", ["id"], (q) => q.in("id", artistIds)).catch(() => []) : Promise.resolve([]),
  ]);
  return { clients, events, venues, lineup, artists, lists };
}

/** RT2's source set for one show: one set feeds every window. */
export function sourceSetFor(args: { event: EventRow; rows: SourceRows; pixelId: string | null; roles: Map<string, string | null> | null; hasVideo: boolean }): SourceSet {
  const { event, rows } = args;
  const pages: SourcePage[] = [];
  const add = (id: string | null | undefined, name: string, kind: SourcePage["kind"], igId: string | null = null) => {
    if (!id) return;
    const role = args.roles ? args.roles.has(id) : null;
    pages.push({ id, name, igId: igId ?? (args.roles?.get(id) ?? null), kind, hasRole: role });
  };
  const client = rows.clients.find((row) => row.id === event.client_id);
  (client?.default_page_ids ?? []).forEach((id, index) => add(id, client?.name ?? "Promoter page", "promoter", index === 0 ? (client?.default_instagram_actor_id ?? null) : null));
  const venueId = rows.events.find((row) => row.id === event.id)?.venue_id ?? null;
  const venue = rows.venues.find((row) => row.id === venueId);
  if (venue) add(venue.meta_page_id, venue.meta_page_name ?? venue.name ?? "Venue page", "venue");
  const acts = rows.lineup.filter((row) => row.event_id === event.id).sort((a, b) => (a.billing_order ?? 0) - (b.billing_order ?? 0));
  for (const act of acts) {
    const artist = rows.artists.find((row) => row.id === act.artist_id);
    if (artist) add(artist.meta_page_id, artist.meta_page_name ?? artist.name ?? "Lineup page", "lineup");
  }
  const lists: SourceList[] = rows.lists
    .filter((row) => row.event_id === event.id && row.meta_audience_id && row.status !== "archived" && (row.list_role === "signups" || row.list_role === "similar" || row.list_role === "buyers"))
    .map((row) => ({ metaAudienceId: row.meta_audience_id!, name: row.name, role: row.list_role as SourceList["role"], uploadedAt: row.source_meta?.uploadedAt ?? row.updated_at }));
  return {
    pixelId: args.pixelId,
    ticketUrl: urlFragment(event.ticket_url),
    pageUrl: urlFragment(event.signup_url),
    // The show's videos are listed at Apply (one walk of its campaigns' ads); here, whether its ads have video at all.
    videos: args.hasVideo ? [{ contextId: "", videoIds: ["pending"] }] : [],
    pages,
    lists,
  };
}

export type RetargetingRecord = { eventId: string; eventCode: string | null; plan: RetargetingPlan; proposalId: string | null };

export type RetargetingReadResult =
  | { ok: true; skippedReason: "killswitch" | "not_08_london" }
  | { ok: boolean; dryRun: boolean; day: string; events: number; records: RetargetingRecord[]; skipped: { eventCode: string | null; reason: string }[]; metaCalls: number; errors: string[] };

/** The show's inputs for planRetargeting, from what the on-sale refresh's loaders gathered. Pure. */
export function retargetingInput(args: {
  event: EventRow;
  day: string;
  rows: ReturnType<typeof rowsForEvent>;
  campaigns: Awaited<ReturnType<typeof buildEventInputs>>["campaigns"];
  read: RetargetingInput["read"];
  budgets: PcBudgets | null;
  sources: SourceSet;
  appliedLine: { applied_result: Record<string, unknown> | null; write: Record<string, unknown> | null } | null;
  minDailyMinor: number | null;
  /** HR4: Meta's read of the running campaign (status, tier budgets, frequency, pool). */
  running?: RunningRead | null;
}): RetargetingInput {
  const { event, day } = args;
  const code = event.event_code ?? event.id;
  const end = addDaysIso(day, -1);
  const start = addDaysIso(end, -6);
  const lastTwo = new Set([end, addDaysIso(end, -1)]);
  const onSale = (name: string | null | undefined) => !isRetargetingCampaignName(name, code) && !isTestsCampaignName(name, code);
  const rows = args.rows.filter((row) => row.date <= end);
  const last7 = rows.filter((row) => row.date >= start && onSale(row.campaign_name)).reduce((sum, row) => sum + num(row.spend), 0);
  const named = rows.find((row) => isRetargetingCampaignName(row.campaign_name, code) && row.meta_campaign_id);
  const progress = (args.appliedLine?.applied_result?.retargeting ?? null) as { campaignId?: string; share?: number; adSets?: Partial<Record<Tier, { dailyMinor: number }>> } | null;
  const firstDay = rows.filter((row) => isRetargetingCampaignName(row.campaign_name, code) && num(row.spend) > 0).map((row) => row.date).sort()[0] ?? null;
  const tiers = progress?.adSets ? Object.fromEntries(TIERS.map((tier) => [tier, progress.adSets?.[tier]?.dailyMinor ?? 0])) as Record<Tier, number> : undefined;
  const existing = named || progress?.campaignId
    ? { campaignId: progress?.campaignId ?? named?.meta_campaign_id ?? null, since: firstDay, totalMinor: tiers ? TIERS.reduce((sum, tier) => sum + tiers[tier], 0) : null, share: progress?.share ?? null, ...(tiers ? { tiers } : {}), live: liveRead(args.running ?? null, rows, start, end) }
    : null;
  const campaigns = args.campaigns;
  const legacy = campaigns.map((campaign) => ({ campaign: campaign.campaignKey, adSets: campaign.adSets.filter((set) => set.delivering && RETARGETING.test(set.name)).length }));
  const main = campaigns.find((campaign) => campaign.draft) ?? null;
  const mainId = main?.campaignIds.find((id) => args.budgets?.campaigns.has(id)) ?? main?.campaignIds[0] ?? null;
  const mainRows = main ? rows.filter((row) => (row.campaign_name ?? "").trim() === main.campaignKey) : [];
  const ads = new Map<string, { adId: string; name: string; spend: number }>();
  for (const campaign of campaigns) {
    for (const ad of campaign.ads) {
      if (!(ad.weekSpend > 0) || !lastTwo.has(ad.lastDay)) continue;
      const have = ads.get(ad.name);
      if (!have || ad.weekSpend > have.spend) ads.set(ad.name, { adId: ad.adId, name: ad.name, spend: ad.weekSpend });
    }
  }
  const geo = main?.adSets.filter((set) => set.delivering).sort((a, b) => b.weekSpend - a.weekSpend)[0]?.adsetId ?? null;
  const committed = args.budgets && event.event_date ? committedGbpOf({ rows, runDay: day, eventDate: event.event_date, windowEnd: end, budgets: args.budgets }) : null;
  return {
    eventId: event.id,
    eventCode: code,
    runDay: day,
    eventDate: event.event_date,
    onSaleDay: retargetingOnSaleDay(event),
    read: args.read,
    last7SpendGbp: Math.round(last7 * 100) / 100,
    minDailyMinor: args.minDailyMinor,
    sources: args.sources,
    existing,
    legacy,
    budgetGbp: event.budget_marketing == null ? null : num(event.budget_marketing),
    spendToDateGbp: Math.round(rows.reduce((sum, row) => sum + num(row.spend), 0) * 100) / 100,
    committedGbp: committed,
    main: main
      ? {
          campaignKey: main.campaignKey,
          campaignId: mainId,
          lifetimeGbp: mainId ? (args.budgets?.campaigns.get(mainId)?.lifetime ?? null) : null,
          spentToDate: Math.round(mainRows.filter((row) => !mainId || row.meta_campaign_id === mainId).reduce((sum, row) => sum + num(row.spend), 0) * 100) / 100,
          last7Daily: Math.round((mainRows.filter((row) => row.date >= start).reduce((sum, row) => sum + num(row.spend), 0) / 7) * 100) / 100,
        }
      : null,
    ads: [...ads.values()].sort((a, b) => b.spend - a.spend).slice(0, MAX_REUSED_ADS).map(({ adId, name }) => ({ adId, name })),
    geoFromAdsetId: geo,
    where: { draftId: main?.draft?.draftId ?? null, adAccountId: main?.draft?.adAccountId ?? null, campaignIds: main?.campaignIds ?? [] },
    videoCampaignIds: [...new Set(campaigns.flatMap((campaign) => campaign.campaignIds))],
    today: day,
  };
}

/** RT3 / RT5: each tier's 7 days from ad_daily_insights (spend, attributed purchases), joined to Meta's read. */
export function liveRead(running: RunningRead | null, rows: readonly { date: string; meta_adset_id?: string | null; spend: number | string; purchases: number | string }[], start: string, end: string): LiveRead | null {
  if (!running) return null;
  const tiers: LiveRead["tiers"] = {};
  for (const tier of TIERS) {
    const row = running.tiers[tier];
    if (!row) continue;
    const week = rows.filter((insight) => insight.meta_adset_id === row.adsetId && insight.date >= start && insight.date <= end);
    tiers[tier] = {
      adsetId: row.adsetId,
      dailyMinor: row.dailyMinor,
      frequency: row.frequency,
      pool: row.pool,
      spendMinor: Math.round(week.reduce((sum, insight) => sum + num(insight.spend), 0) * 100),
      purchases: week.reduce((sum, insight) => sum + num(insight.purchases), 0),
    };
  }
  return { status: running.status, tiers };
}

/** The ad set ids the Create line stored, by tier. */
function knownAdSets(appliedLine: { applied_result: Record<string, unknown> | null } | null): Partial<Record<Tier, string>> {
  const sets = ((appliedLine?.applied_result?.retargeting ?? null) as { adSets?: Partial<Record<Tier, { id?: string }>> } | null)?.adSets ?? {};
  return Object.fromEntries(TIERS.flatMap((tier) => (sets[tier]?.id ? [[tier, sets[tier]!.id!]] : []))) as Partial<Record<Tier, string>>;
}

export async function runRetargetingRead(input: {
  env: Record<string, string | undefined>;
  db: Db;
  now?: Date;
  dryRun?: boolean;
  /** Act whatever the hour (a hand run, the dry-run script). */
  force?: boolean;
  eventCodes?: readonly string[];
  graph?: RefreshGraph | null;
  graphReason?: string;
  userId?: string;
}): Promise<RetargetingReadResult> {
  const dryRun = input.dryRun === true;
  if (!dryRun && !isRetargetingReadEnabled(input.env)) return { ok: true, skippedReason: "killswitch" };
  const now = input.now ?? new Date();
  if (!input.force && !dryRun && !isEightLondon(now)) return { ok: true, skippedReason: "not_08_london" };
  const day = todayLondon(now);
  const config = ONSALE_PHASE;
  const errors: string[] = [];
  const skipped: { eventCode: string | null; reason: string }[] = [];
  let events = await loadOnSaleEvents(input.db, day);
  if (input.eventCodes?.length) {
    const wanted = new Set(input.eventCodes.map((code) => code.trim().toLowerCase()));
    events = events.filter((event) => wanted.has((event.event_code ?? "").toLowerCase()));
  }
  events = events.filter((event) => {
    if (event.event_code) return true;
    skipped.push({ eventCode: null, reason: `${event.name}: no event code to name the campaign` });
    return false;
  });
  if (!events.length) return { ok: true, dryRun, day, events: 0, records: [], skipped, metaCalls: 0, errors };
  const clientIds = [...new Set(events.map((event) => event.client_id).filter((id): id is string => Boolean(id)))];
  const [raw, aux, sourceRows] = await Promise.all([loadInsights(input.db), loadAux(input.db, events.map((event) => event.id), clientIds), loadSourceRows(input.db, events.map((event) => event.id), clientIds)]);
  const purchases = await loadPurchaseReads({
    db: input.db,
    events: events.map((event) => ({ id: event.id, event_code: event.event_code, client_id: event.client_id, event_date: event.event_date, signup_url: event.signup_url ?? null, ticket_url: event.ticket_url ?? null, presale_at: event.presale_at ?? null, general_sale_at: event.general_sale_at })),
    raw,
    day,
    shadow: true,
    config,
    graph: input.graph ?? null,
    graphReason: input.graphReason,
    now,
  }).catch((err) => {
    skipped.push({ eventCode: null, reason: `Purchase read failed: ${err instanceof Error ? err.message : String(err)}` });
    return { reads: new Map(), metaCalls: 0, cirqlinReads: 0, notes: [] as string[], budgets: { campaigns: new Map(), adSets: new Map() } };
  });
  const roles = await pagesWithRole(input.graph ?? null);
  let metaCalls = purchases.metaCalls + (roles?.calls ?? 0);
  const arms = dryRun ? new Map<string, ArmMode>() : await loadArms(input.db, events.map((event) => event.id));
  const lines = await loadAll<{ id: string; state: string; write: Record<string, unknown> | null; applied_result: Record<string, unknown> | null; onsale_refresh_proposals: { event_id: string | null } | null }>(input.db, "onsale_refresh_lines", "id, state, write, applied_result, onsale_refresh_proposals!inner(event_id)", ["id"], (q) => q.eq("kind", "retargeting_campaign").in("onsale_refresh_proposals.event_id", events.map((event) => event.id))).catch(() => []);
  const minDaily = new Map<string, number | null>();
  const records: RetargetingRecord[] = [];
  for (const event of events) {
    try {
      const read = purchases.reads.get(event.id);
      const inputs = await buildEventInputs({ event, day, shadow: true, config, raw, aux, drive: null, purchases: read, purchaseBudgets: purchases.budgets });
      const rows = rowsForEvent(raw, event.id);
      const code = event.event_code!;
      const hasVideo = rows.some((row) => !isRetargetingCampaignName(row.campaign_name, code) && num(row.video_plays_3s) > 0);
      const sources = sourceSetFor({ event, rows: sourceRows, pixelId: read?.pixel?.id ?? null, roles: roles?.roles ?? null, hasVideo });
      const mine = lines.filter((line) => line.onsale_refresh_proposals?.event_id === event.id);
      const appliedLine = mine.find((line) => (line.applied_result?.retargeting as { campaignId?: string } | undefined)?.campaignId) ?? null;
      const account = inputs.campaigns.find((campaign) => campaign.draft)?.draft?.adAccountId ?? null;
      if (account && input.graph && !minDaily.has(account)) {
        metaCalls += 1;
        minDaily.set(account, await input.graph.graphGet(`/${account}`, { fields: "min_daily_budget" }).then((body) => num((body as { min_daily_budget?: unknown }).min_daily_budget) || null).catch(() => null));
      }
      // HR4: a running campaign is read from Meta every morning, through show week to the show day (RT7).
      const campaignId = (appliedLine?.applied_result?.retargeting as { campaignId?: string } | undefined)?.campaignId ?? rows.find((row) => isRetargetingCampaignName(row.campaign_name, code) && row.meta_campaign_id)?.meta_campaign_id ?? null;
      let running: RunningRead | null = null;
      if (campaignId && input.graph) {
        const until = addDaysIso(day, -1);
        running = await readRunning(input.graph.graphGet, { campaignId, code, since: addDaysIso(until, -6), until, known: knownAdSets(appliedLine) });
        metaCalls += running.calls;
        for (const reason of running.errors) skipped.push({ eventCode: code, reason: `Retargeting read: ${reason}` });
      }
      const plan = planRetargeting(retargetingInput({ event, day, rows, campaigns: inputs.campaigns, read, budgets: purchases.budgets, sources, appliedLine, minDailyMinor: account ? (minDaily.get(account) ?? null) : null, running }));
      const record: RetargetingRecord = { eventId: event.id, eventCode: event.event_code, plan, proposalId: null };
      if (!dryRun && plan.state !== "no_signal") {
        const createWrite = (appliedLine?.write ?? null) as { draftId?: string | null; adAccountId?: string | null } | null;
        const where = campaignId ? { draftId: createWrite?.draftId ?? null, adAccountId: createWrite?.adAccountId ?? account, campaignIds: [campaignId] } : null;
        const spendToDate = Math.round(rows.reduce((sum, row) => sum + num(row.spend), 0) * 100) / 100;
        const budget = event.budget_marketing == null ? null : num(event.budget_marketing);
        record.proposalId = await writeRetargetingProposal(input.db, { event, day, plan, mode: applyGates(input.env, arms.get(event.id)).mode, userId: input.userId, where, guard: { budget, spendToDate } });
      }
      records.push(record);
    } catch (err) {
      errors.push(`${event.event_code ?? event.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`[retargeting-read] done ok=${errors.length === 0} dry_run=${dryRun} day=${day} events=${events.length} proposed=${records.filter((row) => row.plan.state === "proposed").length} meta_calls=${metaCalls} errors=${errors.length}`);
  return { ok: errors.length === 0, dryRun, day, events: events.length, records, skipped, metaCalls, errors };
}

async function loadArms(db: Db, eventIds: readonly string[]): Promise<Map<string, ArmMode>> {
  try {
    const { data, error } = await db.from("onsale_refresh_arms").select("event_id, mode").in("event_id", eventIds);
    if (error || !Array.isArray(data)) return new Map();
    return new Map((data as { event_id: string; mode: string }[]).filter((row) => row.mode === "live").map((row) => [row.event_id, "live" as const]));
  } catch {
    return new Map();
  }
}

/**
 * The show's Retargeting proposal for the day: the panel (on `notes`), and
 * the Create line when proposed. A re-run the same day replaces only a To
 * review line; a line already accepted, rejected, applied or failed stays
 * and is not proposed again. Earlier unanswered lines expire (RT5).
 */
export async function writeRetargetingProposal(db: Db, args: { event: EventRow; day: string; plan: RetargetingPlan; mode: ArmMode; userId?: string; where?: { draftId: string | null; adAccountId: string | null; campaignIds: string[] } | null; guard?: { budget: number | null; spendToDate: number } }): Promise<string> {
  const { event, plan } = args;
  const userId = args.userId ?? (await ownerOf(db, event.id));
  const code = event.event_code!;
  const key = retargetingCampaignName(code);
  const run = planRun({ day: args.day, eventDate: event.event_date, config: ONSALE_PHASE, shadow: true });
  const inserted = await db
    .from("onsale_refresh_proposals")
    .upsert(
      {
        user_id: userId,
        event_id: event.id,
        campaign_key: key,
        campaign_ids: plan.build?.campaignIds ?? args.where?.campaignIds ?? [],
        run_kind: "retargeting",
        run_day: args.day,
        cycle_monday: run.cycleMonday,
        cycle_kind: run.cycleKind,
        window_start: run.window.start,
        window_end: run.window.end,
        mode: args.mode,
        objective: "purchase",
        why: {},
        blockers: [],
        enough_data: true,
        not_enough_data: null,
        next_check: addDaysIso(args.day, 1),
        campaign_summary: null,
        inputs: { state: plan.state, sources: plan.build?.sources ?? null },
        watch: { creatives: [], audiences: [] },
        notes: { pauses: "", drops: "", adds: "", retargetingView: plan.view },
      },
      { onConflict: "event_id,campaign_key,run_kind,window_end" },
    )
    .select("id")
    .single();
  if (inserted.error || !inserted.data) throw new Error(`onsale_refresh_proposals: ${inserted.error?.message ?? "no row"}`);
  const proposalId = (inserted.data as { id: string }).id;
  const earlier = await db.from("onsale_refresh_proposals").select("id").eq("event_id", event.id).eq("campaign_key", key).neq("id", proposalId);
  if (earlier.error) throw new Error(`earlier proposals: ${earlier.error.message}`);
  const earlierIds = ((earlier.data ?? []) as { id: string }[]).map((row) => row.id);
  const decided = await db.from("onsale_refresh_lines").select("id").in("proposal_id", [proposalId, ...earlierIds]).eq("kind", "retargeting_campaign").neq("state", "to_review").neq("state", "expired");
  // RT5: today's Move or Cut, unless one was already decided on this read.
  const decidedBudget = await db.from("onsale_refresh_lines").select("id").eq("proposal_id", proposalId).eq("kind", "move_budget").neq("state", "to_review").neq("state", "expired");
  if (decidedBudget.error) throw new Error(`onsale_refresh_lines decided budget: ${decidedBudget.error.message}`);
  if (decided.error) throw new Error(`onsale_refresh_lines decided: ${decided.error.message}`);
  const cleared = await db.from("onsale_refresh_lines").delete().eq("proposal_id", proposalId).eq("state", "to_review");
  if (cleared.error) throw new Error(`onsale_refresh_lines clear: ${cleared.error.message}`);
  if (plan.state === "proposed" && plan.build && plan.view.create && !((decided.data ?? []) as unknown[]).length) {
    const option = plan.view.create.options.find((row) => row.share === plan.view.create!.defaultShare)!;
    const written = await db.from("onsale_refresh_lines").insert({
      proposal_id: proposalId,
      user_id: userId,
      position: 1,
      kind: "retargeting_campaign",
      rule_id: "retargeting_campaign.create",
      title: key,
      detail: option.line,
      write_text: plan.view.create.writeText,
      narrow: { detail: option.split, writeText: null },
      target: { campaignName: key },
      evidence: { view: plan.view, state: plan.state },
      write: plan.build,
      adds_spend: false,
      blocked_reason: plan.held ?? option.blocked,
      supply: false,
      state: "to_review",
    });
    if (written.error) throw new Error(`onsale_refresh_lines: ${written.error.message}`);
  }
  if (plan.state === "running" && plan.budget && args.where && !((decidedBudget.data ?? []) as unknown[]).length) {
    const line = plan.budget;
    // R5's 20 % cap on what moves into a tier; a cut back to the plan adds nothing.
    const blocked = line.write.toAdsetId && args.guard ? moveGuard(line.write.amountGbp, args.guard.budget, args.guard.spendToDate, 0) : null;
    const written = await db.from("onsale_refresh_lines").insert({
      proposal_id: proposalId,
      user_id: userId,
      position: 2,
      kind: "move_budget",
      rule_id: `retargeting.${line.kind}`,
      title: line.title,
      detail: line.detail,
      write_text: line.writeText,
      narrow: { detail: line.narrow, writeText: null },
      target: { fromTier: line.write.fromTier, toTier: line.write.toTier, fromAdsetId: line.write.fromAdsetId, toAdsetId: line.write.toAdsetId, label: line.label },
      // R6 scores a move on the receiving ad set against its cost before (toCpr).
      evidence: { state: plan.state, retargetingBudget: { kind: line.kind, label: line.label }, toCpr: line.write.toTier ? (plan.view.tiers.find((row) => row.tier === line.write.toTier)?.cost ?? null) : null, tiers: plan.view.tiers.map((row) => ({ tier: row.tier, budgetMinor: row.budgetMinor, spendMinor: row.spendMinor ?? null, purchases: row.purchases, frequency: row.frequency, pool: row.pool })) },
      write: { ...line.write, ...args.where },
      adds_spend: false,
      blocked_reason: blocked,
      supply: false,
      state: "to_review",
    });
    if (written.error) throw new Error(`onsale_refresh_lines budget: ${written.error.message}`);
  }
  if (earlierIds.length) {
    const expired = await db.from("onsale_refresh_lines").update({ state: "expired" }).in("proposal_id", earlierIds).eq("state", "to_review");
    if (expired.error) throw new Error(`expire lines: ${expired.error.message}`);
  }
  return proposalId;
}

async function ownerOf(db: Db, eventId: string): Promise<string> {
  const { data, error } = await db.from("events").select("user_id").eq("id", eventId).maybeSingle();
  if (error) throw new Error(`events owner: ${error.message}`);
  const userId = (data as { user_id?: string | null } | null)?.user_id;
  if (!userId) throw new Error(`event ${eventId} has no owner`);
  return userId;
}
