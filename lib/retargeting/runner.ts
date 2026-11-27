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

import { applyGates, retargetingGates, type ArmMode } from "../onsale-refresh/apply-gates.ts";
import { buildEventInputs, loadAll, loadAux, loadInsights, loadOnSaleEvents, rowsForEvent, type EventRow } from "../onsale-refresh/load.ts";
import { ONSALE_PHASE } from "../onsale-refresh/phase-config.ts";
import { fetchEventHosts, loadPurchaseReads, type RefreshGraph } from "../onsale-refresh/purchase-read.ts";
import { fetchCirqlinPageLinks, type PageLinksResult } from "../cirqlin/page-links.ts";
import { committedGbpOf, type PcBudgets } from "../onsale-refresh/purchase-campaign.ts";
import { RETARGETING } from "../onsale-refresh/rules.ts";
import { addDaysIso, planRun, todayLondon } from "../onsale-refresh/schedule.ts";
import { CIRQLIN_HASHES_SECRET_ENV } from "../customer-lists/cirqlin-hashed.ts";
import { customerListWritesEnabled, listTriggerAt, londonDate } from "../customer-lists/rules.ts";
import { pixelRules, ruleChanges, tierSpecs, type SourceList, type SourcePage, type SourceSet } from "./audiences.ts";
import { linksFallback, linksFromPages, otherLandingHosts, type PixelHosts, type ShowLink } from "./links.ts";
import { refreshTokenFor, rewriteRules, ruleRewriteGates } from "./rule-rewrite.ts";
import { localDay, pooled, type PooledRead } from "./test.ts";
import type { CallShow, CallWrite } from "./apply-call.ts";
import { callLine, type RunningTest } from "./plan.ts";
import type { Arm } from "./words.ts";
import { isPresale, planRetargeting, retargetingOnSaleDay, type RetargetingInput, type RetargetingPlan } from "./plan.ts";
import { loadArchivedClientIds } from "../db/client-status.ts";
import { isRetargetingCampaignName, isTestsCampaignName, retargetingCampaignName, TIERS, type Tier } from "./words.ts";
import { FUNNEL_TIERS, type FunnelTier, type ProspectingBudget, type TierWeek } from "./funnel.ts";
import { BUILDS_TABLE, type FunnelBuild, type FunnelProgress, type SimilarStepOutcome } from "./funnel-apply.ts";
import type { PageGroup } from "./funnel.ts";
import type { MatchedPages } from "./funnel-plan.ts";
import { fill as fillRf } from "./funnel-words.ts";
import type { CampaignInput } from "../onsale-refresh/rules.ts";
import { loadPageGroup } from "./page-groups.ts";
import { SHOW_CAMPAIGNS_RULED } from "./show-campaigns.ts";
import { newShowPagesCache, readShowPages } from "./show-pages.ts";
import { HELD_CLIENT_IDS } from "./held.ts";
import { boundGraph, runPool, SHOW_UNREAD, TimedOut, within, type FrontUnread, type ReadLimits, type ShowUnread } from "./limits.ts";
import { loadShowInsights } from "./show-insights.ts";
import { resolveShowCeiling, spentToDate } from "../mcp/meta/show-ceiling.ts";
import { businessClientLinks } from "../bm/client-links.ts";
import { isOnSale } from "../onsale-refresh/on-sale.ts";

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
export async function pagesWithRole(graph: RefreshGraph | null): Promise<{ roles: Map<string, string | null>; names: Map<string, string>; calls: number } | null> {
  if (!graph) return null;
  const roles = new Map<string, string | null>();
  const names = new Map<string, string>();
  let calls = 0;
  let after: string | null = null;
  try {
    for (let page = 0; page < 10; page += 1) {
      calls += 1;
      const body = (await graph.graphGet("/me/accounts", { fields: "id,name,tasks,instagram_business_account{id}", limit: "100", ...(after ? { after } : {}) })) as { data?: { id: string; name?: string; tasks?: string[]; instagram_business_account?: { id?: string } }[]; paging?: { cursors?: { after?: string }; next?: string } };
      for (const row of body.data ?? []) {
        if (row.name) names.set(row.id, row.name);
        if ((row.tasks ?? []).some((task) => PAGE_TASKS.has(task))) roles.set(row.id, row.instagram_business_account?.id ?? null);
      }
      after = body.paging?.next ? (body.paging.cursors?.after ?? null) : null;
      if (!after) break;
    }
  } catch {
    return null;
  }
  return { roles, names, calls };
}

type SourceRows = {
  clients: { id: string; name: string | null; default_page_ids: string[] | null; default_instagram_actor_id: string | null }[];
  events: { id: string; venue_id: string | null; mailchimp_tag?: string | null; announcement_at?: string | null; genre_family?: string | null; meta_pixel_id?: string | null; meta_ad_account_id?: string | null }[];
  venues: { id: string; name: string | null; meta_page_id: string | null; meta_page_name: string | null; meta_pixel_id?: string | null }[];
  lineup: { event_id: string; artist_id: string; billing_order: number | null }[];
  artists: { id: string; name: string | null; meta_page_id: string | null; meta_page_name: string | null }[];
  lists: { event_id: string | null; name: string; list_role: string | null; meta_audience_id: string | null; status: string; source_meta: { uploadedAt?: string } | null; updated_at: string }[];
};

/** The source-set reads: the client's pages, the venue's, the lineup's, and the shows' role lists. Paged. */
export async function loadSourceRows(db: Db, eventIds: readonly string[], clientIds: readonly string[]): Promise<SourceRows> {
  if (!eventIds.length) return { clients: [], events: [], venues: [], lineup: [], artists: [], lists: [] };
  const [clients, events, lineup, lists] = await Promise.all([
    loadAll<SourceRows["clients"][number]>(db, "clients", "id, name, default_page_ids, default_instagram_actor_id", ["id"], (q) => q.in("id", clientIds)),
    loadAll<SourceRows["events"][number]>(db, "events", "id, venue_id, mailchimp_tag, announcement_at, genre_family, meta_pixel_id, meta_ad_account_id", ["id"], (q) => q.in("id", eventIds)),
    loadAll<SourceRows["lineup"][number] & { id: string }>(db, "event_artists", "id, event_id, artist_id, billing_order", ["id"], (q) => q.in("event_id", eventIds)).catch(() => []),
    loadAll<SourceRows["lists"][number] & { id: string }>(db, "meta_custom_audiences", "id, event_id, name, list_role, meta_audience_id, status, source_meta, updated_at", ["id"], (q) => q.in("event_id", eventIds).eq("audience_subtype", "customer_list")).catch(() => []),
  ]);
  const venueIds = [...new Set(events.map((row) => row.venue_id).filter((id): id is string => Boolean(id)))];
  const artistIds = [...new Set(lineup.map((row) => row.artist_id))];
  const [venues, artists] = await Promise.all([
    venueIds.length ? loadAll<SourceRows["venues"][number]>(db, "venues", "id, name, meta_page_id, meta_page_name, meta_pixel_id", ["id"], (q) => q.in("id", venueIds)).catch(() => []) : Promise.resolve([]),
    artistIds.length ? loadAll<SourceRows["artists"][number]>(db, "artists", "id, name, meta_page_id, meta_page_name", ["id"], (q) => q.in("id", artistIds)).catch(() => []) : Promise.resolve([]),
  ]);
  return { clients, events, venues, lineup, artists, lists };
}

/** RT2's source set for one show: one set feeds every window. */
export function sourceSetFor(args: { event: EventRow; rows: SourceRows; pixelId: string | null; roles: Map<string, string | null> | null; hasVideo: boolean; links?: ShowLink[]; /** Fix 1: the Pages matched as audience_sources matches them (show-pages.ts), in place of the client's default Pages and artists.meta_page_id. */ pages?: SourcePage[] | null }): SourceSet {
  const { event, rows } = args;
  const pages: SourcePage[] = args.pages ? [...args.pages] : [];
  const add = (id: string | null | undefined, name: string, kind: SourcePage["kind"], igId: string | null = null) => {
    if (!id) return;
    const role = args.roles ? args.roles.has(id) : null;
    pages.push({ id, name, igId: igId ?? (args.roles?.get(id) ?? null), kind, hasRole: role });
  };
  const client = rows.clients.find((row) => row.id === event.client_id);
  if (!args.pages) (client?.default_page_ids ?? []).forEach((id, index) => add(id, client?.name ?? "Promoter page", "promoter", index === 0 ? (client?.default_instagram_actor_id ?? null) : null));
  const venueId = rows.events.find((row) => row.id === event.id)?.venue_id ?? null;
  const venue = rows.venues.find((row) => row.id === venueId);
  if (venue && !args.pages) add(venue.meta_page_id, venue.meta_page_name ?? venue.name ?? "Venue page", "venue");
  const acts = rows.lineup.filter((row) => row.event_id === event.id).sort((a, b) => (a.billing_order ?? 0) - (b.billing_order ?? 0));
  for (const act of args.pages ? [] : acts) {
    const artist = rows.artists.find((row) => row.id === act.artist_id);
    if (artist) add(artist.meta_page_id, artist.meta_page_name ?? artist.name ?? "Lineup page", "lineup");
  }
  const lists: SourceList[] = rows.lists
    .filter((row) => row.event_id === event.id && row.meta_audience_id && row.status !== "archived" && (row.list_role === "signups" || row.list_role === "similar" || row.list_role === "buyers"))
    .map((row) => ({ metaAudienceId: row.meta_audience_id!, name: row.name, role: row.list_role as SourceList["role"], uploadedAt: row.source_meta?.uploadedAt ?? row.updated_at }));
  return {
    pixelId: args.pixelId,
    // RT13: CIRQLIN's links when read, else RT2's two (no tag).
    links: args.links ?? linksFallback(event),
    // The show's videos are listed at Apply (one walk of its campaigns' ads); here, whether its ads have video at all.
    videos: args.hasVideo ? [{ contextId: "", videoIds: ["pending"] }] : [],
    pages,
    lists,
  };
}

