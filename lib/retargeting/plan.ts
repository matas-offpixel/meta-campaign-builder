/**
 * The Retargeting campaign's plan for one show (docs/design-record/2026-11-17-retargeting-campaign.html,
 * RT1, RT2, RT3 before it runs, RT4, RT8, RT9). Pure: it reads what the
 * read already gathered and returns the state, the Create line, the tier
 * rows and what Accept would build. Nothing here writes.
 *
 * RT1, in order:
 *   - the show's first on-sale date (presale when stored, else general
 *     sale) has come: before it, "Retargeting starts when …";
 *   - a pixel resolved (else "no pixel");
 *   - a read that didn't fail (else "couldn't be read");
 *   - what it optimises on: the show's own-domain custom conversion when
 *     its own domain had a purchase in 28 days (E1, T5); otherwise the
 *     pixel's standard Purchase on the platform path when T2's guard passes
 *     (the platform carries at least half the pixel's purchases). A pixel
 *     that mostly sells elsewhere: not proposed;
 *   - the show has no `{code} · Retargeting` campaign yet (else running);
 *   - spend in the last 7 days to size a budget from (RT4).
 * None of RT8's missing sources blocks Create.
 *
 * RT9: `takes` is true when the show has this campaign, its Create line is
 * proposed, or the read couldn't tell — the on-sale refresh then stops
 * proposing its per-campaign Retargeting default and shows one note.
 */

import type { PurchaseRead } from "../onsale-refresh/purchases.ts";
import { campaignFloor, shortCampaign } from "../onsale-refresh/purchase-campaign.ts";
import { midBuildable, pagesWithoutRole, tierSpecs, usablePages, type SourceSet } from "./audiences.ts";
import { firedOn, isSharedHost, landingLinks, pixelOnPlatforms, ticketLinks, type PixelHosts } from "./links.ts";
import { shareOn, STRETCH_LABEL } from "./shares.ts";
import { currentDailyMinor, daysToShow, fundHold, isShare, RT4, startingBudget, type Funding, type Share, type Starting } from "./budget.ts";
import {
  audiencesNarrow,
  audiencesShort,
  BOTTOM_NOT_BUILT,
  linksLine,
  LINKS_NO_PAGE,
  LINKS_NOT_READ,
  noRegistrations,
  noSignupList,
  pixelOnLine,
  retargetingOff,
  TICKET_SITE_PIXEL,
  buyersListAge,
  CREATE_WRITE,
  createLine,
  createSplit,
  fromText,
  holdLine,
  leavesOut,
  legacyAdSets,
  MID_NOT_BUILT,
  NO_FIGURE,
  NO_PIXEL,
  NO_PIXEL_PURCHASES,
  NO_PAGE_OR_TICKET,
  nothingReaches,
  NO_SPEND,
  NO_BUYERS_LIST,
  NOT_READ,
  noMoney,
  overCap,
  pagesNoRole,
  pagesNoRoleNarrow,
  retargetingCampaignName,
  sellsElsewhere,
  signalLine,
  signalNarrow,
  startsOnSale,
  TIER_LABEL,
  TIERS,
  UPLOAD_BUYERS,
  UPLOAD_SIGNUP_LIST,
  type Tier,
} from "./words.ts";

export type RetargetingState = "before_onsale" | "no_pixel" | "sells_elsewhere" | "nothing_reaches" | "no_purchases" | "no_url" | "not_read" | "links_no_page" | "links_failed" | "no_signal" | "no_spend" | "proposed" | "running";

/** An RT8 action opens the client page's customer-audience wizard with this role and this show chosen. */
export type MissingLine = { text: string; narrow: string; actions: { label: string; role: "signups" | "buyers" }[] };

