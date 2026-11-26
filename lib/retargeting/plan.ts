/**
 * The Retargeting campaign's plan for one show (docs/design-record/2026-11-17-retargeting-campaign.html,
 * RT1, RT2, RT3 before it runs, RT8, RT9). Pure: it reads what the
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
import { shortCampaign } from "../onsale-refresh/purchase-campaign.ts";
import { midBuildable, pagesWithoutRole, perLinkAudiences, tierSpecs, usablePages, type SourceSet } from "./audiences.ts";
import { firedOn, landingLinks, landingShared, pixelOnOwnDomains, pixelOnPlatforms, ticketLinks, type PixelHosts } from "./links.ts";
import { callFor, type PooledRead } from "./test.ts";
import { planFunnelShow, type FunnelShowPlan } from "./funnel-plan.ts";
import { funnelCampaignName, type FunnelAccount, type FunnelTier, type ProspectingBudget, type TakeLine, type TierMinor, type TierWeek } from "./funnel.ts";
import { funnelSourcesOf, proposedPanel, runningPanel, type FunnelPanel } from "./funnel-view.ts";
import type { FunnelBuild } from "./funnel-apply.ts";
import { currentDailyMinor, daysToShow, isShare, type Funding, type Share } from "./budget.ts";
import {
  audiencesNarrow,
  audiencesShort,
  ARM_LABEL,
  armBAudiences,
  eachArmLine,
  eachArmNarrow,
  META_SPLITS,
  callDetail,
  callNarrow,
  callNarrowSub,
  callOnAccept,
  callTitle,
  callWrite,
  noClearWinner,
  notCalledYet,
  tooCloseToCall,
  type Arm,
  BOTTOM_NOT_BUILT,
  BY_LINK_BEFORE_CREATE,
  sizeBand,
  sizesLine,
  pixelLine,
  TICKET_SITE_COUNTS,
  LINKS_NO_PAGE,
  LINKS_NOT_READ,
  noRegistrations,
  noSignupList,
  signupsFailedSend,
  signupsNotLinked,
  signupsOn,
  signupsWaiting,
  SIGNUPS_FAILED_READ,
  SIGNUPS_NOT_CONFIGURED,
  SIGNUPS_SWITCH_OFF,
  SIGNUPS_SWITCH_OFF_NONE,
  type SignupsSync,
  buyersListAge,
  CREATE_WRITE,
  leavesOut,
  legacyAdSets,
  MID_NOT_BUILT,
  NO_FIGURE,
  NO_PIXEL,
  NO_PIXEL_PURCHASES,
  NO_PAGE_OR_TICKET,
  nothingReaches,
  NO_BUYERS_LIST,
  NOT_READ,
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

export type RetargetingState = "before_onsale" | "no_pixel" | "sells_elsewhere" | "nothing_reaches" | "no_purchases" | "no_url" | "not_read" | "links_no_page" | "links_failed" | "no_signal" | "no_spend" | "no_money" | "proposed" | "running";

/** An RT8 action opens the client page's customer-audience wizard with this role and this show chosen. */
export type MissingLine = { text: string; narrow: string; actions: { label: string; role: "signups" | "buyers" }[]; muted?: boolean; /** SU1: "writes off" reads ochre. */ ochre?: boolean };

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
  /** RT11's 10–25 %, or RF3's 25–50 %. */
  share: number;
  totalMinor: number;
  tiers: Record<string, number>;
  atFloor: boolean;
  holdMinor: number;
  /** RT4's money (the 17 Nov path); absent under the funnel (RF4 takes from prospecting). */
  funding?: Funding;
  line: string;
  split: string;
  hold: string;
  /** Accept is held at this share (over the cap, nothing to move from). */
  blocked: string | null;
  /** RT11: the stretch that sets today's share ("final month"); null normally. */
  stretch?: string | null;
};