/**
 * RF4: the show's prospecting budgets — every on-sale campaign that isn't
 * its Retargeting or Tests campaign, with an ad set that delivered on the
 * window's last two days: a campaign budget (CBO) as one budget feeding its
 * delivering ad sets, else each delivering ad set's daily budget. Read from
 * the purchase read's budget batch (no extra Meta call). A lifetime budget
 * neither counts nor gives (READING).
 */
export function prospectingOf(campaigns: readonly CampaignInput[], budgets: PcBudgets | null, code: string): ProspectingBudget[] {
  const out: ProspectingBudget[] = [];
  const pennies = (gbp: number | null | undefined) => (gbp != null && gbp > 0 ? Math.round(gbp * 100) : null);
  for (const campaign of campaigns) {
    if (isRetargetingCampaignName(campaign.campaignKey, code) || isTestsCampaignName(campaign.campaignKey, code)) continue;
    const delivering = campaign.adSets.filter((set) => set.delivering);
    if (!delivering.length) continue;
    const cbo = campaign.campaignIds.map((id) => ({ id, daily: pennies(budgets?.campaigns.get(id)?.daily) })).find((row) => row.daily);
    if (cbo) {
      out.push({ id: cbo.id, kind: "campaign", name: campaign.campaignKey, dailyMinor: cbo.daily!, adSets: delivering.length, campaignId: cbo.id });
      continue;
    }
    for (const set of delivering) {
      const minor = set.meta?.dailyBudgetMinor ?? pennies(budgets?.adSets.get(set.adsetId)?.daily);
      if (minor && minor > 0) out.push({ id: set.adsetId, kind: "adset", name: set.name, dailyMinor: minor, adSets: 1, campaignId: budgets?.adSets.get(set.adsetId)?.campaignId ?? null });
    }
  }
  return out;
}

/**
 * TC7: the shows announced and not on sale yet (presale), the show still
 * ahead, not cancelled, their client not archived — the same row as
 * loadOnSaleEvents reads.
 */
export async function loadPresaleEvents(db: Db, today: string): Promise<EventRow[]> {
  const archived = await loadArchivedClientIds(db as SupabaseClient);
  const rows = await loadAll<EventRow & { announcement_at: string | null }>(db, "events", "id, name, event_code, event_date, general_sale_at, presale_at, status, client_id, budget_marketing, drive_folder_id, signup_url, ticket_url, venue_country, announcement_at", ["id"], (q) =>
    q.gte("event_date", today).neq("status", "cancelled").not("announcement_at", "is", null),
  );
  return rows.filter((event) => event.client_id && !archived.has(event.client_id) && isPresale({ onSaleDay: retargetingOnSaleDay(event), runDay: today, announceDay: event.announcement_at?.slice(0, 10) ?? null, eventDate: event.event_date }));
}

/** The read adds Similar today: not a dry run, a live build that runs without it, its group confirmed, and today one of the build's stretch steps. */
export function similarStepDue(args: { dryRun: boolean; ruled: boolean; row: FunnelBuildRow | undefined; pageGroup: PageGroup | null; day: string }): boolean {
  const { row } = args;
  if (args.dryRun || !args.ruled || !row || row.state !== "live" || !row.progress?.active || row.progress.adSets?.similar) return false;
  if (!args.pageGroup?.confirmed || !row.build?.wider || !row.build.spec?.twoCampaigns) return false;
  return (row.build.plan?.steps ?? []).some((step) => step.day === args.day);
}

/** Days from one London day to another, both counted; 0 when the end is before the start. */
function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1);
}

/** A Meta time ("2026-12-12T23:59:00+0000") as its London day; null when absent or unreadable. */
function londonDayOf(iso: unknown): string | null {
  if (typeof iso !== "string" || !iso) return null;
  const t = new Date(iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(t.getTime()) ? null : new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
}

/**
 * Fix 5 (27 Nov): one prospecting budget as Meta holds it — a daily budget,
 * or a lifetime budget (its budget_remaining spread over the days to its end,
 * else to show day) — with what it has left. Null when it has no budget.
 */
export function budgetFromMeta(row: { daily_budget?: unknown; lifetime_budget?: unknown; budget_remaining?: unknown; end_time?: unknown; stop_time?: unknown }, args: { id: string; kind: "adset" | "campaign"; name: string; adSets: number; campaignId: string | null; today: string; showDay: string }): ProspectingBudget | null {
  const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);
  const end = londonDayOf(row.end_time ?? row.stop_time);
  const last = end && end < args.showDay ? end : args.showDay;
  const days = daysBetween(args.today, last);
  if (days <= 0) return null;
  const base = { id: args.id, kind: args.kind, name: args.name, adSets: args.adSets, campaignId: args.campaignId, endDay: end };
  if (n(row.daily_budget)) return { ...base, dailyMinor: n(row.daily_budget), lifetime: false, remainingMinor: n(row.daily_budget) * days };
  if (n(row.lifetime_budget)) {
    const remaining = n(row.budget_remaining);
    return remaining > 0 ? { ...base, dailyMinor: Math.floor(remaining / days), lifetime: true, remainingMinor: remaining } : null;
  }
  return null;
}

/**
 * Fix 5 (27 Nov): the show's prospecting budgets read from Meta (GETs only):
 * every campaign that isn't its Retargeting or Tests campaign, with an ad set
 * that delivered in the window's last two days — its campaign budget (CBO,
 * daily or lifetime) as one budget, else each delivering ad set's. Lifetime
 * budgets count now (NX26-RUDIMENTAL, NX26-LOCKLEAD read "no prospecting
 * budget" when only daily ones were summed).
 */
export async function readProspecting(graph: RefreshGraph, campaigns: readonly CampaignInput[], code: string, today: string, showDay: string): Promise<{ budgets: ProspectingBudget[]; calls: number }> {
  const out: ProspectingBudget[] = [];
  let calls = 0;
  const live = campaigns.filter((c) => !isRetargetingCampaignName(c.campaignKey, code) && !isTestsCampaignName(c.campaignKey, code) && c.adSets.some((set) => set.delivering));
  const campaignIds = [...new Set(live.flatMap((c) => c.campaignIds))];
  type Row = { daily_budget?: unknown; lifetime_budget?: unknown; budget_remaining?: unknown; end_time?: unknown; stop_time?: unknown };
  const read = async (ids: string[], fields: string) => {
    const rows: Record<string, Row> = {};
    for (let i = 0; i < ids.length; i += 50) {
      calls += 1;
      Object.assign(rows, ((await graph.multiGet("/", { ids: ids.slice(i, i + 50).join(","), fields }).catch(() => null)) ?? {}) as Record<string, Row>);
    }
    return rows;
  };
  const camps = campaignIds.length ? await read(campaignIds, "daily_budget,lifetime_budget,budget_remaining,stop_time") : {};
  const adsetIds: string[] = [];
  for (const campaign of live) {
    const delivering = campaign.adSets.filter((set) => set.delivering);
    const cboId = campaign.campaignIds.find((id) => camps[id] && (Number(camps[id]!.daily_budget) > 0 || Number(camps[id]!.lifetime_budget) > 0));
    if (cboId) {
      const b = budgetFromMeta(camps[cboId]!, { id: cboId, kind: "campaign", name: campaign.campaignKey, adSets: delivering.length, campaignId: cboId, today, showDay });
      if (b) out.push(b);
      continue;
    }
    adsetIds.push(...delivering.map((set) => set.adsetId));
  }
  const sets = adsetIds.length ? await read(adsetIds, "daily_budget,lifetime_budget,budget_remaining,end_time,campaign_id") : {};
  for (const campaign of live) {
    for (const set of campaign.adSets.filter((row) => row.delivering && sets[row.adsetId])) {
      const row = sets[set.adsetId] as Row & { campaign_id?: unknown };
      const b = budgetFromMeta(row, { id: set.adsetId, kind: "adset", name: set.name, adSets: 1, campaignId: row.campaign_id == null ? null : String(row.campaign_id), today, showDay });
      if (b) out.push(b);
    }
  }
  return { budgets: out, calls };
}

/**
 * Fix 3 (27 Nov): the show's ceiling and what's left under it, from the
 * per-show ceiling's own reads (resolveShowCeiling, and spentToDate over
 * ad_daily_insights): the lowest ceiling that applies, less spend to date. A
 * group ceiling counts this show's spend only here (the live create's check
 * sums the group). Null when either can't be read.
 */