export type TierRow = {
  tier: Tier;
  label: string;
  /** RT3's includes in short, one entry per line (1280); RT10's single line (393). */
  audiences: string[];
  audiencesNarrow: string;
  /** Meta's delivery estimate band ("3,900–4,600", "Below 1,000"); null before it's read (PR B's daily read). */
  pool: string | null;
  /** 7-day frequency to one decimal; null before the campaign runs. */
  frequency: number | null;
  leavesOut: string;
  budgetMinor: number;
  /** 7-day cost per attributed purchase, £; null before it runs. */
  cost: number | null;
  purchases: number | null;
  /** RT13 / ops (17 Nov): the tier's links and whether the pixel is on each ticket site, in ink-3. */
  links: { wide: string[]; narrow: string[] };
  missing: MissingLine[];
};

export type ShareOption = {
  share: Share;
  totalMinor: number;
  tiers: Record<Tier, number>;
  atFloor: boolean;
  holdMinor: number;
  funding: Funding;
  line: string;
  split: string;
  hold: string;
  /** Accept is held at this share (over the cap, nothing to move from). */
  blocked: string | null;
  /** RT11: the stretch that sets today's share ("final month"); null normally. */
  stretch?: string | null;
};

export type CreateCard = {
  title: string;
  defaultShare: Share;
  options: ShareOption[];
  /** "1 retargeting ad set already runs in …: pause it once this is live." per campaign. */
  legacy: string[];
  writeText: string;
  days: number;
};

export type RetargetingView = {
  code: string;
  title: string;
  state: RetargetingState;
  /** RT8's not-proposed sentence (replaces the Create line), or null. */
  notProposed: string | null;
  create: CreateCard | null;
  /** RT3's signal line, wide and narrow; null when not proposed. */
  signal: { wide: string; narrow: string } | null;
  tiers: TierRow[];
  /** RT8 lines that affect every tier (buyers), under the table. */
  notes: MissingLine[];
  /** Running: RT3's header lines, and RT9's "{code} · Retargeting is off." when Meta says it isn't delivering. */
  running: { totalMinor: number; share: number; since: string; showDay: string; off?: string | null } | null;
};

export type RetargetingMain = {
  campaignKey: string;
  campaignId: string | null;
  lifetimeGbp: number | null;
  spentToDate: number;
  last7Daily: number;
};

export type RetargetingInput = {
  eventId: string;
  eventCode: string;
  runDay: string;
  eventDate: string | null;
  /** Presale when stored, else general sale (YYYY-MM-DD). */
  onSaleDay: string | null;
  read: PurchaseRead | undefined;
  /** The show's Meta spend over the last 7 days, on-sale campaigns only (not Tests, not Retargeting), £. */
  last7SpendGbp: number;
  /** The ad account's min_daily_budget, minor units; null when not read. */
  minDailyMinor: number | null;
  sources: SourceSet;
  /** The show's `{code} · Retargeting` campaign, whatever its status (Meta's effective_status when read); null when it has none. */
  existing: { campaignId: string | null; since: string | null; totalMinor: number | null; share: number | null; tiers?: Partial<Record<Tier, number>>; status?: string | null } | null;
  /** RT13: how the show's links were read — CIRQLIN's pages, RT2's two links (no tag), or the two failures. */
  linksRead?: "ok" | "no_tag" | "no_page" | "failed";
  /** The pixel's hosts in 28 days, per event (aggregation=host); null when not read. */
  pixelHosts?: PixelHosts;
  /** Delivering ad sets with "retarget" in their name, per campaign of the show (not this one). */
  legacy: { campaign: string; adSets: number }[];
  budgetGbp: number | null;
  spendToDateGbp: number;
  committedGbp: number | null;
  main: RetargetingMain | null;
  /** The ads the tiers reuse: live in the show's on-sale campaigns, one per creative name. */
  ads: { adId: string; name: string }[];
  /** An on-sale ad set whose location the tiers copy. */
  geoFromAdsetId: string | null;
  /** The main campaign's draft on this account (the ledger's key); null = nothing can be applied. */
  where: { draftId: string | null; adAccountId: string | null; campaignIds: string[] };
  /** Every on-sale campaign of the show: Apply lists their ads' videos for Mid (every video of the show's ads). */
  videoCampaignIds?: string[];
  /** Today's date for list ages (London). */
  today?: string;
};

