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
import { pixelRules, ruleChanges, tierSpecs, type SourceList, type SourcePage, type SourceSet } from "./audiences.ts";
import { linksFallback, linksFromPages, otherLandingHosts, type PixelHosts, type ShowLink } from "./links.ts";
import { planRetargeting, retargetingOnSaleDay, type RetargetingInput, type RetargetingPlan } from "./plan.ts";
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
  events: { id: string; venue_id: string | null; mailchimp_tag?: string | null }[];
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
    loadAll<SourceRows["events"][number]>(db, "events", "id, venue_id, mailchimp_tag", ["id"], (q) => q.in("id", eventIds)),
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

export type RetargetingRecord = {
  eventId: string;
  eventCode: string | null;
  plan: RetargetingPlan;
  proposalId: string | null;
  /** RT13: a running campaign's audiences whose rules differ from today's links (not rewritten here: see the PR's open item). */
  ruleChanges?: string[];
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
  };
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
        minDaily.set(account, await input.graph.graphGet(`/${account}`, { fields: "min_daily_budget" }).then((body) => num((body as { min_daily_budget?: unknown }).min_daily_budget) || null).catch(() => null));
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
      const plan = planRetargeting(retargetingInput({ event, day, rows, campaigns: inputs.campaigns, read, budgets: purchases.budgets, sources, appliedLine, minDailyMinor: account ? (minDaily.get(account) ?? null) : null, linksRead: links.linksRead, pixelHosts: pixelId ? (hostsByPixel.get(pixelId) ?? null) : null, campaignStatus, otherLandingHosts: [...otherLandingHosts(landingByShow, event.id)], linkSizes }));
      const record: RetargetingRecord = { eventId: event.id, eventCode: event.event_code, plan, proposalId: null };
      // RT13: a running campaign's rules against today's links. A failed read keeps the last rules, so nothing is compared.
      const storedRules = ((appliedLine?.applied_result?.retargeting ?? null) as { rules?: Record<string, string[]> } | null)?.rules;
      if (plan.state === "running" && storedRules && comparesRules(links.linksRead)) {
        const changed = ruleChanges(storedRules, pixelRules(tierSpecs(sources)));
        if (changed.length) {
          record.ruleChanges = changed;
          skipped.push({ eventCode: code, reason: `Retargeting links changed for ${changed.length} audience${changed.length === 1 ? "" : "s"}; rules not rewritten` });
        }
      }
      if (!dryRun && plan.state !== "no_signal") {
        record.proposalId = await writeRetargetingProposal(input.db, { event, day, plan, mode: retargetingGates(applyGates(input.env, arms.get(event.id))).mode, userId: input.userId });
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
export async function writeRetargetingProposal(db: Db, args: { event: EventRow; day: string; plan: RetargetingPlan; mode: ArmMode; userId?: string }): Promise<string> {
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