export async function showCeilingOf(db: Db, event: { id: string; code: string }, campaignIds: readonly string[]): Promise<RetargetingInput["ceiling"]> {
  try {
    const resolved = await resolveShowCeiling(db as never, event);
    if (resolved.kind === "none") return { kind: "none" };
    const totalGbp = Math.min(...resolved.ceilings.map((row) => row.totalGbp));
    const spent = await spentToDate(db as never, [...new Set(campaignIds)]);
    return { kind: "set", totalGbp, leftMinor: Math.round((totalGbp - spent.spent) * 100) };
  } catch {
    return null;
  }
}

/**
 * Fix 7 (27 Nov): the pixel a show's funnel uses when its ads optimise on no
 * pixel — the event's meta_pixel_id, else its venue's, else the ad account's
 * one active pixel (GET /{account}/adspixels; one that isn't unavailable).
 * Null with none: the show is skipped for no pixel, as before.
 */
export async function fallbackPixelOf(args: { event: string | null; venue: string | null; account: string | null; graph: RefreshGraph | null; cache: Map<string, string[] | null> }): Promise<{ pixel: { id: string; source: "event" | "venue" | "account" } | null; calls: number }> {
  const ok = (v: string | null) => (v && /^\d{5,32}$/.test(v.trim()) ? v.trim() : null);
  if (ok(args.event)) return { pixel: { id: ok(args.event)!, source: "event" }, calls: 0 };
  if (ok(args.venue)) return { pixel: { id: ok(args.venue)!, source: "venue" }, calls: 0 };
  if (!args.account || !args.graph) return { pixel: null, calls: 0 };
  const account = args.account.startsWith("act_") ? args.account : `act_${args.account}`;
  let calls = 0;
  if (!args.cache.has(account)) {
    calls += 1;
    const body = (await args.graph.graphGet(`/${account}/adspixels`, { fields: "id,is_unavailable", limit: "50" }).catch(() => null)) as { data?: { id?: string; is_unavailable?: boolean }[] } | null;
    args.cache.set(account, body ? (body.data ?? []).filter((row) => row.id && row.is_unavailable !== true).map((row) => String(row.id)) : null);
  }
  const active = args.cache.get(account);
  return { pixel: active && active.length === 1 ? { id: active[0]!, source: "account" } : null, calls };
}

export type FunnelBuildRow = { event_id: string; state: string; mode: "paused" | "live" | null; meta_campaign_id: string | null; progress: FunnelProgress | null; build?: Partial<FunnelBuild> | null };

/**
 * A build record's tiers and what it took, for the running view; with two
 * campaigns, Wider as it was made (its lifetime, steps and the show's daily
 * spend) with Meta's budget_remaining and the steps whose scheduled change ran.
 */
export function funnelBuiltOf(row: FunnelBuildRow | undefined, wider: { remainingMinor: number | null; doneDays: readonly string[] } | null = null): RetargetingInput["funnelBuilt"] {
  if (!row) return null;
  const sets = row.progress?.adSets ?? {};
  const tiers = { similar: sets.similar?.dailyMinor ?? 0, cold: sets.cold?.dailyMinor ?? 0, warm: sets.warm?.dailyMinor ?? 0, hot: sets.hot?.dailyMinor ?? 0 };
  const took = (row.progress?.moved ?? []).map((line) => ({ id: line.id, kind: line.kind, name: line.name ?? line.id, beforeMinor: line.beforeMinor, afterMinor: line.afterMinor }));
  const made = row.build?.wider ?? null;
  const runningWider = made && row.progress?.wider?.campaignId
    ? { lifetimeMinor: made.lifetimeMinor, dailyMinor: made.dailyMinor, daysLeft: made.daysLeft, endDay: made.endDay, steps: made.steps, adSets: made.adSets.length, remainingMinor: wider?.remainingMinor ?? null, doneDays: wider?.doneDays ?? [], showDailyMinor: row.build?.plan?.showDailyMinor }
    : null;
  return { state: row.state, mode: row.mode, campaignId: row.meta_campaign_id ?? row.progress?.campaignId ?? null, tiers, took, wider: runningWider, similarRefused: row.progress?.similarRefused ?? null };
}

/** The Wider steps whose scheduled change ran (funnel-apply's stepChanges key: rf:{event}:{day}:wider). */
export function widerDoneDays(rows: readonly { call_key: string; status: string }[], eventId: string): string[] {
  const prefix = `rf:${eventId}:`;
  return rows.flatMap((row) => (row.status === "applied" && row.call_key.startsWith(prefix) && row.call_key.endsWith(":wider") ? [row.call_key.slice(prefix.length, -":wider".length)] : [])).sort();
}

/**
 * TC9: the Pages a show matched, for plan_retargeting — its venue's Page, the
 * promoter's brand Pages (the client's default Pages, by their Meta names when
 * read) and the lineup's. An empty slot reads "not matched".
 */
export function matchedPagesOf(pages: readonly SourcePage[], names: ReadonlyMap<string, string> = new Map()): MatchedPages {
  const named = (page: SourcePage) => names.get(page.id) ?? page.name;
  const unique = (list: string[]) => [...new Set(list)];
  return {
    venue: pages.find((page) => page.kind === "venue") ? named(pages.find((page) => page.kind === "venue")!) : null,
    brands: unique(pages.filter((page) => page.kind === "promoter").map(named)),
    artists: unique(pages.filter((page) => page.kind === "lineup").map(named)),
  };
}

/** Meta's minimum, as the audience tools read it (#1400): an audience it sizes under 100. */
export const SIMILAR_MINIMUM = 100;

/** The Similar tier's stored audiences' sizes (one GET each): all under Meta's minimum skips the tier this read. Null reads count as large enough. */
export async function similarSizesOf(graph: RefreshGraph, ids: readonly string[]): Promise<{ allUnderMinimum: boolean; calls: number }> {
  let under = 0;
  for (const id of ids) {
    const body = (await graph.graphGet(`/${id}`, { fields: "approximate_count_upper_bound" }).catch(() => null)) as { approximate_count_upper_bound?: number } | null;
    const upper = Number(body?.approximate_count_upper_bound);
    if (Number.isFinite(upper) && upper >= 0 && upper < SIMILAR_MINIMUM) under += 1;
  }
  return { allUnderMinimum: ids.length > 0 && under === ids.length, calls: ids.length };
}

/** RF5: each tier's 7-day frequency and spend (GET /{campaign}/insights, level=adset, last 7 days): one call. */
export async function funnelWeekOf(graph: RefreshGraph, campaignId: string, adSets: Partial<Record<FunnelTier, { id: string }>>): Promise<Partial<Record<FunnelTier, TierWeek>> | undefined> {
  const body = (await graph.graphGet(`/${campaignId}/insights`, { level: "adset", date_preset: "last_7d", fields: "adset_id,frequency,spend" }).catch(() => null)) as { data?: { adset_id?: string; frequency?: string | number; spend?: string | number }[] } | null;
  if (!body?.data) return undefined;
  const out: Partial<Record<FunnelTier, TierWeek>> = {};
  for (const tier of FUNNEL_TIERS) {
    const row = body.data.find((r) => r.adset_id === adSets[tier]?.id);
    if (!row) continue;
    const frequency = Number(row.frequency);
    out[tier] = { frequency: Number.isFinite(frequency) ? frequency : null, spendMinor: Math.round(num(row.spend) * 100) };
  }
  return out;
}

export type RetargetingRecord = {
  eventId: string;
  eventCode: string | null;
  plan: RetargetingPlan;
  /** What the plan was made from (plan_retargeting's skips read the pixel, the links and the show day). */
  input?: RetargetingInput;
  proposalId: string | null;
  /** RT13: a running campaign's audiences whose rules differ from today's links. */
  ruleChanges?: string[];
  /** Matas, 27 Nov: the read tried to add Similar at this step. */
  similarStep?: { state: "applied" | "failed"; reason: string | null };
  /** RT13: those rewritten on Meta (the refresh's token and write path, behind its gates). */
  rulesRewritten?: string[];
  /** The connector's limits: this show's reads that ran out of time (the plan is made without them). */
  notRead?: ShowUnread[];
};