export type RetargetingBuild = {
  kind: "retargeting_campaign_create";
  eventCode: string;
  campaignName: string;
  path: "platform" | "own_domain";
  pixelId: string;
  customConversion: { name: string; domain: string } | null;
  sources: SourceSet;
  byShare: Record<string, { totalMinor: number; tiers: Record<Tier, number>; headroom: number; move: number }>;
  defaultShare: Share;
  /** The share Matas picked on Accept (default when unset). */
  share?: Share;
  startDay: string;
  endDay: string;
  main: (RetargetingMain & { floorGbp: number; short: string }) | null;
  ads: { adId: string; name: string }[];
  geoFromAdsetId: string | null;
  videoCampaignIds: string[];
  draftId: string | null;
  adAccountId: string | null;
  campaignIds: string[];
};

export type RetargetingPlan = {
  state: RetargetingState;
  /** RT9: the show takes this campaign; the refresh's per-campaign Retargeting default stands down. */
  takes: boolean;
  view: RetargetingView;
  build: RetargetingBuild | null;
  /** Accept is held for every share: no ads to reuse, no draft. */
  held: string | null;
};

const PLATFORM_STATES = new Set<PurchaseRead["state"]>(["platform_proposed", "platform_under_bar"]);
const OWN_STATES = new Set<PurchaseRead["state"]>(["proposed", "under_bar"]);

/** RT1's signal: the own domain with a purchase in 28 days, else the platform path past T2's guard. */
export function signalPath(read: PurchaseRead): "own_domain" | "platform" | "sells_elsewhere" | "nothing_reaches" | "no_purchases" | "no_url" | null {
  if (OWN_STATES.has(read.state) && read.domain && (read.onDomain?.d28 ?? 0) > 0) return "own_domain";
  if (PLATFORM_STATES.has(read.state)) return "platform";
  if (read.state === "pixel_sells_elsewhere") return "sells_elsewhere";
  // RT8 / RT9 (#1299 6ec5353): three more shows that can't take the campaign.
  if (read.state === "no_url") return "no_url";
  if (read.state === "platform_no_purchases" || (read.state === "under_bar" && read.pixelWide != null && read.pixelWide.history === 0)) return "no_purchases";
  if (read.domain && !read.platform && (read.state === "nothing_reaches" || OWN_STATES.has(read.state))) return "nothing_reaches";
  return null;
}

/** The not-proposed paths: none takes the campaign, so the refresh's per-campaign default stays (RT9). */
const CANT_TAKE = new Set(["sells_elsewhere", "nothing_reaches", "no_purchases", "no_url"] as const);

const NO_ADS = "No ad is live in the show's on-sale campaigns, so there's nothing to reuse.";
const NOT_OURS = "Not one of this event's drafts on this account, so nothing is written to this campaign.";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/**
 * RT13 / RT15: what Bottom has. Visits, checkouts and registrations are
 * known from the pixel's hosts (28 days); a shared landing host (crqln.com)
 * can't say whose registrations they are, so it counts as "might".
 */
export function bottomSignals(sources: SourceSet, hosts: PixelHosts | undefined): { visits: boolean | null; checkouts: boolean | null; registrations: boolean | null; signups: boolean; empty: boolean } {
  const tickets = ticketLinks(sources.links);
  const landing = landingLinks(sources.links);
  const signups = sources.lists.some((list) => list.role === "signups");
  if (!hosts) return { visits: null, checkouts: null, registrations: null, signups, empty: false };
  const visits = tickets.some((link) => firedOn(hosts.pageView, link.host));
  const checkouts = tickets.some((link) => firedOn(hosts.checkout, link.host));
  const registrations = landing.some((link) => isSharedHost(link.host) || firedOn(hosts.registration, link.host));
  return { visits, checkouts, registrations, signups, empty: !visits && !checkouts && !registrations && !signups };
}

