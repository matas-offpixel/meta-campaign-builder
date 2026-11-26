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
import type { CampaignInput } from "../onsale-refresh/rules.ts";
import { loadPageGroup } from "./page-groups.ts";
import { SHOW_CAMPAIGNS_RULED } from "./show-campaigns.ts";

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
  events: { id: string; venue_id: string | null; mailchimp_tag?: string | null; announcement_at?: string | null; genre_family?: string | null }[];
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
    loadAll<SourceRows["events"][number]>(db, "events", "id, venue_id, mailchimp_tag, announcement_at, genre_family", ["id"], (q) => q.in("id", eventIds)),
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
export function sourceSetFor(args: { event: EventRow; rows: SourceRows; pixelId: string | null; roles: Map<string, string | null> | null; hasVideo: boolean; links?: ShowLink[] }): SourceSet {
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
};

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
    prospecting: prospectingOf(campaigns, args.budgets, code),
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
  // SU1: each show's Signups list into Meta. A failed read draws RT15's line, as before SU1.
  const syncRows = await loadAll<SignupsSyncRow & { id: string }>(input.db, "customer_list_syncs", "id, event_id, enabled, meta_audience_id, sent_total, removed_total, last_sent_at, last_replaced_at, created_at, updated_at", ["id"], (q) => q.in("event_id", events.map((event) => event.id)).eq("enabled", true)).catch(() => [] as (SignupsSyncRow & { id: string })[]);
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
  const timeZones = new Map<string, string | null>();
  // RT17: every show in the layout test (an applied Create line with a Meta A/B test), the pooled read, and the winner once called.
  const appliedCreates = await loadAll<{ id: string; write: Record<string, unknown> | null; applied_result: Record<string, unknown> | null; onsale_refresh_proposals: { event_id: string | null; campaign_key: string | null } | null }>(input.db, "onsale_refresh_lines", "id, write, applied_result, onsale_refresh_proposals!inner(event_id, campaign_key)", ["id"], (q) => q.eq("kind", "retargeting_campaign").eq("state", "applied")).catch(() => []);
  const testShows = appliedCreates.flatMap((row) => {
    const test = (row.applied_result?.retargeting as { test?: TestProgress } | undefined)?.test;
    const eventId = row.onsale_refresh_proposals?.event_id;
    if (!test?.studyId || !eventId) return [];
    const code = (row.onsale_refresh_proposals?.campaign_key ?? "").replace(/ · Retargeting$/, "");
    return [{ eventId, code, draftId: (row.write?.draftId as string | null | undefined) ?? null, test }];
  });
  const calls = await loadAll<{ id: string; write: Record<string, unknown> | null; applied_at: string | null }>(input.db, "onsale_refresh_lines", "id, write, applied_at", ["id"], (q) => q.eq("kind", "retargeting_test_call").eq("state", "applied")).catch(() => []);
  const testWinner = (calls.sort((a, b) => ((a.applied_at ?? "") < (b.applied_at ?? "") ? 1 : -1))[0]?.write?.winner as Arm | undefined) ?? null;
  // The first show's test start, as a London day (Apply starts every test at 00:00 Europe/London).
  const testFrom = testShows.flatMap(({ test }) => (test.startAt ? [localDay("Europe/London", new Date(test.startAt))] : [])).sort()[0] ?? null;
  const pooledRead = testShows.length ? pooledFromRows(raw.rows, addDaysIso(day, -1), testFrom) : null;
  const call = !testWinner && pooledRead ? callLine(pooledRead) : null;
  // RF: each show's funnel build and the audiences already made for it.
  const builds = await loadAll<FunnelBuildRow & { id: string }>(input.db, BUILDS_TABLE, "id, event_id, state, mode, meta_campaign_id, progress, build", ["id"], (q) => q.in("event_id", events.map((event) => event.id))).catch(() => [] as (FunnelBuildRow & { id: string })[]);
  // TC6: the Wider steps that ran (scheduled_meta_changes, migration 271).
  const stepRows = SHOW_CAMPAIGNS_RULED && builds.some((row) => row.progress?.wider?.campaignId)
    ? await loadAll<{ id: string; call_key: string; status: string }>(input.db, "scheduled_meta_changes", "id, call_key, status", ["id"], (q) => q.in("event_id", events.map((event) => event.id)).like("call_key", "rf:%:wider")).catch(() => [])
    : [];
  const madeRows = await loadAll<{ id: string; event_id: string; part: string; meta_audience_id: string | null }>(input.db, "onsale_refresh_audiences", "id, event_id, part, meta_audience_id", ["id"], (q) => q.in("event_id", events.map((event) => event.id)).eq("kind", "retargeting_campaign")).catch(() => []);
  const hostsByPixel = new Map<string, PixelHosts>();
  const readLinks = input.pageLinks ?? ((tag: string) => fetchCirqlinPageLinks(tag));
  // RT13: every show's links first, so a landing host another show uses gets no pixel line.
  const linksByShow = new Map<string, Awaited<ReturnType<typeof showLinks>>>();
  for (const event of events) {
    const tagged = { ...event, mailchimp_tag: sourceRows.events.find((row) => row.id === event.id)?.mailchimp_tag ?? null };
    linksByShow.set(event.id, await showLinks(tagged, readLinks));
  }
  const landingByShow = new Map([...linksByShow].map(([id, row]) => [id, row.links]));
  const records: RetargetingRecord[] = [];
  for (const event of events) {
    try {
      const read = purchases.reads.get(event.id);
      const inputs = await buildEventInputs({ event, day, shadow: true, config, raw, aux, drive: null, purchases: read, purchaseBudgets: purchases.budgets });
      const rows = rowsForEvent(raw, event.id);
      const code = event.event_code!;
      const hasVideo = rows.some((row) => !isRetargetingCampaignName(row.campaign_name, code) && num(row.video_plays_3s) > 0);
      const links = linksByShow.get(event.id)!;
      if (links.reason) skipped.push({ eventCode: code, reason: `CIRQLIN links: ${links.reason}` });
      const sources = sourceSetFor({ event, rows: sourceRows, pixelId: read?.pixel?.id ?? null, roles: roles?.roles ?? null, hasVideo, links: links.links });
      const pixelId = read?.pixel?.id ?? null;
      if (pixelId && input.graph && !hostsByPixel.has(pixelId)) {
        const hosts = await pixelHostsOf(input.graph, pixelId, now);
        metaCalls += hosts.calls;
        hostsByPixel.set(pixelId, hosts.hosts);
      }
      const mine = lines.filter((line) => line.onsale_refresh_proposals?.event_id === event.id);
      const appliedLine = mine.find((line) => (line.applied_result?.retargeting as { campaignId?: string } | undefined)?.campaignId) ?? null;
      const account = inputs.campaigns.find((campaign) => campaign.draft)?.draft?.adAccountId ?? null;
      if (account && input.graph && !minDaily.has(account)) {
        metaCalls += 1;
        const body = (await input.graph.graphGet(`/${account}`, { fields: "min_daily_budget,timezone_name" }).catch(() => null)) as { min_daily_budget?: unknown; timezone_name?: unknown } | null;
        minDaily.set(account, body ? num(body.min_daily_budget) || null : null);
        timeZones.set(account, typeof body?.timezone_name === "string" && body.timezone_name ? body.timezone_name : null);
      }
      // RT9: a running campaign's status, so an off one says so (a running campaign keeps its last rules when the links read fails, RT13).
      const campaignId = (appliedLine?.applied_result?.retargeting as { campaignId?: string } | undefined)?.campaignId ?? rows.find((row) => isRetargetingCampaignName(row.campaign_name, code) && row.meta_campaign_id)?.meta_campaign_id ?? null;
      let campaignStatus: string | null = null;
      if (campaignId && input.graph) {
        metaCalls += 1;
        campaignStatus = await input.graph.graphGet(`/${campaignId}`, { fields: "effective_status" }).then((body) => (body as { effective_status?: string }).effective_status ?? null).catch(() => null);
      }
      // RT18: a running campaign's per-link audience sizes.
      const storedAudiences = ((appliedLine?.applied_result?.retargeting ?? null) as { audiences?: Record<string, string> } | null)?.audiences ?? null;
      let linkSizes: RetargetingInput["linkSizes"];
      if (campaignId && storedAudiences && input.graph) {
        const sized = await linkSizesOf(input.graph, storedAudiences);
        metaCalls += sized.calls;
        linkSizes = sized.sizes;
      }
      const buildRow = builds.find((row) => row.event_id === event.id);
      const widerId = buildRow?.progress?.wider?.campaignId ?? null;
      let remainingMinor: number | null = null;
      if (SHOW_CAMPAIGNS_RULED && widerId && input.graph) {
        metaCalls += 1;
        const body = (await input.graph.graphGet(`/${widerId}`, { fields: "budget_remaining" }).catch(() => null)) as { budget_remaining?: unknown } | null;
        remainingMinor = body && body.budget_remaining != null && Number.isFinite(Number(body.budget_remaining)) ? Number(body.budget_remaining) : null;
      }
      let funnelBuilt = funnelBuiltOf(buildRow, widerId ? { remainingMinor, doneDays: widerDoneDays(stepRows, event.id) } : null);
      let funnelWeek: RetargetingInput["funnelWeek"];
      if (funnelBuilt?.campaignId && buildRow?.progress?.active && input.graph) {
        metaCalls += 1;
        funnelWeek = await funnelWeekOf(input.graph, funnelBuilt.campaignId, buildRow.progress.adSets ?? {});
      }
      const announcementAt = sourceRows.events.find((row) => row.id === event.id)?.announcement_at ?? null;
      const madeAudiences = madeRows.filter((row) => row.event_id === event.id && row.meta_audience_id).map((row) => row.part);
      const genre = sourceRows.events.find((row) => row.id === event.id)?.genre_family ?? null;
      const pageGroup = SHOW_CAMPAIGNS_RULED ? await loadPageGroup(input.db, event.client_id, genre) : null;
      // Matas, 27 Nov: a group confirmed after the build brings Similar back at the next stretch step.
      let similarOutcome: SimilarStepOutcome | null = null;
      if (similarStepDue({ dryRun, ruled: SHOW_CAMPAIGNS_RULED, row: buildRow, pageGroup, day }) && input.similarStep) {
        similarOutcome = await input.similarStep({ event, build: buildRow!.build as FunnelBuild, pageGroup: pageGroup!, day }).catch((err) => ({ state: "failed" as const, reason: "Similar couldn’t be added this read.", progress: buildRow!.progress ?? {}, error: err instanceof Error ? err.message : String(err) }));
        if (similarOutcome.state !== "skipped") {
          buildRow!.progress = similarOutcome.progress;
          funnelBuilt = funnelBuiltOf(buildRow, widerId ? { remainingMinor, doneDays: widerDoneDays(stepRows, event.id) } : null);
        }
        if (similarOutcome.state === "failed") skipped.push({ eventCode: code, reason: `Similar not added at this step: ${similarOutcome.reason ?? "unknown"}${similarOutcome.error ? ` (${similarOutcome.error})` : ""}` });
      }
      // Matas, 26 Nov: rechecked on every read — Similar's stored audiences sized under Meta's minimum skip it (its share goes to Cold).
      let similarTooSmall = false;
      const similarStored = madeRows.filter((row) => row.event_id === event.id && row.meta_audience_id && /^rf:similar_/.test(row.part));
      if (SHOW_CAMPAIGNS_RULED && similarStored.length && input.graph) {
        const sized = await similarSizesOf(input.graph, similarStored.map((row) => row.meta_audience_id!));
        metaCalls += sized.calls;
        similarTooSmall = sized.allUnderMinimum;
      }
      const planInput = retargetingInput({ matchedPages: SHOW_CAMPAIGNS_RULED ? matchedPagesOf(sources.pages, roles?.names) : null, twoCampaigns: SHOW_CAMPAIGNS_RULED, pageGroup, genreFamily: genre, similarTooSmall, announcementAt, funnelBuilt, funnelWeek, madeAudiences, event, day, rows, campaigns: inputs.campaigns, read, budgets: purchases.budgets, sources, appliedLine, minDailyMinor: account ? (minDaily.get(account) ?? null) : null, linksRead: links.linksRead, pixelHosts: pixelId ? (hostsByPixel.get(pixelId) ?? null) : null, campaignStatus, otherLandingHosts: [...otherLandingHosts(landingByShow, event.id)], linkSizes, testWinner, pooledRead, signups: signupsSyncOf(syncRows.filter((row) => row.event_id === event.id), event), accountTimeZone: account ? (timeZones.get(account) ?? null) : null });
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
            skipped.push({ eventCode: code, reason: `Retargeting links changed for ${changed.length} audience${changed.length === 1 ? "" : "s"}; not rewritten (${dryRun ? "dry run" : !gates.ok ? gates.reason : "no applied Create line or writer"})` });
          } else {
            const owner = await ownerOf(input.db, event.id);
            const token = await refreshTokenFor(input.db as never, owner);
            if (!token) skipped.push({ eventCode: code, reason: "Retargeting links changed; no Facebook token for the event's owner, so not rewritten" });
            else {
              const post = input.graphPost;
              const done = await rewriteRules(
                { post: (path, body) => post(path, body, token), ledger: { supabase: input.db as never, userId: owner, draftId: createWrite.draftId, eventId: event.id } },
                { code, adAccountId: createWrite.adAccountId, lineId: appliedLine.id, specs, audienceIds, changed, stored: storedRules },
              );
              metaCalls += done.written.length + done.failed.length;
              record.rulesRewritten = done.written;
              for (const row of done.failed) skipped.push({ eventCode: code, reason: `Retargeting rule rewrite ${row.key}: ${row.reason}` });
              if (done.rebuild.length) skipped.push({ eventCode: code, reason: `Retargeting: ${done.rebuild.length} per-link audience${done.rebuild.length === 1 ? "" : "s"} added or dropped; a rebuild, not a rule rewrite` });
              if (done.written.length) {
                const progress = (appliedLine.applied_result?.retargeting ?? {}) as Record<string, unknown>;
                const stored = await input.db.from("onsale_refresh_lines").update({ applied_result: { ...appliedLine.applied_result, retargeting: { ...progress, rules: done.rules } } }).eq("id", appliedLine.id);
                if (stored.error) errors.push(`${code}: storing the rewritten rules: ${stored.error.message}`);
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