/** RT17: a running test's arm, as its table (1280) and card (393) show it. */
export type ArmRow = { tier: Tier; label: string; audiences: string[]; pool: string | null; frequency: number | null; budgetMinor: number; cost: number | null; purchases: number | null };
export type ArmView = { arm: Arm; label: string; halfMinor: number; rows: ArmRow[]; total: { spentMinor: number; budgetMinor: number; cost: number | null; purchases: number } };
export type PooledRow = { arm: Arm; shows: number; days: number; spend: number; purchases: number; cost: number | null };
export type TestView = { title: string; eachArm: string; eachArmNarrow: string; metaSplits: string; arms: ArmView[]; pooled: PooledRow[] | null; pooledDays: number | null; note: string | null };

/** RT17: what the read gathered for a running test (each arm's tiers over 7 days, and the pooled read across every show). */
export type RunningTest = {
  arms: Record<Arm, Partial<Record<Tier, { budgetMinor: number; spendMinor: number; purchases: number; frequency: number | null; pool: string | null }>>>;
  pooled: PooledRead | null;
};

export type CreateCard = {
  title: string;
  defaultShare: number;
  options: ShareOption[];
  /** "1 retargeting ad set already runs in …: pause it once this is live." per campaign. */
  legacy: string[];
  writeText: string;
  days: number;
  /** RT17: an entered show, "£{half} a day to each arm · Meta splits people at random, so nobody sees both". */
  eachArm?: string | null;
  /** RT17: a show under £6.00 a day, "Too small to test: … so it runs layout A only." */
  tooSmall?: string | null;
  /** Design (25 Nov): an entered show, "Test starts {Ddd d Mon}, 00:00 London time, and runs to {show day}." */
  startsLine?: string | null;
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
  /** RT17: a running test's two arms and the pooled read. */
  test?: TestView | null;
  /** RF1–RF9: the funnel's panel (share line, access, Create card, tier rows, next stretch). When set, the panel draws it in place of the 17 Nov tiers. */
  funnel?: FunnelPanel | null;
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
  /** RT18: landing hosts other shows' pages use (no pixel line for them). */
  otherLandingHosts?: string[];
  /** RT17: the layout test's winner once its call was accepted (new shows start on it, as one campaign); null while it runs. */
  testWinner?: Arm | null;
  /** RT17: a running test's figures. */
  test?: RunningTest | null;
  /** RT18: a running campaign's per-link audience sizes by key (Meta's approximate count); null = not read. */
  linkSizes?: Record<string, { lower: number; upper: number } | null>;
  /** RT17: the ad account's timezone_name, as read; the start line no longer uses it (Matas, 25 Nov: the line is London's). */
  accountTimeZone?: string | null;
  /** SU1: the show's Signups list into Meta (customer_list_syncs); absent = not switched on (RT15's line). */
  signups?: SignupsSync | null;
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
  /** RF3: the announcement day (events.announcement_at), else the first on-sale day. */
  announceDay?: string | null;
  /** RF4: the show's delivering prospecting budgets (daily), pennies. */
  prospecting?: ProspectingBudget[];
  /** RF2 / RF6: the accounts with their advertiser access; absent = from `sources.pages`. */
  accounts?: FunnelAccount[];
  /** Audience keys already made for the show (onsale_refresh_audiences). */
  madeAudiences?: string[];
  /** The show's funnel build (retargeting_builds), when it has one. */
  funnelBuilt?: { state: string; mode: "paused" | "live" | null; campaignId: string | null; tiers: TierMinor; took: TakeLine[] } | null;
  /** RF5: each tier's 7-day frequency and spend, once it runs. */
  funnelWeek?: Partial<Record<FunnelTier, TierWeek>>;
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
  /** RT17: an entered show's two arms, half the total each (50 / 25 / 25 inside the arm). Null = one campaign. */
  test?: { halfMinor: number; arms: Record<Arm, Record<Tier, number>> } | null;
  /** RT17: the one campaign's layout — A, or the test's winner. */
  layout?: Arm;
};