/** RT2 / RT8 / RT13–RT15: the tier rows for these budgets, with their links and missing lines. */
export function tierRows(input: Pick<RetargetingInput, "sources" | "pixelHosts"> & { today?: string }, budgets: Record<Tier, number>): { rows: TierRow[]; notes: MissingLine[] } {
  const sources = input.sources;
  const signals = bottomSignals(sources, input.pixelHosts);
  const specs = tierSpecs(sources, { bottom: !signals.empty });
  const buyers = sources.lists.some((list) => list.role === "buyers");
  const signupLists = sources.lists.filter((list) => list.role === "signups").length;
  const similarLists = sources.lists.filter((list) => list.role === "similar").length;
  const pages = usablePages(sources.pages);
  const allPages = new Set(sources.pages.map((page) => page.id)).size;
  const noRole = pagesWithoutRole(sources.pages).filter((page) => page.kind === "lineup" || page.kind === "promoter" || page.kind === "event" || page.kind === "venue");
  const hasVideo = sources.videos.some((group) => group.videoIds.length > 0);
  const tickets = ticketLinks(sources.links);
  const landing = landingLinks(sources.links);
  const hasTickets = Boolean(sources.pixelId) && tickets.length > 0;
  const hasLanding = Boolean(sources.pixelId) && landing.length > 0;
  const platforms = pixelOnPlatforms(sources.links, input.pixelHosts ?? null);
  const rows: TierRow[] = [];
  for (const tier of TIERS) {
    const spec = specs.find((row) => row.tier === tier);
    const missing: MissingLine[] = [];
    const links: TierRow["links"] = { wide: [], narrow: [] };
    if (tier === "bottom") {
      if (signals.empty) missing.push({ text: BOTTOM_NOT_BUILT, narrow: BOTTOM_NOT_BUILT, actions: [{ label: UPLOAD_SIGNUP_LIST, role: "signups" }] });
      else {
        if (hasTickets) {
          links.wide.push(linksLine(tickets.map((link) => link.name)));
          if (platforms?.length) {
            links.wide.push(pixelOnLine(platforms));
            if (platforms.some((row) => !row.on)) links.wide.push(TICKET_SITE_PIXEL);
            links.narrow.push(pixelOnLine(platforms));
          }
        }
        // RT15: registrations reach the pixel from no landing page in 28 days (own hosts only; a shared host can't say).
        if (hasLanding && signals.registrations === false) {
          const text = noRegistrations(landing.map((link) => link.name));
          missing.push({ text, narrow: text, actions: [] });
        }
        if (!signupLists) {
          const has = [...(hasTickets ? ["ticket-link visitors", "checkout starters"] : []), ...(hasLanding ? ["registrations"] : [])];
          const text = noSignupList(has);
          missing.push({ text, narrow: text, actions: [{ label: UPLOAD_SIGNUP_LIST, role: "signups" }] });
        }
      }
    }
    if (tier === "mid_bottom" && hasLanding) links.wide.push(linksLine(landing.map((link) => link.name)));
    if (tier === "mid" && noRole.length) {
      const names = noRole.map((page) => page.name);
      missing.push({ text: pagesNoRole(names), narrow: pagesNoRoleNarrow(names), actions: [] });
    }
    if (tier === "mid" && !midBuildable(sources)) missing.push({ text: MID_NOT_BUILT, narrow: MID_NOT_BUILT, actions: [] });
    if (!spec && !(tier === "mid" || (tier === "bottom" && signals.empty))) continue;
    const audiences = spec ? audiencesShort(tier, { signupLists, similarLists, pagesUsed: pages.length, pagesTotal: allPages, hasVideo, hasTickets, hasLanding }) : [];
    rows.push({
      tier,
      label: TIER_LABEL[tier],
      audiences,
      audiencesNarrow: audiencesNarrow(audiences),
      pool: null,
      frequency: null,
      leavesOut: leavesOut(tier, buyers),
      budgetMinor: budgets[tier],
      cost: null,
      purchases: null,
      links,
      missing,
    });
  }
  const notes: MissingLine[] = [];
  const buyerLists = sources.lists.filter((list) => list.role === "buyers").sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
  if (buyerLists.length) {
    const latest = buyerLists[0]!.uploadedAt.slice(0, 10);
    const age = Math.max(0, daysBetween(latest, input.today ?? latest));
    const text = buyersListAge(latest, age);
    // RT8: the two hand-uploaded list lines, as the record writes them.
    notes.push({ text, narrow: text, actions: [] });
  } else {
    // RT8 (revised 17 Nov): one line whether or not ticketing is connected, and no ticketing action until Matas rules.
    notes.push({ text: NO_BUYERS_LIST, narrow: NO_BUYERS_LIST, actions: [{ label: UPLOAD_BUYERS, role: "buyers" }] });
  }
  return { rows, notes };
}