export type RetargetingReadResult =
  | { ok: true; skippedReason: "killswitch" | "not_08_london" }
  | {
      ok: boolean;
      dryRun: boolean;
      day: string;
      events: number;
      records: RetargetingRecord[];
      skipped: { eventCode: string | null; reason: string }[];
      metaCalls: number;
      errors: string[];
      /** The connector's limits: shows not finished in their own budget ("show") or the whole read's ("total"). */
      unfinished?: { eventId: string; eventCode: string | null; why: "show" | "total" }[];
      /** The connector's limits: reads before the shows that ran out of time. */
      notRead?: FrontUnread[];
    };

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
  /** RT13: how the links were read. */
  linksRead?: RetargetingInput["linksRead"];
  pixelHosts?: PixelHosts;
  /** RT9: the campaign's effective_status, when read. */
  campaignStatus?: string | null;
  otherLandingHosts?: string[];
  linkSizes?: RetargetingInput["linkSizes"];
  /** RT17: the test's winner once its call was applied. */
  testWinner?: Arm | null;
  /** RT17: the pooled read across every show in the test. */
  pooledRead?: PooledRead | null;
  signups?: RetargetingInput["signups"];
  accountTimeZone?: string | null;
  /** RF3: events.announcement_at. */
  announcementAt?: string | null;
  /** Staged two-campaign record: on, and the show's genre page group. */
  twoCampaigns?: boolean;
  pageGroup?: RetargetingInput["pageGroup"];
  genreFamily?: string | null;
  similarTooSmall?: boolean;
  /** The show's funnel build and its 7-day figures; its stored audience keys. */
  funnelBuilt?: RetargetingInput["funnelBuilt"];
  funnelWeek?: RetargetingInput["funnelWeek"];
  madeAudiences?: string[];
  /** TC9: the Pages the show matched (plan_retargeting's line). */
  matchedPages?: MatchedPages | null;
  /** Fix 7: the pixel used when the ads optimise on none. */
  fallbackPixel?: RetargetingInput["fallbackPixel"];
  /** Fix 6: plan_retargeting / create_show_campaigns. */
  connector?: boolean;
  /** Fix 5: the prospecting budgets read from Meta (daily and lifetime); null = the purchase read's daily ones. */
  prospectingRead?: ProspectingBudget[] | null;
  /** Fix 3: the show's ceiling and what's left under it. */
  ceiling?: RetargetingInput["ceiling"];
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
  const progress = (args.appliedLine?.applied_result?.retargeting ?? null) as { campaignId?: string; share?: number; adSets?: Partial<Record<Tier, { dailyMinor: number }>>; test?: TestProgress } | null;
  const firstDay = rows.filter((row) => isRetargetingCampaignName(row.campaign_name, code) && num(row.spend) > 0).map((row) => row.date).sort()[0] ?? null;
  const tiers = progress?.adSets ? Object.fromEntries(TIERS.map((tier) => [tier, progress.adSets?.[tier]?.dailyMinor ?? 0])) as Record<Tier, number> : progress?.test?.arms ? armsTotal(progress.test) : undefined;
  const existing = named || progress?.campaignId || progress?.test?.studyId
    ? { campaignId: progress?.campaignId ?? named?.meta_campaign_id ?? null, since: firstDay, totalMinor: tiers ? TIERS.reduce((sum, tier) => sum + tiers[tier], 0) : null, share: progress?.share ?? null, ...(tiers ? { tiers } : {}), status: args.campaignStatus ?? null }
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
    // The on-sale panel's rule (isOnSale), so a show on sale by its status alone plans (Matas, 27 Nov).
    onSale: isOnSale(event, day),
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
    linksRead: args.linksRead ?? "no_tag",
    pixelHosts: args.pixelHosts ?? null,
    otherLandingHosts: args.otherLandingHosts ?? [],
    linkSizes: args.linkSizes,
    testWinner: args.testWinner ?? null,
    test: progress?.test?.studyId ? runningTest(progress.test, rows, start, end, args.pooledRead ?? null) : null,
    signups: args.signups ?? null,
    accountTimeZone: args.accountTimeZone ?? null,
    announceDay: args.announcementAt ? args.announcementAt.slice(0, 10) : null,
    twoCampaigns: args.twoCampaigns ?? false,
    pageGroup: args.pageGroup ?? null,
    genreFamily: args.genreFamily ?? null,
    similarTooSmall: args.similarTooSmall ?? false,
    matchedPages: args.matchedPages ?? null,
    // Wider's suggestions: the lineup's and the genre's interests aren't read yet (staged); Broad then runs with none.
    lineupInterests: [],
    genreInterests: [],
    prospecting: args.prospectingRead ?? prospectingOf(campaigns, args.budgets, code),
    fallbackPixel: args.fallbackPixel ?? null,
    connector: args.connector ?? false,
    ceiling: args.ceiling ?? null,
    madeAudiences: args.madeAudiences ?? [],
    funnelBuilt: args.funnelBuilt ?? null,
    funnelWeek: args.funnelWeek,
    campaigns: campaigns
      .filter((campaign) => !isRetargetingCampaignName(campaign.campaignKey, code))
      .map((campaign) => ({ id: campaign.campaignIds[0] ?? campaign.campaignKey, name: campaign.campaignKey, adSetNames: campaign.adSets.filter((set) => set.delivering).map((set) => set.name), delivering: campaign.adSets.some((set) => set.delivering) })),
  };
}

/** SU1: a show's customer_list_syncs rows (migration 267), as the panel reads them. */
export type SignupsSyncRow = { event_id: string; enabled: boolean; meta_audience_id: string | null; sent_total: number; removed_total: number; last_sent_at: string | null; last_replaced_at: string | null; created_at: string | null; updated_at?: string | null };

/**
 * SU1's state from what the sync stores: no enabled row is "not switched
 * on" (RT15); enabled with no list yet is "made on" presale day (general
 * sale with no presale); a list is "on Meta" with what it holds now (sent
 * less removed), the last send and the last full rebuild (else the day it
 * was made). The CIRQLIN read unset is "not set up"; the writes switch off
 * adds the ochre line. A failed read or send and an unknown tag aren't
 * stored on the row, so they aren't drawn here.
 */
export function signupsSyncOf(rows: readonly SignupsSyncRow[], event: { presale_at?: string | null; general_sale_at: string | null; event_date: string | null }, env: Record<string, string | undefined> = process.env): RetargetingInput["signups"] {
  const row = rows.filter((r) => r.enabled).sort((a, b) => ((a.updated_at ?? a.created_at ?? "") < (b.updated_at ?? b.created_at ?? "") ? 1 : -1))[0];
  if (!row) return { state: "not_on" };
  const writesOff = !customerListWritesEnabled(env);
  if (!env[CIRQLIN_HASHES_SECRET_ENV]) return { state: "not_configured", writesOff };
  if (!row.meta_audience_id) {
    const at = listTriggerAt({ presale_at: event.presale_at ?? null, general_sale_at: event.general_sale_at, event_date: event.event_date });
    return at ? { state: "waiting", madeOn: londonDate(at), writesOff } : { state: "not_on" };
  }
  const made = row.created_at ?? row.last_sent_at;
  const lastSent = row.last_sent_at ?? made;
  if (!lastSent) return { state: "not_on" };
  const rebuilt = row.last_replaced_at ?? made ?? lastSent;
  return { state: "on", count: Math.max(0, row.sent_total - row.removed_total), lastSentAt: lastSent, rebuiltOn: londonDate(new Date(rebuilt)), writesOff };
}

type TestProgress = { startAt?: string; studyId?: string; arms?: Partial<Record<Arm, { campaignId?: string; adSets?: Partial<Record<Tier, { id: string; dailyMinor: number }>> }>> };

/** Both arms' tier budgets added, for the running header's total. */
function armsTotal(test: TestProgress): Record<Tier, number> {
  const out = { bottom: 0, mid_bottom: 0, mid: 0 } as Record<Tier, number>;
  for (const arm of Object.values(test.arms ?? {})) for (const tier of TIERS) out[tier] += arm?.adSets?.[tier]?.dailyMinor ?? 0;
  return out;
}

/** RT17: each arm's tiers over the 7 days (ad_daily_insights by ad set), with the pooled read. Pool and frequency come with the daily figures. */
export function runningTest(test: TestProgress, rows: readonly { date: string; meta_adset_id?: string | null; spend: number | string; purchases: number | string }[], start: string, end: string, pooledRead: PooledRead | null): RunningTest {
  const week = rows.filter((row) => row.date >= start && row.date <= end);
  const arms = { A: {}, B: {} } as RunningTest["arms"];
  for (const arm of ["A", "B"] as const) {
    for (const tier of TIERS) {
      const set = test.arms?.[arm]?.adSets?.[tier];
      if (!set) continue;
      const mine = week.filter((row) => row.meta_adset_id === set.id);
      arms[arm][tier] = { budgetMinor: set.dailyMinor, spendMinor: Math.round(mine.reduce((sum, row) => sum + num(row.spend), 0) * 100), purchases: mine.reduce((sum, row) => sum + num(row.purchases), 0), frequency: null, pool: null };
    }
  }
  return { arms, pooled: pooledRead };
}

const ARM_CAMPAIGN = /^(.+?) · Retargeting · A\/B · (A|B)$/i;

/** RT17: the pooled read — every show in the test, from the first show's start to the read's last day, each arm's spend and attributed purchases summed. */
export function pooledFromRows(rows: readonly { date: string; campaign_name?: string | null; spend: number | string; purchases: number | string }[], to: string, testFrom: string | null = null): PooledRead | null {
  const tagged = rows.flatMap((row) => {
    const match = ARM_CAMPAIGN.exec((row.campaign_name ?? "").trim());
    return match ? [{ show: match[1]!, arm: match[2]!.toUpperCase() as Arm, date: row.date, spend: num(row.spend), purchases: num(row.purchases) }] : [];
  });
  const started = tagged.filter((row) => row.spend > 0).map((row) => row.date).sort()[0];
  if (!started || started > to) return null;
  // Design (25 Nov, RG): the window starts on the test's start day (00:00 London), else the first day an arm spent.
  const from = testFrom && testFrom <= to ? testFrom : started;
  return pooled(tagged, { from, to });
}