export type RetargetingPlan = {
  state: RetargetingState;
  /** RT9: the show takes this campaign; the refresh's per-campaign Retargeting default stands down. */
  takes: boolean;
  view: RetargetingView;
  /** Under the funnel a FunnelBuild; a 17 Nov line stored before it keeps its RetargetingBuild. */
  build: FunnelBuild | RetargetingBuild | null;
  /** RF1–RF9: the show's funnel plan (plan_retargeting reads it). */
  funnel?: FunnelShowPlan | null;
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

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/**
 * RT13 / RT15: what Bottom has. Visits, checkouts and registrations are
 * known from the pixel's hosts (28 days); a shared landing host (crqln.com)
 * can't say whose registrations they are, so it counts as "might".
 */
export function bottomSignals(sources: SourceSet, hosts: PixelHosts | undefined, others: ReadonlySet<string> = new Set()): { visits: boolean | null; checkouts: boolean | null; registrations: boolean | null; signups: boolean; empty: boolean } {
  const tickets = ticketLinks(sources.links);
  const landing = landingLinks(sources.links);
  const signups = sources.lists.some((list) => list.role === "signups");
  if (!hosts) return { visits: null, checkouts: null, registrations: null, signups, empty: false };
  const visits = tickets.some((link) => firedOn(hosts.pageView, link.host));
  const checkouts = tickets.some((link) => firedOn(hosts.checkout, link.host));
  const registrations = landing.some((link) => landingShared(link.host, others) || firedOn(hosts.registration, link.host));
  return { visits, checkouts, registrations, signups, empty: !visits && !checkouts && !registrations && !signups };
}

/**
 * SU1: Bottom's Signups line, where RT15's line sits. Not switched on is
 * RT15 as it is (and nothing when a signups list was uploaded by hand);
 * otherwise one state, then the lines added under it (writes off ochre,
 * a failed read or send brick). Set like the buyers line: on Meta and
 * waiting read muted.
 */
export function signupsLines(sync: SignupsSync | null, has: readonly string[], signupLists: number): MissingLine[] {
  const line = (text: string, tone: "muted" | "brick" | "ochre", actions: MissingLine["actions"] = []): MissingLine => ({ text, narrow: text, actions, ...(tone === "muted" ? { muted: true } : tone === "ochre" ? { muted: true, ochre: true } : {}) });
  if (!sync || sync.state === "not_on") {
    if (signupLists) return [];
    return [line(noSignupList(has), "brick", [{ label: UPLOAD_SIGNUP_LIST, role: "signups" }])];
  }
  const lines: MissingLine[] = [];
  if (sync.state === "waiting") lines.push(line(signupsWaiting(sync.madeOn, has), "muted"));
  else if (sync.state === "on") lines.push(line(signupsOn(sync.count, sync.lastSentAt, sync.rebuiltOn), "muted"));
  else if (sync.state === "not_linked") lines.push(line(signupsNotLinked(sync.tag), "brick"));
  else lines.push(line(SIGNUPS_NOT_CONFIGURED, "brick"));
  if (sync.writesOff) lines.push(line(sync.state === "on" ? SIGNUPS_SWITCH_OFF : SIGNUPS_SWITCH_OFF_NONE, "ochre"));
  if (sync.failedRead) lines.push(line(SIGNUPS_FAILED_READ, "brick"));
  if (sync.failedSend) lines.push(line(signupsFailedSend(sync.failedSend.taken, sync.failedSend.sent), "brick"));
  return lines;
}

/** RT2 / RT8 / RT13–RT15: the tier rows for these budgets, with their links and missing lines. */
export function tierRows(input: Pick<RetargetingInput, "sources" | "pixelHosts" | "otherLandingHosts" | "linkSizes" | "signups"> & { today?: string; created?: boolean }, budgets: Record<Tier, number>): { rows: TierRow[]; notes: MissingLine[] } {
  const sources = input.sources;
  const others = new Set(input.otherLandingHosts ?? []);
  const signals = bottomSignals(sources, input.pixelHosts, others);
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
  const ownDomains = pixelOnOwnDomains(sources.links, input.pixelHosts ?? null, others);
  // RT18: each link's audience size once created, else "By link: known after create".
  const sizes = (tier: Tier) => {
    if (!input.created) return BY_LINK_BEFORE_CREATE;
    const perLink = perLinkAudiences(specs.find((row) => row.tier === tier));
    return sizesLine(perLink.map((row) => {
      const size = input.linkSizes?.[row.key];
      return { name: row.name, band: size ? sizeBand(size.lower, size.upper) : null };
    }));
  };
  const rows: TierRow[] = [];
  for (const tier of TIERS) {
    const spec = specs.find((row) => row.tier === tier);
    const missing: MissingLine[] = [];
    const links: TierRow["links"] = { wide: [], narrow: [] };
    if (tier === "bottom") {
      if (signals.empty) missing.push({ text: BOTTOM_NOT_BUILT, narrow: BOTTOM_NOT_BUILT, actions: [{ label: UPLOAD_SIGNUP_LIST, role: "signups" }] });
      else {
        if (hasTickets) {
          links.wide.push(sizes("bottom"));
          if (platforms?.length) {
            links.wide.push(pixelLine(platforms));
            if (platforms.some((row) => !row.on)) links.wide.push(TICKET_SITE_COUNTS);
          }
        }
        // RT15: registrations reach the pixel from no landing page in 28 days (own hosts only; a shared host can't say).
        if (hasLanding && signals.registrations === false) {
          const text = noRegistrations(landing.map((link) => link.name));
          missing.push({ text, narrow: text, actions: [] });
        }
        const has = [...(hasTickets ? ["ticket-link visitors", "checkout starters"] : []), ...(hasLanding ? ["registrations"] : [])];
        missing.push(...signupsLines(input.signups ?? null, has, signupLists));
      }
    }
    if (tier === "mid_bottom" && hasLanding) {
      links.wide.push(sizes("mid_bottom"));
      // A pixel line only for a show's own domain, never a shared host.
      if (ownDomains?.length) links.wide.push(pixelLine(ownDomains));
    }
    // RT18: on a phone, the same lines.
    links.narrow = [...links.wide];
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

/** RF3's dates and RF4's budgets for the funnel plan of one show (a build's tiers and take when it has one). */
function funnelPlanOf(input: RetargetingInput): FunnelShowPlan | null {
  if (!input.eventDate) return null;
  const sources = funnelSourcesOf(input.sources, input.accounts);
  return planFunnelShow({
    code: input.eventCode,
    runDay: input.runDay,
    showDay: input.eventDate,
    announceDay: input.announceDay ?? input.onSaleDay,
    prospecting: input.prospecting ?? [],
    minDailyMinor: input.minDailyMinor,
    sources,
    made: new Set(input.madeAudiences ?? []),
    existing: input.funnelBuilt ? { totalMinor: input.funnelBuilt.tiers.similar + input.funnelBuilt.tiers.cold + input.funnelBuilt.tiers.warm + input.funnelBuilt.tiers.hot, took: input.funnelBuilt.took } : null,
  });
}

export function planRetargeting(input: RetargetingInput): RetargetingPlan {
  const code = input.eventCode;
  const title = funnelCampaignName(code);
  const base = { code, title, create: null, signal: null, tiers: [], notes: [], running: null };
  const none = (state: RetargetingState, notProposed: string | null, takes: boolean): RetargetingPlan => ({ state, takes, view: { ...base, state, notProposed }, build: null, held: null });
  // Before the on-sale date, nothing changes (RT9).
  if (!input.onSaleDay || input.onSaleDay > input.runDay) return none("before_onsale", input.onSaleDay ? startsOnSale(input.onSaleDay) : null, false);
  const sources = funnelSourcesOf(input.sources, input.accounts);
  // The show already has the campaign (a build record, or one that delivers): it runs.
  if (input.funnelBuilt || input.existing) {
    const plan = funnelPlanOf(input);
    const built = input.funnelBuilt ?? null;
    const tiers: TierMinor = built?.tiers ?? { similar: 0, cold: 0, warm: 0, hot: 0 };
    const funnel = plan && input.eventDate ? runningPanel(plan, sources, input.eventDate, { tiers, took: built?.took ?? [], week: input.funnelWeek }) : null;
    const read = input.read;
    const path = read ? signalPath(read) : null;
    const signal = read && (path === "own_domain" || path === "platform") ? { wide: signalLine(path, { pixelName: read.pixelName, domain: read.domain }), narrow: signalNarrow(path, { pixelName: read.pixelName, domain: read.domain }) } : null;
    return {
      state: "running",
      takes: true,
      view: { ...base, state: "running", notProposed: null, signal, funnel, running: null },
      build: null,
      held: null,
      funnel: plan,
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

  const plan = funnelPlanOf(input)!;
  const funnel = proposedPanel(plan, sources, input.eventDate);
  const signal = { wide: signalLine(path, { pixelName: read.pixelName, domain: read.domain }), narrow: signalNarrow(path, { pixelName: read.pixelName, domain: read.domain }) };
  // RF4: nothing to give, no Create; the line says to raise the show's budget first.
  if (plan.noMoney) return { state: "no_money", takes: true, view: { ...base, state: "no_money", notProposed: null, signal, funnel }, build: null, held: null, funnel: plan };
  const legacy = input.legacy.filter((row) => row.adSets > 0).map((row) => legacyAdSets(row.adSets, shortCampaign(row.campaign)));
  const option: ShareOption = { share: plan.share, totalMinor: plan.totalMinor, tiers: plan.tiers, atFloor: plan.atFloor.length > 0, holdMinor: 0, line: funnel.shareLine, split: funnel.create!.split, hold: funnel.create!.take.join(" "), blocked: null, stretch: null };
  const days = Math.max(0, daysToShow(input.runDay, input.eventDate));
  const create: CreateCard = { title, defaultShare: plan.share, options: [option], legacy, writeText: CREATE_WRITE, days };
  const held = !input.where.draftId || !input.where.adAccountId ? NOT_OURS : input.ads.length ? null : NO_ADS;
  const customConversion = path === "own_domain" && read.domain ? { name: `${code} · Purchase on ${read.domain}`, domain: read.domain } : null;
  const build: FunnelBuild = {
    kind: "retargeting_funnel_create",
    eventId: input.eventId,
    eventCode: code,
    campaignName: title,
    path,
    pixelId: read.pixel.id,
    customConversion,
    sources,
    startDay: input.runDay,
    endDay: input.eventDate,
    plan: { stretch: plan.stretch, share: plan.share, showDailyMinor: plan.showDailyMinor, targetMinor: plan.targetMinor, totalMinor: plan.totalMinor, tiers: plan.tiers, take: plan.take.from, steps: plan.steps },
    ads: input.ads,
    geoFromAdsetId: input.geoFromAdsetId,
    videoCampaignIds: input.videoCampaignIds ?? input.where.campaignIds,
    draftId: input.where.draftId,
    adAccountId: input.where.adAccountId,
    campaignIds: input.where.campaignIds,
  };
  return { state: "proposed", takes: true, view: { ...base, state: "proposed", notProposed: null, create, signal, funnel }, build, held, funnel: plan };
}

/** RT8's first not-proposed state, for a show whose on-sale date hasn't come (no read runs for it yet). */
export function retargetingBeforeOnSale(code: string, onSaleDay: string): RetargetingView {
  return { code, title: retargetingCampaignName(code), state: "before_onsale", notProposed: startsOnSale(onSaleDay), create: null, signal: null, tiers: [], notes: [], running: null };
}

/** The share Accept takes: RT11 offers one (today's); null = that one. */
export function pickedShare(view: RetargetingView | null | undefined, value: unknown): { ok: true; share: number | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, share: null };
  const option = typeof value === "number" || isShare(value) ? view?.create?.options.find((row) => row.share === value) : undefined;
  if (!option) return { ok: false, error: "The Create line's share is today's; there's no other to pick." };
  if (option.blocked) return { ok: false, error: option.blocked };
  return { ok: true, share: option.share };
}

export { NO_FIGURE };

const joinLower = (lines: readonly string[]) => lines.map((line, index) => (index === 0 ? line : line.charAt(0).toLowerCase() + line.slice(1))).join(" · ");

/** RT17's running view: each arm's tiers over 7 days, its total row, the pooled block and its note. */
export function testView(test: RunningTest, layoutA: readonly TierRow[], sources: SourceSet): TestView {
  const signupLists = sources.lists.filter((list) => list.role === "signups").length;
  const similarLists = sources.lists.filter((list) => list.role === "similar").length;
  const hasLanding = Boolean(sources.pixelId) && landingLinks(sources.links).length > 0;
  const arms: ArmView[] = (["A", "B"] as const).map((arm) => {
    const figures = test.arms[arm];
    const rows: ArmRow[] = TIERS.flatMap((tier) => {
      const row = figures[tier];
      if (!row) return [];
      const fromA = layoutA.find((a) => a.tier === tier)?.audiences ?? [];
      // RG: A's Bottom on two lines, its Mid Bottom on one; B's per armBAudiences.
      const audiences = arm === "B" ? armBAudiences(tier, { signupLists, similarLists, hasLanding }) : tier === "bottom" ? [fromA[0]!, joinLower(fromA.slice(1))].filter(Boolean) : tier === "mid_bottom" ? [joinLower(fromA)] : fromA;
      return [{ tier, label: TIER_LABEL[tier], audiences, pool: row.pool, frequency: row.frequency == null ? null : Math.round(row.frequency * 10) / 10, budgetMinor: row.budgetMinor, cost: row.purchases > 0 ? Math.round(row.spendMinor / row.purchases) / 100 : null, purchases: row.purchases }];
    });
    const spent = TIERS.reduce((sum, tier) => sum + (figures[tier]?.spendMinor ?? 0), 0);
    const bought = TIERS.reduce((sum, tier) => sum + (figures[tier]?.purchases ?? 0), 0);
    const budget = TIERS.reduce((sum, tier) => sum + (figures[tier]?.budgetMinor ?? 0), 0);
    return { arm, label: ARM_LABEL[arm], halfMinor: budget, rows, total: { spentMinor: spent, budgetMinor: budget, cost: bought > 0 ? Math.round(spent / bought) / 100 : null, purchases: bought } };
  });
  const half = arms[0]!.halfMinor;
  const call = test.pooled ? callFor(test.pooled) : null;
  const note = !call ? null : call.kind === "not_yet" ? notCalledYet({ day: call.day, a: call.a, b: call.b, shows: call.shows }) : call.kind === "too_close" ? tooCloseToCall(call) : null;
  return {
    title: "",
    eachArm: eachArmLine(half),
    eachArmNarrow: eachArmNarrow(half),
    metaSplits: META_SPLITS,
    arms,
    pooled: test.pooled ? (["A", "B"] as const).map((arm) => ({ arm, shows: test.pooled!.arms[arm].shows, days: test.pooled!.days, spend: test.pooled!.arms[arm].spend, purchases: test.pooled!.arms[arm].purchases, cost: test.pooled!.arms[arm].cost })) : null,
    pooledDays: test.pooled?.days ?? null,
    note,
  };
}

/** RT17: the call's line, when the pooled read makes one (or the 28-day "no clear winner"). */
export function callLine(read: PooledRead): { kind: "call" | "no_clear_winner"; title: string; detail: string; onAccept: string | null; writeText: string; narrow: string; narrowSub: string; winner: Arm } | null {
  const call = callFor(read);
  if (call.kind === "call") {
    return { kind: "call", title: callTitle(call.winner), detail: callDetail(call), onAccept: callOnAccept(call.winner, call.shows), writeText: callWrite(call.shows), narrow: callNarrow(call), narrowSub: callNarrowSub(call.shows, call.days), winner: call.winner };
  }
  if (call.kind === "no_clear_winner") {
    const text = noClearWinner(call);
    return { kind: "no_clear_winner", title: text, detail: text, onAccept: null, writeText: callWrite(read.shows), narrow: text, narrowSub: callNarrowSub(read.shows, read.days), winner: "A" };
  }
  return null;
}