/**
 * RT1's state alone, from what the on-sale refresh already has (RT9 asks it
 * on every campaign of the show). `storedLine`: the show's Create line was
 * proposed before (open, accepted or rejected).
 */
export function retargetingState(input: { onSaleDay: string | null; runDay: string; eventDate: string | null; read: PurchaseRead | undefined; existing: boolean; last7SpendGbp: number; storedLine?: boolean }): { state: RetargetingState; takes: boolean } {
  if (!input.onSaleDay || input.onSaleDay > input.runDay) return { state: "before_onsale", takes: false };
  if (input.existing) return { state: "running", takes: true };
  const read = input.read;
  if (!read || read.state === "not_read") return { state: "not_read", takes: true };
  if (read.state === "no_pixel" || !read.pixel) return { state: "no_pixel", takes: false };
  const path = signalPath(read);
  if (path && (CANT_TAKE as Set<string>).has(path)) return { state: path as RetargetingState, takes: false };
  if (!path || !input.eventDate) return { state: "no_signal", takes: Boolean(input.storedLine) };
  if (!(currentDailyMinor(input.last7SpendGbp) > 0)) return { state: "no_spend", takes: true };
  return { state: "proposed", takes: true };
}

/** The show's first on-sale date (RT1): presale when stored, else general sale. */
export function retargetingOnSaleDay(event: { presale_at?: string | null; general_sale_at?: string | null }): string | null {
  const raw = event.presale_at || event.general_sale_at;
  return raw ? raw.slice(0, 10) : null;
}

