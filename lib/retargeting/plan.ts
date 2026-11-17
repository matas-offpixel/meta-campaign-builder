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
import { currentDailyMinor, daysToShow, fundHold, isShare, RT4, startingBudget, type Funding, type Share, type Starting } from "./budget.ts";
import {
  audiencesNarrow,
  audiencesShort,
  buyersListAge,
  CONNECT_TICKETING,
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
  NO_SIGNUP_LIST,
  NO_SPEND,
  NO_TICKETING,
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

export type RetargetingState = "before_onsale" | "no_pixel" | "sells_elsewhere" | "not_read" | "no_signal" | "no_spend" | "proposed" | "running";

/** An RT8 line: the sentence (and its 393 form) with its actions. */
export type MissingLine = { text: string; narrow: string; actions: { label: string; href: "client" | "ticketing" }[] };

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
  /** Running: RT3's header lines. */
  running: { totalMinor: number; share: number; since: string; showDay: string } | null;
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
  ticketingLinked: boolean;
  /** The show's `{code} · Retargeting` campaign, whatever its status; null when it has none. */
  existing: { campaignId: string | null; since: string | null; totalMinor: number | null; share: number | null; tiers?: Partial<Record<Tier, number>> } | null;
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
export function signalPath(read: PurchaseRead): "own_domain" | "platform" | "sells_elsewhere" | null {
  if (OWN_STATES.has(read.state) && read.domain && (read.onDomain?.d28 ?? 0) > 0) return "own_domain";
  if (PLATFORM_STATES.has(read.state)) return "platform";
  if (read.state === "pixel_sells_elsewhere") return "sells_elsewhere";
  return null;
}

const NO_ADS = "No ad is live in the show's on-sale campaigns, so there's nothing to reuse.";
const NOT_OURS = "Not one of this event's drafts on this account, so nothing is written to this campaign.";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** RT2 / RT8: the tier rows for these budgets, with their missing lines. */
export function tierRows(input: Pick<RetargetingInput, "sources" | "ticketingLinked">, budgets: Record<Tier, number>): { rows: TierRow[]; notes: MissingLine[] } {
  const sources = input.sources;
  const specs = tierSpecs(sources);
  const buyers = sources.lists.some((list) => list.role === "buyers");
  const signupLists = sources.lists.filter((list) => list.role === "signups").length;
  const similarLists = sources.lists.filter((list) => list.role === "similar").length;
  const pages = usablePages(sources.pages);
  const allPages = new Set(sources.pages.map((page) => page.id)).size;
  const noRole = pagesWithoutRole(sources.pages).filter((page) => page.kind === "lineup" || page.kind === "promoter" || page.kind === "event" || page.kind === "venue");
  const hasVideo = sources.videos.some((group) => group.videoIds.length > 0);
  const rows: TierRow[] = [];
  for (const tier of TIERS) {
    const spec = specs.find((row) => row.tier === tier);
    const missing: MissingLine[] = [];
    if (tier === "bottom" && !signupLists) missing.push({ text: NO_SIGNUP_LIST, narrow: NO_SIGNUP_LIST, actions: [{ label: UPLOAD_SIGNUP_LIST, href: "client" }] });
    if (tier === "mid" && noRole.length) {
      const names = noRole.map((page) => page.name);
      missing.push({ text: pagesNoRole(names), narrow: pagesNoRoleNarrow(names), actions: [] });
    }
    if (tier === "mid" && !midBuildable(sources)) missing.push({ text: MID_NOT_BUILT, narrow: MID_NOT_BUILT, actions: [] });
    if (!spec && tier !== "mid") continue;
    const audiences = spec ? audiencesShort(tier, { signupLists, similarLists, pagesUsed: pages.length, pagesTotal: allPages, hasVideo }) : [];
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
      missing,
    });
  }
  const notes: MissingLine[] = [];
  const buyerLists = sources.lists.filter((list) => list.role === "buyers").sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
  if (buyerLists.length) {
    const latest = buyerLists[0]!.uploadedAt.slice(0, 10);
    const age = Math.max(0, daysBetween(latest, (input as { today?: string }).today ?? latest));
    const text = buyersListAge(latest, age);
    notes.push({ text, narrow: text, actions: age >= 7 ? [{ label: UPLOAD_BUYERS, href: "client" }] : [] });
  } else if (!input.ticketingLinked) {
    notes.push({ text: NO_TICKETING, narrow: NO_TICKETING, actions: [{ label: CONNECT_TICKETING, href: "ticketing" }, { label: UPLOAD_BUYERS, href: "client" }] });
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
  if (path === "sells_elsewhere") return { state: "sells_elsewhere", takes: false };
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
    const { rows, notes } = tierRows({ ...input, today: input.today ?? input.runDay } as RetargetingInput, tiers);
    const read = input.read;
    const path = read ? signalPath(read) : null;
    const signal = read && (path === "own_domain" || path === "platform") ? { wide: signalLine(path, { pixelName: read.pixelName, domain: read.domain }), narrow: signalNarrow(path, { pixelName: read.pixelName, domain: read.domain }) } : null;
    return {
      state: "running",
      takes: true,
      view: { ...base, state: "running", notProposed: null, signal, tiers: rows, notes, running: input.existing.since && input.eventDate && input.existing.totalMinor != null ? { totalMinor: input.existing.totalMinor, share: input.existing.share ?? RT4.defaultShare, since: input.existing.since, showDay: input.eventDate } : null },
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
  // Record silent (no own-domain purchase in 28 days and no platform path): not proposed, and the refresh's default stands.
  if (!path || !input.eventDate) return none("no_signal", null, false);
  const daily = currentDailyMinor(input.last7SpendGbp);
  if (!(daily > 0)) return none("no_spend", NO_SPEND, true);

  const buildable = midBuildable(input.sources);
  const days = Math.max(0, daysToShow(input.runDay, input.eventDate));
  const mainShort = input.main ? shortCampaign(input.main.campaignKey) : null;
  const floor = input.main ? campaignFloor(input.main.spentToDate, input.main.last7Daily).floor : 0;
  const options: ShareOption[] = [];
  for (const share of RT4.shares) {
    const start = startingBudget({ currentDailyMinor: daily, share, minDailyMinor: input.minDailyMinor, midBuildable: buildable }) as Starting;
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
      line: createLine({ totalMinor: start.totalMinor, pct: share, tiers: start.tiers, atFloor: start.atFloor, floorMinor: start.floorMinor }),
      split: createSplit({ tiers: start.tiers, atFloor: start.atFloor, floorMinor: start.floorMinor }),
      hold: holdLine(holdMinor, days, from),
      blocked,
    });
  }
  const defaultShare: Share = RT4.defaultShare;
  const chosen = options.find((option) => option.share === defaultShare)!;
  const { rows, notes } = tierRows({ ...input, today: input.today ?? input.runDay } as RetargetingInput, chosen.tiers);
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

/** The share Accept takes: one the card offered and that fits; null = the card's default. */
export function pickedShare(view: RetargetingView | null | undefined, value: unknown): { ok: true; share: Share | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, share: null };
  if (!isShare(value)) return { ok: false, error: "Pick 10 %, 15 % or 20 %." };
  const option = view?.create?.options.find((row) => row.share === value);
  if (!option) return { ok: false, error: "Pick 10 %, 15 % or 20 %." };
  if (option.blocked) return { ok: false, error: option.blocked };
  return { ok: true, share: value };
}

export { NO_FIGURE };