/** RT17: the call's write, every show in the test (its draft, test, campaigns and arm budgets). */
export function callWrite(args: { winner: Arm; from: string; tests: { eventId: string; code: string; draftId: string | null; test: TestProgress }[] }): CallWrite {
  const shows: CallShow[] = args.tests.flatMap(({ eventId, code, draftId, test }) => {
    if (!draftId || !test.studyId) return [];
    const adSets = { A: test.arms?.A?.adSets ?? {}, B: test.arms?.B?.adSets ?? {} };
    const totalMinor = TIERS.reduce((sum, tier) => sum + (adSets.A[tier]?.dailyMinor ?? 0) + (adSets.B[tier]?.dailyMinor ?? 0), 0);
    return [{ eventId, code, draftId, studyId: test.studyId, campaigns: { A: test.arms?.A?.campaignId ?? null, B: test.arms?.B?.campaignId ?? null }, adSets, totalMinor }];
  });
  return { kind: "retargeting_test_call", callKey: `${args.from}:${args.winner}`, winner: args.winner, shows };
}

/** RT13: the show's links — CIRQLIN's pages by its tag, RT2's two links with no tag; the two failures as states. */
export async function showLinks(event: EventRow & { mailchimp_tag?: string | null }, read: (tag: string) => Promise<PageLinksResult>): Promise<{ links: ShowLink[]; linksRead: NonNullable<RetargetingInput["linksRead"]>; reason: string | null }> {
  const tag = event.mailchimp_tag?.trim();
  if (!tag) return { links: linksFallback(event), linksRead: "no_tag", reason: null };
  const result = await read(tag);
  // The response's shape only: never the bearer, never the body.
  console.log(`[retargeting-read] page-links ${event.event_code ?? event.id} ${result.ok ? `ok pages=${result.pages.length} ticket_links=${result.pages.reduce((sum, page) => sum + page.ticket_links.length, 0)}` : `failed reason=${result.reason}${"status" in result && result.status ? ` status=${result.status}` : ""}`}`);
  if (result.ok) return { links: linksFromPages(result.pages), linksRead: "ok", reason: null };
  if (result.reason === "no_page") return { links: [], linksRead: "no_page", reason: "no_page" };
  return { links: [], linksRead: "failed", reason: result.reason };
}

/** RT13 / RT15: the pixel's hosts in 28 days for visits, checkouts and registrations; null when any read failed. */
export async function pixelHostsOf(graph: RefreshGraph, pixelId: string, now: Date): Promise<{ hosts: PixelHosts; calls: number }> {
  // GET /{pixel}/stats?aggregation=host over 28 days: every event (RT13's pixel line), then PageView, InitiateCheckout, CompleteRegistration.
  const [any, pageView, checkout, registration] = await Promise.all([null, "PageView", "InitiateCheckout", "CompleteRegistration"].map((event) => fetchEventHosts(graph.graphGet, pixelId, now, 28, event)));
  const calls = any!.calls + pageView!.calls + checkout!.calls + registration!.calls;
  if (any!.error || pageView!.error || checkout!.error || registration!.error) return { hosts: null, calls };
  const hostsOf = (rows: { host: string }[]) => [...new Set(rows.map((row) => row.host))];
  return { hosts: { any: hostsOf(any!.rows), pageView: hostsOf(pageView!.rows), checkout: hostsOf(checkout!.rows), registration: hostsOf(registration!.rows) }, calls };
}

/** RT18: a running campaign's per-link audiences' size bands, one GET each (approximate_count). */
export async function linkSizesOf(graph: RefreshGraph, audiences: Record<string, string>): Promise<{ sizes: Record<string, { lower: number; upper: number } | null>; calls: number }> {
  const perLink = Object.entries(audiences).filter(([key]) => /^(bottom:ticket:30|mid_bottom:page:60):[0-9a-f]{8}$/.test(key));
  const sizes: Record<string, { lower: number; upper: number } | null> = {};
  for (const [key, id] of perLink) {
    const body = (await graph.graphGet(`/${id}`, { fields: "approximate_count_lower_bound,approximate_count_upper_bound" }).catch(() => null)) as { approximate_count_lower_bound?: number; approximate_count_upper_bound?: number } | null;
    const lower = Number(body?.approximate_count_lower_bound);
    const upper = Number(body?.approximate_count_upper_bound);
    sizes[key] = Number.isFinite(lower) && Number.isFinite(upper) && upper > 0 ? { lower, upper } : null;
  }
  return { sizes, calls: perLink.length };
}