export function planRetargeting(input: RetargetingInput): RetargetingPlan {
  const code = input.eventCode;
  const title = retargetingCampaignName(code);
  const base = { code, title, create: null, signal: null, tiers: [], notes: [], running: null };
  const none = (state: RetargetingState, notProposed: string | null, takes: boolean): RetargetingPlan => ({ state, takes, view: { ...base, state, notProposed }, build: null, held: null });
  // Before the on-sale date, nothing changes (RT9).
  if (!input.onSaleDay || input.onSaleDay > input.runDay) return none("before_onsale", input.onSaleDay ? startsOnSale(input.onSaleDay) : null, false);
  // The show already has the campaign: it runs (PR B reads its tiers).
  if (input.existing) {
    const tiers = { bottom: input.existing.tiers?.bottom ?? 0, mid_bottom: input.existing.tiers?.mid_bottom ?? 0, mid: input.existing.tiers?.mid ?? 0 };
    const { rows, notes } = tierRows({ sources: input.sources, pixelHosts: input.pixelHosts, today: input.today ?? input.runDay }, tiers);
    const read = input.read;
    const path = read ? signalPath(read) : null;
    const signal = read && (path === "own_domain" || path === "platform") ? { wide: signalLine(path, { pixelName: read.pixelName, domain: read.domain }), narrow: signalNarrow(path, { pixelName: read.pixelName, domain: read.domain }) } : null;
    return {
      state: "running",
      takes: true,
      view: { ...base, state: "running", notProposed: null, signal, tiers: rows, notes, running: input.existing.since && input.eventDate && input.existing.totalMinor != null ? { totalMinor: input.existing.totalMinor, share: input.existing.share ?? RT4.defaultShare, since: input.existing.since, showDay: input.eventDate, off: input.existing.status != null && input.existing.status !== "ACTIVE" ? retargetingOff(code) : null } : null },
      build: null,
      held: null,
    };
  }
  const read = input.read;
  if (!read || read.state === "not_read") return none("not_read", NOT_READ, true);
  if (read.state === "no_pixel" || !read.pixel) return none("no_pixel", NO_PIXEL, false);
  const path = signalPath(read);
  if (path === "sells_elsewhere") {
    const share = read.platformShare;
    const host = share?.elsewhereHost ?? "another site";
    const pixelPurchases = share?.pixelPurchases ?? 0;
    const elsewhere = share ? pixelPurchases - share.purchases : 0;
    const pct = pixelPurchases > 0 ? Math.round(((share?.elsewherePurchases ?? elsewhere) / pixelPurchases) * 100) : 0;
    return none("sells_elsewhere", sellsElsewhere({ host, pct, purchases: pixelPurchases, platform: read.platform ?? "the ticket site" }), false);
  }
  if (path === "nothing_reaches") return none("nothing_reaches", nothingReaches(read.domain ?? "the show's domain"), false);
  if (path === "no_purchases") return none("no_purchases", NO_PIXEL_PURCHASES, false);
  if (path === "no_url") return none("no_url", NO_PAGE_OR_TICKET, false);
  // Still silent in the record (a shared domain, no domain of its own, no ticket link stored): not proposed, and the refresh's default stands.
  if (path !== "own_domain" && path !== "platform") return none("no_signal", null, false);
  if (!input.eventDate) return none("no_signal", null, false);
  // RT13: the show's links come from CIRQLIN; without them nothing can be built.
  if (input.linksRead === "no_page") return none("links_no_page", LINKS_NO_PAGE, true);
  if (input.linksRead === "failed") return none("links_failed", LINKS_NOT_READ, true);
  const daily = currentDailyMinor(input.last7SpendGbp);
  if (!(daily > 0)) return none("no_spend", NO_SPEND, true);

  const buildable = midBuildable(input.sources);
  const days = Math.max(0, daysToShow(input.runDay, input.eventDate));
  const mainShort = input.main ? shortCampaign(input.main.campaignKey) : null;
  const floor = input.main ? campaignFloor(input.main.spentToDate, input.main.last7Daily).floor : 0;
  // RT11: Create starts at today's share; the 10 / 15 / 20 % choice is withdrawn.
  const today = shareOn(input.runDay, input.eventDate);
  const stretch = today.stretch ? STRETCH_LABEL[today.stretch] : null;
  const bottomBuildable = !bottomSignals(input.sources, input.pixelHosts).empty;
  const options: ShareOption[] = [];
  for (const share of [today.share as Share]) {
    const start = startingBudget({ currentDailyMinor: daily, share, minDailyMinor: input.minDailyMinor, midBuildable: buildable, bottomBuildable }) as Starting;
    const holdMinor = start.totalMinor * days;
    const funding = fundHold({ holdMinor, budgetGbp: input.budgetGbp, spendToDateGbp: input.spendToDateGbp, committedGbp: input.committedGbp, main: input.main ? { lifetimeGbp: input.main.lifetimeGbp, spentToDate: input.main.spentToDate, floorGbp: floor } : null });
    const blocked = funding.fits ? null : funding.why === "over_cap" ? overCap(holdMinor, funding.capGbp ?? 0, funding.capOf, mainShort) : noMoney(mainShort);
    const from = fromText({ headroom: funding.headroom, move: funding.move, mainShort, noBudget: input.budgetGbp == null });
    options.push({
      share,
      totalMinor: start.totalMinor,
      tiers: start.tiers,
      atFloor: start.atFloor,
      holdMinor,
      funding,
      line: createLine({ totalMinor: start.totalMinor, pct: share, tiers: start.tiers, atFloor: start.atFloor, floorMinor: start.floorMinor, stretch }),
      split: createSplit({ tiers: start.tiers, atFloor: start.atFloor, floorMinor: start.floorMinor }),
      hold: holdLine(holdMinor, days, from),
      blocked,
      stretch,
    });
  }
  const defaultShare: Share = today.share as Share;
  const chosen = options.find((option) => option.share === defaultShare)!;
  const { rows, notes } = tierRows({ sources: input.sources, pixelHosts: input.pixelHosts, today: input.today ?? input.runDay }, chosen.tiers);
  const legacy = input.legacy.filter((row) => row.adSets > 0).map((row) => legacyAdSets(row.adSets, shortCampaign(row.campaign)));
  const create: CreateCard = { title, defaultShare, options, legacy, writeText: CREATE_WRITE, days };
  const signal = { wide: signalLine(path, { pixelName: read.pixelName, domain: read.domain }), narrow: signalNarrow(path, { pixelName: read.pixelName, domain: read.domain }) };
  const held = !input.where.draftId || !input.where.adAccountId ? NOT_OURS : input.ads.length ? null : NO_ADS;
  const customConversion = path === "own_domain" && read.domain ? { name: `${code} · Purchase on ${read.domain}`, domain: read.domain } : null;
  const build: RetargetingBuild = {
    kind: "retargeting_campaign_create",
    eventCode: code,
    campaignName: title,
    path,
    pixelId: read.pixel.id,
    customConversion,
    sources: { ...input.sources, pages: usablePages(input.sources.pages) },
    byShare: Object.fromEntries(options.map((option) => [String(option.share), { totalMinor: option.totalMinor, tiers: option.tiers, headroom: option.funding.headroom, move: option.funding.move }])),
    defaultShare,
    startDay: input.runDay,
    endDay: input.eventDate,
    main: input.main ? { ...input.main, floorGbp: round2(floor), short: mainShort! } : null,
    ads: input.ads,
    geoFromAdsetId: input.geoFromAdsetId,
    videoCampaignIds: input.videoCampaignIds ?? input.where.campaignIds,
    draftId: input.where.draftId,
    adAccountId: input.where.adAccountId,
    campaignIds: input.where.campaignIds,
  };
  return { state: "proposed", takes: true, view: { ...base, state: "proposed", notProposed: null, create, signal, tiers: rows, notes, running: null }, build, held };
}

/** RT8's first not-proposed state, for a show whose on-sale date hasn't come (no read runs for it yet). */
export function retargetingBeforeOnSale(code: string, onSaleDay: string): RetargetingView {
  return { code, title: retargetingCampaignName(code), state: "before_onsale", notProposed: startsOnSale(onSaleDay), create: null, signal: null, tiers: [], notes: [], running: null };
}

/** The share Accept takes: RT11 offers one (today's); null = that one. */
export function pickedShare(view: RetargetingView | null | undefined, value: unknown): { ok: true; share: Share | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, share: null };
  const option = isShare(value) ? view?.create?.options.find((row) => row.share === value) : undefined;
  if (!option) return { ok: false, error: "The Create line's share is today's; there's no other to pick." };
  if (option.blocked) return { ok: false, error: option.blocked };
  return { ok: true, share: option.share };
}

export { NO_FIGURE };