/** RT13: compare a running campaign's rules only when the links were read; a failed read keeps the last rules. */
export function comparesRules(linksRead: RetargetingInput["linksRead"]): boolean {
  return linksRead === "ok" || linksRead === "no_tag";
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
  /** RT13: CIRQLIN's page-links read (injectable for tests). */
  pageLinks?: (tag: string) => Promise<PageLinksResult>;
  /** RT13's rule rewrite: the refresh's POST (graphPostWithToken), with the owner's refresh token. Absent = never write. */
  graphPost?: (path: string, body: Record<string, unknown>, token: string) => Promise<unknown>;
  /**
   * Matas, 27 Nov ("Yes, at the next step"): add Similar to a live build at a
   * stretch step once its page group is confirmed (funnel-apply.ts
   * addSimilarAtStep, the create path's gates). Absent, or a dry run = never.
   */
  similarStep?: (args: { event: EventRow; build: FunnelBuild; pageGroup: PageGroup; day: string }) => Promise<SimilarStepOutcome>;
  /**
   * plan_retargeting and create_show_campaigns (fix 6, 27 Nov): the purchase
   * read decides nothing for retargeting (buyers are left out on the ticket
   * links' Purchase rule), so its not-proposed states don't skip a show. The
   * 08:00 read and the on-sale refresh keep their own rules (false).
   */
  connector?: boolean;
  /** The connector's time limits (limits.ts CONNECTOR_LIMITS). Absent (the 08:00 read) = no limits, as before. */
  limits?: ReadLimits;
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
  // TC7: presale shows (announced, not on sale yet) take the two campaigns too.
  if (SHOW_CAMPAIGNS_RULED) events = [...events, ...(await loadPresaleEvents(input.db, day).catch(() => [] as EventRow[])).filter((row) => !events.some((have) => have.id === row.id))];
  // Held clients (Matas, 27 Nov; held.ts): the connector's read leaves their shows out. The 08:00 read doesn't (connector false).
  if (input.connector) events = events.filter((event) => !event.client_id || !HELD_CLIENT_IDS.has(event.client_id));
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
  const eventIds = events.map((event) => event.id);
  // The connector's limits (limits.ts, Matas 27 Nov): each outside read ≤ requestMs, each show ≤ showMs, the whole read ≤ totalMs.
  // The 08:00 read passes none and runs as before.
  const limits = input.limits ?? null;
  const startedAt = Date.now();
  const total = new AbortController();
  const totalTimer = limits ? setTimeout(() => total.abort(), limits.totalMs) : null;
  const ms = (from: number) => Date.now() - from;
  const steps: Record<string, number> = {};
  const timed = async <T,>(name: string, run: Promise<T>): Promise<T> => {
    const from = Date.now();
    try {
      return await run;
    } finally {
      steps[name] = ms(from);
    }
  };
  /** The reads before the shows that ran out of time (plan_retargeting says so). */
  const notRead = new Set<FrontUnread>();
  const unfinished: { eventId: string; eventCode: string | null; why: "show" | "total" }[] = [];
  const allUnfinished = () => events.map((event) => ({ eventId: event.id, eventCode: event.event_code, why: "total" as const }));
  const done = (records: RetargetingRecord[], metaCalls: number) => {
    if (totalTimer) clearTimeout(totalTimer);
    console.log(`[retargeting-read] done ok=${errors.length === 0} dry_run=${dryRun} day=${day} events=${events.length} proposed=${records.filter((row) => row.plan.state === "proposed").length} meta_calls=${metaCalls} errors=${errors.length}${limits ? ` ms=${ms(startedAt)} steps=${Object.entries(steps).map(([name, took]) => `${name}:${took}`).join(",")} unfinished=${unfinished.length} not_read=${[...notRead].join(",") || "none"}` : ""}`);
    return { ok: errors.length === 0, dryRun, day, events: events.length, records, skipped, metaCalls, errors, ...(limits ? { unfinished, notRead: [...notRead] } : {}) };
  };
  // The connector reads only its shows' ad-days (show-insights.ts); the 08:00 read every ad-day, as the on-sale refresh does.
  const database = Promise.all([timed("insights", input.connector ? loadShowInsights(input.db, events) : loadInsights(input.db)), timed("aux", loadAux(input.db, eventIds, clientIds)), timed("sources", loadSourceRows(input.db, eventIds, clientIds))]);
  const loaded = await (limits ? within("database", limits.totalMs, () => database, total.signal) : database).catch((err) => {
    if (err instanceof TimedOut) return null;
    throw err;
  });
  if (!loaded) {
    unfinished.push(...allUnfinished());
    return done([], 0);
  }
  const [raw, aux, sourceRows] = loaded;
  // The reads before the shows, side by side; the connector's Graph reads each within requestMs and all within frontMs.
  const frontSignal = limits ? AbortSignal.any([total.signal, AbortSignal.timeout(limits.frontMs)]) : null;
  const frontGraph = input.graph && limits && frontSignal ? boundGraph(input.graph, { signal: frontSignal, requestMs: limits.requestMs }) : (input.graph ?? null);
  const emptyPurchases = { reads: new Map(), metaCalls: 0, cirqlinReads: 0, notes: [] as string[], budgets: { campaigns: new Map(), adSets: new Map() } };
  const purchasesRun = () =>
    loadPurchaseReads({
      db: input.db,
      events: events.map((event) => ({ id: event.id, event_code: event.event_code, client_id: event.client_id, event_date: event.event_date, signup_url: event.signup_url ?? null, ticket_url: event.ticket_url ?? null, presale_at: event.presale_at ?? null, general_sale_at: event.general_sale_at })),
      raw,
      day,
      shadow: true,
      config,
      graph: frontGraph,
      graphReason: input.graphReason,
      now,
    });
  const purchasesP = timed("purchases", limits && frontSignal ? within("purchase read", limits.frontMs, () => purchasesRun(), total.signal) : purchasesRun()).catch((err) => {
    if (err instanceof TimedOut) notRead.add("purchases");
    else skipped.push({ eventCode: null, reason: `Purchase read failed: ${err instanceof Error ? err.message : String(err)}` });
    return emptyPurchases;
  });
  // /me/accounts: the Pages with a role. The connector needs it only when a show's own Pages read fails (show-pages.ts), so it reads it then.
  let rolesP: Promise<Awaited<ReturnType<typeof pagesWithRole>>> | null = null;
  const rolesOf = () =>
    (rolesP ??= timed("roles", limits ? within("pages with a role", limits.requestMs, () => pagesWithRole(frontGraph), total.signal).catch(() => null) : pagesWithRole(input.graph ?? null)));
  if (!input.connector) void rolesOf();
  const readLinks = input.pageLinks ?? ((tag: string) => fetchCirqlinPageLinks(tag, limits ? { timeoutMs: limits.requestMs } : undefined));
  // A CIRQLIN read that runs out is a failed read (RT13 keeps a running campaign's last rules) and its own "not read in time" line.
  const linksTimedOut = new Set<string>();
  const linksOf = (event: EventRow) => {
    const tagged = { ...event, mailchimp_tag: sourceRows.events.find((row) => row.id === event.id)?.mailchimp_tag ?? null };
    if (!limits) return showLinks(tagged, readLinks);
    return showLinks(tagged, (tag) =>
      within("page links", limits.requestMs, () => readLinks(tag), total.signal).catch((err): PageLinksResult => {
        linksTimedOut.add(event.id);
        return { ok: false, reason: "network", message: err instanceof Error ? err.message : String(err) };
      }),
    );
  };
  // RT13: every show's links first, so a landing host another show uses gets no pixel line.
  const linksP = timed(
    "links",
    (async () => {
      const out = new Map<string, Awaited<ReturnType<typeof showLinks>>>();
      if (!limits) {
        for (const event of events) out.set(event.id, await linksOf(event));
        return out;
      }
      const read = await runPool(events, { concurrency: 6, itemMs: limits.frontMs, signal: total.signal }, (event) => linksOf(event));
      events.forEach((event, i) => {
        const got = read[i]!;
        if (got.ok) out.set(event.id, got.value);
        else {
          linksTimedOut.add(event.id);
          out.set(event.id, { links: [], linksRead: "failed", reason: "network" });
        }
      });
      return out;
    })(),
  );
  const [syncRows, purchases, lines, appliedCreates, calls, builds, madeRows, businessLinks, linksByShow] = await Promise.all([
    // SU1: each show's Signups list into Meta. A failed read draws RT15's line, as before SU1.
    loadAll<SignupsSyncRow & { id: string }>(input.db, "customer_list_syncs", "id, event_id, enabled, meta_audience_id, sent_total, removed_total, last_sent_at, last_replaced_at, created_at, updated_at", ["id"], (q) => q.in("event_id", eventIds).eq("enabled", true)).catch(() => [] as (SignupsSyncRow & { id: string })[]),
    purchasesP,
    loadAll<{ id: string; state: string; write: Record<string, unknown> | null; applied_result: Record<string, unknown> | null; onsale_refresh_proposals: { event_id: string | null } | null }>(input.db, "onsale_refresh_lines", "id, state, write, applied_result, onsale_refresh_proposals!inner(event_id)", ["id"], (q) => q.eq("kind", "retargeting_campaign").in("onsale_refresh_proposals.event_id", eventIds)).catch(() => []),
    // RT17: every show in the layout test (an applied Create line with a Meta A/B test), the pooled read, and the winner once called.
    loadAll<{ id: string; write: Record<string, unknown> | null; applied_result: Record<string, unknown> | null; onsale_refresh_proposals: { event_id: string | null; campaign_key: string | null } | null }>(input.db, "onsale_refresh_lines", "id, write, applied_result, onsale_refresh_proposals!inner(event_id, campaign_key)", ["id"], (q) => q.eq("kind", "retargeting_campaign").eq("state", "applied")).catch(() => []),
    loadAll<{ id: string; write: Record<string, unknown> | null; applied_at: string | null }>(input.db, "onsale_refresh_lines", "id, write, applied_at", ["id"], (q) => q.eq("kind", "retargeting_test_call").eq("state", "applied")).catch(() => []),
    // RF: each show's funnel build and the audiences already made for it.
    loadAll<FunnelBuildRow & { id: string }>(input.db, BUILDS_TABLE, "id, event_id, state, mode, meta_campaign_id, progress, build", ["id"], (q) => q.in("event_id", eventIds)).catch(() => [] as (FunnelBuildRow & { id: string })[]),
    loadAll<{ id: string; event_id: string; part: string; meta_audience_id: string | null }>(input.db, "onsale_refresh_audiences", "id, event_id, part, meta_audience_id", ["id"], (q) => q.in("event_id", eventIds).eq("kind", "retargeting_campaign")).catch(() => []),
    // Fix 1: each client's Business Managers (#1403's links), for the Pages' access check.
    SHOW_CAMPAIGNS_RULED ? businessClientLinks(input.db, { clientIds }).catch(() => []) : Promise.resolve([]),
    linksP,
  ]);
  const roles = input.connector ? null : await rolesOf();
  let metaCalls = purchases.metaCalls + (roles?.calls ?? 0);
  const arms = dryRun ? new Map<string, ArmMode>() : await loadArms(input.db, eventIds);
  const minDaily = new Map<string, number | null>();
  const timeZones = new Map<string, string | null>();
  const testShows = appliedCreates.flatMap((row) => {
    const test = (row.applied_result?.retargeting as { test?: TestProgress } | undefined)?.test;
    const eventId = row.onsale_refresh_proposals?.event_id;
    if (!test?.studyId || !eventId) return [];
    const code = (row.onsale_refresh_proposals?.campaign_key ?? "").replace(/ · Retargeting$/, "");
    return [{ eventId, code, draftId: (row.write?.draftId as string | null | undefined) ?? null, test }];
  });
  const testWinner = (calls.sort((a, b) => ((a.applied_at ?? "") < (b.applied_at ?? "") ? 1 : -1))[0]?.write?.winner as Arm | undefined) ?? null;
  // The first show's test start, as a London day (Apply starts every test at 00:00 Europe/London).
  const testFrom = testShows.flatMap(({ test }) => (test.startAt ? [localDay("Europe/London", new Date(test.startAt))] : [])).sort()[0] ?? null;
  const pooledRead = testShows.length ? pooledFromRows(raw.rows, addDaysIso(day, -1), testFrom) : null;
  const call = !testWinner && pooledRead ? callLine(pooledRead) : null;
  // TC6: the Wider steps that ran (scheduled_meta_changes, migration 271).
  const stepRows = SHOW_CAMPAIGNS_RULED && builds.some((row) => row.progress?.wider?.campaignId)
    ? await loadAll<{ id: string; call_key: string; status: string }>(input.db, "scheduled_meta_changes", "id, call_key, status", ["id"], (q) => q.in("event_id", eventIds).like("call_key", "rf:%:wider")).catch(() => [])
    : [];
  const hostsByPixel = new Map<string, Promise<{ hosts: PixelHosts; calls: number } | null>>();
  const accountPixels = new Map<string, string[] | null>();
  const pagesCache = newShowPagesCache();
  const businessesOf = new Map<string, string[]>();
  for (const link of businessLinks) businessesOf.set(link.client_id, [...(businessesOf.get(link.client_id) ?? []), link.business_id]);
  const landingByShow = new Map([...linksByShow].map(([id, row]) => [id, row.links]));

  /**
   * One show's plan. With a signal (the connector), its Graph reads go through
   * a bound graph per read (each request ≤ requestMs, none after the show's
   * budget), and a read that ran out is named on the record (notRead). Its
   * notes and errors are its own until it finishes, so a show left unfinished
   * adds nothing.
   */
  const planShow = async (event: EventRow, signal: AbortSignal | null): Promise<{ record: RetargetingRecord | null; skipped: { eventCode: string | null; reason: string }[]; errors: string[]; calls: number }> => {
    const mySkipped: { eventCode: string | null; reason: string }[] = [];
    const myErrors: string[] = [];
    let calls = 0;
    const showNotRead = new Set<ShowUnread>();
    const graphFor = (source: ShowUnread): RefreshGraph | null => (input.graph && signal && limits ? boundGraph(input.graph, { signal, requestMs: limits.requestMs, onTimeout: () => showNotRead.add(source) }) : (input.graph ?? null));
    const meta = graphFor("meta");
    try {
      const read = purchases.reads.get(event.id);
      const inputs = await buildEventInputs({ event, day, shadow: true, config, raw, aux, drive: null, purchases: read, purchaseBudgets: purchases.budgets });
      const rows = rowsForEvent(raw, event.id);
      const code = event.event_code!;
      const hasVideo = rows.some((row) => !isRetargetingCampaignName(row.campaign_name, code) && num(row.video_plays_3s) > 0);
      const links = linksByShow.get(event.id)!;
      if (linksTimedOut.has(event.id)) showNotRead.add("links");
      if (links.reason) mySkipped.push({ eventCode: code, reason: `CIRQLIN links: ${links.reason}` });
      const eventRow = sourceRows.events.find((row) => row.id === event.id);
      const venueRow = sourceRows.venues.find((row) => row.id === eventRow?.venue_id) ?? null;
      // The account the show's ads run on, for the Page and pixel reads: its draft's, else its ad-days', else the event's.
      const readAccount = inputs.campaigns.find((campaign) => campaign.draft)?.draft?.adAccountId ?? inputs.campaigns.find((campaign) => campaign.adAccountId)?.adAccountId ?? eventRow?.meta_ad_account_id ?? null;
      const mine = lines.filter((line) => line.onsale_refresh_proposals?.event_id === event.id);
      const appliedLine = mine.find((line) => (line.applied_result?.retargeting as { campaignId?: string } | undefined)?.campaignId) ?? null;
      const account = inputs.campaigns.find((campaign) => campaign.draft)?.draft?.adAccountId ?? null;
      // RT9: a running campaign's status, so an off one says so (a running campaign keeps its last rules when the links read fails, RT13).
      const campaignId = (appliedLine?.applied_result?.retargeting as { campaignId?: string } | undefined)?.campaignId ?? rows.find((row) => isRetargetingCampaignName(row.campaign_name, code) && row.meta_campaign_id)?.meta_campaign_id ?? null;
      const storedAudiences = ((appliedLine?.applied_result?.retargeting ?? null) as { audiences?: Record<string, string> } | null)?.audiences ?? null;
      const buildRow = builds.find((row) => row.event_id === event.id);
      const widerId = buildRow?.progress?.wider?.campaignId ?? null;
      const genre = eventRow?.genre_family ?? null;
      const similarStored = madeRows.filter((row) => row.event_id === event.id && row.meta_audience_id && /^rf:similar_/.test(row.part));

      // The show's reads that don't wait on one another, side by side.
      const pixelP = (async () => {
        // Fix 7: no pixel the ads optimise on — the event's pixel, else the venue's, else the ad account's one active pixel.
        if (read?.pixel?.id) return { pixelId: read.pixel.id, fallbackPixel: null as RetargetingInput["fallbackPixel"] };
        const fb = await fallbackPixelOf({ event: eventRow?.meta_pixel_id ?? null, venue: venueRow?.meta_pixel_id ?? null, account: readAccount, graph: graphFor("pixel"), cache: accountPixels });
        calls += fb.calls;
        return { pixelId: fb.pixel?.id ?? null, fallbackPixel: fb.pixel as RetargetingInput["fallbackPixel"] };
      })();
      // Fix 1: the show's Pages as audience_sources matches them.
      const pagesP = SHOW_CAMPAIGNS_RULED
        ? readShowPages({ db: input.db as never, graph: graphFor("pages"), event: { id: event.id, client_id: event.client_id, clientName: sourceRows.clients.find((row) => row.id === event.client_id)?.name ?? null, code: event.event_code }, venue: venueRow, adAccountId: readAccount, businessIds: businessesOf.get(event.client_id ?? "") ?? [], cache: pagesCache })
            .then((got) => ((calls += got.calls), got))
            .catch(() => null)
        : Promise.resolve(null);
      const hostsP = pixelP.then(({ pixelId }) => {
        const graph = graphFor("hosts");
        if (!pixelId || !graph) return null;
        if (!hostsByPixel.has(pixelId)) hostsByPixel.set(pixelId, pixelHostsOf(graph, pixelId, now).then((got) => ((calls += got.calls), got)).catch(() => null));
        return hostsByPixel.get(pixelId)!.then((got) => got?.hosts ?? null);
      });
      const accountP = (async () => {
        if (!account || !meta || minDaily.has(account)) return;
        calls += 1;
        const body = (await meta.graphGet(`/${account}`, { fields: "min_daily_budget,timezone_name" }).catch(() => null)) as { min_daily_budget?: unknown; timezone_name?: unknown } | null;
        minDaily.set(account, body ? num(body.min_daily_budget) || null : null);
        timeZones.set(account, typeof body?.timezone_name === "string" && body.timezone_name ? body.timezone_name : null);
      })();
      const statusP = campaignId && meta ? ((calls += 1), meta.graphGet(`/${campaignId}`, { fields: "effective_status" }).then((body) => (body as { effective_status?: string }).effective_status ?? null).catch(() => null)) : Promise.resolve(null);
      // RT18: a running campaign's per-link audience sizes.
      const sizesP = campaignId && storedAudiences && meta ? linkSizesOf(meta, storedAudiences).then((got) => ((calls += got.calls), got.sizes)) : Promise.resolve(undefined);
      const remainingP = SHOW_CAMPAIGNS_RULED && widerId && meta
        ? ((calls += 1),
          meta
            .graphGet(`/${widerId}`, { fields: "budget_remaining" })
            .catch(() => null)
            .then((body) => {
              const left = (body as { budget_remaining?: unknown } | null)?.budget_remaining;
              return left != null && Number.isFinite(Number(left)) ? Number(left) : null;
            }))
        : Promise.resolve(null);
      const pageGroupP = SHOW_CAMPAIGNS_RULED ? loadPageGroup(input.db, event.client_id, genre) : Promise.resolve(null);
      // Matas, 26 Nov: rechecked on every read — Similar's stored audiences sized under Meta's minimum skip it (its share goes to Cold).
      const similarP = SHOW_CAMPAIGNS_RULED && similarStored.length && meta ? similarSizesOf(meta, similarStored.map((row) => row.meta_audience_id!)).then((got) => ((calls += got.calls), got.allUnderMinimum)) : Promise.resolve(false);
      const ceilingP = SHOW_CAMPAIGNS_RULED ? showCeilingOf(input.db, { id: event.id, code }, inputs.campaigns.flatMap((campaign) => campaign.campaignIds)) : Promise.resolve(null);
      const prospectingGraph = graphFor("prospecting");
      const prospectingP = SHOW_CAMPAIGNS_RULED && prospectingGraph && event.event_date ? readProspecting(prospectingGraph, inputs.campaigns, code, day, event.event_date).then((got) => ((calls += got.calls), got.budgets)).catch(() => null) : Promise.resolve(null);

      const [{ pixelId, fallbackPixel }, showPages, pixelHosts, , campaignStatus, linkSizes, remainingMinor, pageGroup, similarTooSmall, ceiling, prospectingRead] = await Promise.all([pixelP, pagesP, hostsP, accountP, statusP, sizesP, remainingP, pageGroupP, similarP, ceilingP, prospectingP]);
      // A show whose own Pages read failed falls back to the client's default Pages, with /me/accounts' roles.
      const roles = input.connector ? (showPages ? null : await rolesOf()) : await rolesOf();
      if (input.connector && !showPages && roles) calls += roles.calls;
      const sources = sourceSetFor({ event, rows: sourceRows, pixelId, roles: roles?.roles ?? null, hasVideo, links: links.links, pages: showPages?.pages ?? null });
      let funnelBuilt = funnelBuiltOf(buildRow, widerId ? { remainingMinor, doneDays: widerDoneDays(stepRows, event.id) } : null);
      let funnelWeek: RetargetingInput["funnelWeek"];
      if (funnelBuilt?.campaignId && buildRow?.progress?.active && meta) {
        calls += 1;
        funnelWeek = await funnelWeekOf(meta, funnelBuilt.campaignId, buildRow.progress.adSets ?? {});
      }
      const announcementAt = eventRow?.announcement_at ?? null;
      const madeAudiences = madeRows.filter((row) => row.event_id === event.id && row.meta_audience_id).map((row) => row.part);
      // Matas, 27 Nov: a group confirmed after the build brings Similar back at the next stretch step.
      let similarOutcome: SimilarStepOutcome | null = null;
      if (similarStepDue({ dryRun, ruled: SHOW_CAMPAIGNS_RULED, row: buildRow, pageGroup, day }) && input.similarStep) {
        similarOutcome = await input.similarStep({ event, build: buildRow!.build as FunnelBuild, pageGroup: pageGroup!, day }).catch((err) => ({ state: "failed" as const, reason: fillRf("rt.similar.fail.error"), progress: { ...(buildRow!.progress ?? {}), similarRefused: { day, reason: fillRf("rt.similar.fail.error") } }, error: err instanceof Error ? err.message : String(err) }));
        if (similarOutcome.state !== "skipped") {
          // What the step left on the build, over what this read loaded.
          buildRow!.progress = { ...(buildRow!.progress ?? {}), ...similarOutcome.progress };
          funnelBuilt = funnelBuiltOf(buildRow, widerId ? { remainingMinor, doneDays: widerDoneDays(stepRows, event.id) } : null);
        }
        if (similarOutcome.state === "failed") mySkipped.push({ eventCode: code, reason: `Similar not added at this step: ${similarOutcome.reason ?? "unknown"}${similarOutcome.error ? ` (${similarOutcome.error})` : ""}` });
      }
      const planInput = retargetingInput({ matchedPages: SHOW_CAMPAIGNS_RULED ? (showPages?.matched ?? matchedPagesOf(sources.pages, roles?.names)) : null, fallbackPixel, ceiling, connector: input.connector === true, prospectingRead, twoCampaigns: SHOW_CAMPAIGNS_RULED, pageGroup, genreFamily: genre, similarTooSmall, announcementAt, funnelBuilt, funnelWeek, madeAudiences, event, day, rows, campaigns: inputs.campaigns, read, budgets: purchases.budgets, sources, appliedLine, minDailyMinor: account ? (minDaily.get(account) ?? null) : null, linksRead: links.linksRead, pixelHosts, campaignStatus, otherLandingHosts: [...otherLandingHosts(landingByShow, event.id)], linkSizes, testWinner, pooledRead, signups: signupsSyncOf(syncRows.filter((row) => row.event_id === event.id), event), accountTimeZone: account ? (timeZones.get(account) ?? null) : null });
      const plan = planRetargeting(planInput);
      const record: RetargetingRecord = { eventId: event.id, eventCode: event.event_code, plan, input: planInput, proposalId: null, ...(similarOutcome && similarOutcome.state !== "skipped" ? { similarStep: { state: similarOutcome.state, reason: similarOutcome.reason } } : {}) };
      // RT13: a running campaign's rules against today's links. A failed read keeps the last rules, so nothing is compared.
      const storedRules = ((appliedLine?.applied_result?.retargeting ?? null) as { rules?: Record<string, string[]> } | null)?.rules;
      if (plan.state === "running" && storedRules && comparesRules(links.linksRead)) {
        const specs = tierSpecs(sources);
        const changed = ruleChanges(storedRules, pixelRules(specs));
        if (changed.length) {
          record.ruleChanges = changed;
          // Ops (17 Nov): the refresh's token and write path, behind its gates; only a campaign an accepted Create line built.
          const createWrite = (appliedLine?.write ?? null) as { draftId?: string | null; adAccountId?: string | null } | null;
          const audienceIds = ((appliedLine?.applied_result?.retargeting ?? null) as { audiences?: Record<string, string> } | null)?.audiences ?? {};
          const gates = ruleRewriteGates(input.env);
          if (dryRun || !input.graphPost || !gates.ok || !appliedLine || !createWrite?.draftId || !createWrite.adAccountId) {
            mySkipped.push({ eventCode: code, reason: `Retargeting links changed for ${changed.length} audience${changed.length === 1 ? "" : "s"}; not rewritten (${dryRun ? "dry run" : !gates.ok ? gates.reason : "no applied Create line or writer"})` });
          } else {
            const owner = await ownerOf(input.db, event.id);
            const token = await refreshTokenFor(input.db as never, owner);
            if (!token) mySkipped.push({ eventCode: code, reason: "Retargeting links changed; no Facebook token for the event's owner, so not rewritten" });
            else {
              const post = input.graphPost;
              const rewritten = await rewriteRules(
                { post: (path, body) => post(path, body, token), ledger: { supabase: input.db as never, userId: owner, draftId: createWrite.draftId, eventId: event.id } },
                { code, adAccountId: createWrite.adAccountId, lineId: appliedLine.id, specs, audienceIds, changed, stored: storedRules },
              );
              calls += rewritten.written.length + rewritten.failed.length;
              record.rulesRewritten = rewritten.written;
              for (const row of rewritten.failed) mySkipped.push({ eventCode: code, reason: `Retargeting rule rewrite ${row.key}: ${row.reason}` });
              if (rewritten.rebuild.length) mySkipped.push({ eventCode: code, reason: `Retargeting: ${rewritten.rebuild.length} per-link audience${rewritten.rebuild.length === 1 ? "" : "s"} added or dropped; a rebuild, not a rule rewrite` });
              if (rewritten.written.length) {
                const progress = (appliedLine.applied_result?.retargeting ?? {}) as Record<string, unknown>;
                const stored = await input.db.from("onsale_refresh_lines").update({ applied_result: { ...appliedLine.applied_result, retargeting: { ...progress, rules: rewritten.rules } } }).eq("id", appliedLine.id);
                if (stored.error) myErrors.push(`${code}: storing the rewritten rules: ${stored.error.message}`);
              }
            }
          }
        }
      }
      if (!dryRun && plan.state !== "no_signal") {
        // RT17: the call, on the panel of every show in the test that this read covers.
        const mineTest = testShows.find((row) => row.eventId === event.id);
        const callForShow = call && mineTest && mineTest.draftId
          ? { line: call, write: { ...callWrite({ winner: call.winner, from: pooledRead!.from, tests: testShows }), draftId: mineTest.draftId, adAccountId: (appliedLine?.write?.adAccountId as string | null | undefined) ?? account, campaignIds: [mineTest.test.arms?.A?.campaignId, mineTest.test.arms?.B?.campaignId].filter((id): id is string => Boolean(id)) } }
          : null;
        record.proposalId = await writeRetargetingProposal(input.db, { event, day, plan, mode: retargetingGates(applyGates(input.env, arms.get(event.id))).mode, userId: input.userId, call: callForShow });
      }
      if (showNotRead.size) record.notRead = SHOW_UNREAD.filter((source) => showNotRead.has(source));
      return { record, skipped: mySkipped, errors: myErrors, calls };
    } catch (err) {
      myErrors.push(`${event.event_code ?? event.id}: ${err instanceof Error ? err.message : String(err)}`);
      return { record: null, skipped: mySkipped, errors: myErrors, calls };
    }
  };

  const records: RetargetingRecord[] = [];
  const take = (got: Awaited<ReturnType<typeof planShow>>) => {
    skipped.push(...got.skipped);
    errors.push(...got.errors);
    metaCalls += got.calls;
    if (got.record) records.push(got.record);
  };
  const showsFrom = Date.now();
  if (!limits) {
    for (const event of events) take(await planShow(event, null));
  } else {
    // A few shows at a time, each within showMs, none started after the whole read's budget; one slow show holds up no other.
    const results = await runPool(events, { concurrency: limits.concurrency, itemMs: limits.showMs, signal: total.signal }, async (event, signal) => {
      const from = Date.now();
      const got = await planShow(event, signal);
      console.log(`[retargeting-read] show ${event.event_code ?? event.id} ms=${ms(from)} meta_calls=${got.calls}${got.record?.notRead?.length ? ` not_read=${got.record.notRead.join(",")}` : ""}`);
      return got;
    });
    events.forEach((event, i) => {
      const got = results[i]!;
      if (got.ok) take(got.value);
      else {
        unfinished.push({ eventId: event.id, eventCode: event.event_code, why: got.unfinished === "total" ? "total" : "show" });
        console.log(`[retargeting-read] show ${event.event_code ?? event.id} unfinished=${got.unfinished}`);
      }
    });
  }
  steps.shows = ms(showsFrom);
  return done(records, metaCalls);
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
export async function writeRetargetingProposal(db: Db, args: { event: EventRow; day: string; plan: RetargetingPlan; mode: ArmMode; userId?: string; call?: { line: NonNullable<ReturnType<typeof callLine>>; write: Record<string, unknown> } | null }): Promise<string> {
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
        campaign_ids: plan.build?.campaignIds ?? [],
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
  if (args.call) {
    // RT17: the call (or "No clear winner after 28 days") — once decided on this read, not proposed again the same day.
    const decidedCall = await db.from("onsale_refresh_lines").select("id").eq("proposal_id", proposalId).eq("kind", "retargeting_test_call").neq("state", "to_review").neq("state", "expired");
    if (decidedCall.error) throw new Error(`onsale_refresh_lines decided call: ${decidedCall.error.message}`);
    if (!((decidedCall.data ?? []) as unknown[]).length) {
      const call = args.call.line;
      const written = await db.from("onsale_refresh_lines").insert({
        proposal_id: proposalId,
        user_id: userId,
        position: 3,
        kind: "retargeting_test_call",
        rule_id: `retargeting.test_${call.kind}`,
        title: call.title,
        detail: call.detail,
        write_text: call.writeText,
        narrow: { detail: call.narrow, writeText: call.narrowSub },
        target: { winner: call.winner },
        evidence: { onAccept: call.onAccept, kind: call.kind },
        write: args.call.write,
        adds_spend: false,
        blocked_reason: null,
        supply: false,
        state: "to_review",
      });
      if (written.error) throw new Error(`onsale_refresh_lines call: ${written.error.message}`);
    }
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
