/**
 * Per-event purchases (E1–E4 of
 * docs/design-record/2026-11-13-per-event-purchases.html), pure: which
 * pixel a show's ads really use, whether the show has a domain of its
 * own, what the pixel counted on it, and the sentence the panel says.
 * No database, no Meta, no HTTP — purchase-read.ts gathers the facts.
 *
 * The count that triggers is the count the Purchase campaign would
 * optimise on. With purchases on the show's own domain that is the
 * domain's count (E1). For a show that sells on a ticket platform and
 * sees nothing on a domain of its own it is the purchases Meta credits to
 * the show's ads on the resolved pixel, a signal shared with every show
 * the platform sells, and the sentence says so (T1–T5 of
 * docs/design-record/2026-11-13-ticket-platform-purchases.html). The
 * pixel-wide host count never triggers anything.
 */

import type { PhaseConfig } from "./phase-config.ts";

// ── Hosts ────────────────────────────────────────────────────────────────────

/** Sites that sell every show: never a show's own domain. Matched on the host or any subdomain of it. */
export const TICKET_SITES: readonly { host: string; name: string }[] = [
  { host: "skiddle.com", name: "Skiddle" },
  { host: "universe.com", name: "Universe" },
  { host: "ingresse.com", name: "Ingresse" },
  { host: "ra.co", name: "RA" },
  { host: "residentadvisor.net", name: "RA" },
  { host: "dice.fm", name: "Dice" },
  { host: "eventbrite.com", name: "Eventbrite" },
  { host: "eventbrite.co.uk", name: "Eventbrite" },
  { host: "ticketmaster.com", name: "Ticketmaster" },
  { host: "ticketmaster.co.uk", name: "Ticketmaster" },
  { host: "seetickets.com", name: "See Tickets" },
  { host: "fatsoma.com", name: "Fatsoma" },
  { host: "fixr.co", name: "FIXR" },
  { host: "shotgun.live", name: "Shotgun" },
  { host: "ticketweb.uk", name: "TicketWeb" },
  { host: "ticketweb.com", name: "TicketWeb" },
  { host: "gigantic.com", name: "Gigantic" },
  { host: "ticketswap.com", name: "TicketSwap" },
  { host: "tickettailor.com", name: "Ticket Tailor" },
  { host: "wegottickets.com", name: "WeGotTickets" },
  { host: "eventim.co.uk", name: "Eventim" },
  { host: "kaboodle.co.uk", name: "Kaboodle" },
];

/** Page hosts every show shares: crqln.com carries every CIRQLIN page, the app host every Off/Pixel landing page. */
export const CIRQLIN_HOST = "crqln.com";
export const SHARED_PAGE_HOSTS: readonly string[] = [CIRQLIN_HOST, "app.cirqlin.com", "app.offpixel.co.uk"];

/** Hosts compare exactly as written, except that a leading www. is the same domain (E1). */
export function normaliseHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

export function hostOf(url: string | null | undefined): string | null {
  const text = (url ?? "").trim();
  if (!text) return null;
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`).hostname;
    return host ? normaliseHost(host) : null;
  } catch {
    return null;
  }
}

/** The ticket site's name when the host is one, else null. */
export function ticketSiteOf(host: string | null): string | null {
  if (!host) return null;
  return TICKET_SITES.find((site) => host === site.host || host.endsWith(`.${site.host}`))?.name ?? null;
}

/** A crqln.com page link (crqln.com/l/{slug} or crqln.com/{slug}); null for anything else. */
export function isCirqlinLink(url: string | null | undefined): boolean {
  if (hostOf(url) !== CIRQLIN_HOST) return false;
  try {
    const text = (url ?? "").trim();
    const path = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`).pathname;
    return path.replace(/^\/l\//, "/").replace(/\/+$/, "").length > 1;
  } catch {
    return false;
  }
}

type Platforms = PhaseConfig["ticketPlatforms"];

const onHost = (host: string, site: string) => host === site || host.endsWith(`.${site}`);

/** T1: the ticket platform a host belongs to, from the config's list; null when it is not one. */
export function platformOf(host: string | null, platforms: Platforms): string | null {
  if (!host) return null;
  return platforms.find((platform) => platform.hosts.some((site) => onHost(host, site)))?.name ?? null;
}

/** T1: the platform the show's ticket link is on — its ticket URL's, else a signup URL that is itself a platform link. */
export function platformFor(event: { signup_url: string | null; ticket_url: string | null }, platforms: Platforms): string | null {
  const ticketHost = hostOf(event.ticket_url);
  return ticketHost ? platformOf(ticketHost, platforms) : platformOf(hostOf(event.signup_url), platforms);
}

// ── E1: a domain of its own ──────────────────────────────────────────────────

export type DomainEvent = { id: string; signup_url: string | null; ticket_url: string | null };

/** What the CIRQLIN page behind a crqln.com link says its custom domain is; a failed read is not "none". */
export type CirqlinLookup = { ok: true; domain: string | null } | { ok: false; reason: string };

export type DomainClass =
  | { kind: "no_url" }
  | { kind: "ticket_site_only"; ticketSite: string }
  | { kind: "no_own_domain"; cirqlinPage: boolean }
  | { kind: "shared_domain"; domain: string; others: number }
  | { kind: "own"; domain: string; via: "signup_url" | "cirqlin_custom_domain" }
  | { kind: "not_read"; reason: string };

type Page = { domain: string | null; via: "signup_url" | "cirqlin_custom_domain" | null; cirqlinPage: boolean; sharedHost: boolean; failed: string | null };

/** The domain a show's page sits on: its signup host, or the custom domain behind its CIRQLIN link. A ticket site is not a page. */
function pageOf(event: DomainEvent, lookup: (url: string) => CirqlinLookup | undefined): Page {
  const none: Page = { domain: null, via: null, cirqlinPage: false, sharedHost: false, failed: null };
  const host = hostOf(event.signup_url);
  if (!host || ticketSiteOf(host)) return none;
  if (isCirqlinLink(event.signup_url)) {
    const found = lookup(event.signup_url!.trim());
    if (!found) return { ...none, cirqlinPage: true, failed: "the CIRQLIN page wasn't read" };
    if (!found.ok) return { ...none, cirqlinPage: true, failed: `the CIRQLIN page couldn't be read: ${found.reason}` };
    const custom = found.domain ? normaliseHost(found.domain) : null;
    if (custom && !SHARED_PAGE_HOSTS.includes(custom)) return { domain: custom, via: "cirqlin_custom_domain", cirqlinPage: true, sharedHost: false, failed: null };
    return { ...none, cirqlinPage: true, sharedHost: true };
  }
  if (SHARED_PAGE_HOSTS.includes(host)) return { ...none, sharedHost: true };
  return { domain: host, via: "signup_url", cirqlinPage: false, sharedHost: false, failed: null };
}

/** The ticket site a show sells on: its ticket URL's, else a signup URL that is itself a ticket site. An unknown ticket host is named as written. */
export function ticketSiteFor(event: DomainEvent): string | null {
  const ticketHost = hostOf(event.ticket_url);
  if (ticketHost) return ticketSiteOf(ticketHost) ?? ticketHost;
  return ticketSiteOf(hostOf(event.signup_url));
}

/**
 * E1's own-domain test, shared by the run and the panel: the signup host
 * when no other running or upcoming event uses it, or the CIRQLIN custom
 * domain behind a crqln.com link. `others` are the other running or
 * upcoming events; an event never counts against itself.
 */
export function classifyDomain(event: DomainEvent, others: readonly DomainEvent[], lookup: (url: string) => CirqlinLookup | undefined): DomainClass {
  const page = pageOf(event, lookup);
  if (page.failed) return { kind: "not_read", reason: page.failed };
  if (!page.domain) {
    if (page.cirqlinPage || page.sharedHost) return { kind: "no_own_domain", cirqlinPage: page.cirqlinPage };
    const site = ticketSiteFor(event);
    return site ? { kind: "ticket_site_only", ticketSite: site } : { kind: "no_url" };
  }
  const sharing = others.filter((other) => other.id !== event.id && pageOf(other, lookup).domain === page.domain).length;
  if (sharing > 0) return { kind: "shared_domain", domain: page.domain, others: sharing };
  return { kind: "own", domain: page.domain, via: page.via! };
}

// ── E4: the pixel ────────────────────────────────────────────────────────────

/** The record's evidence shape, exactly. */
export type PixelEvidence = { id: string; source: "ad_sets"; spendShare: number; stored: string | null; matches: boolean };
export type OtherPixel = { id: string; adSets: number; spendShare: number };

/**
 * The pixel in promoted_object.pixel_id on the ad sets that delivered:
 * the one carrying the most spend. `pixelOf` holds every ad set that was
 * read (null = it optimises on no pixel); an ad set missing from it was
 * not read and is left out. Returns null when no delivering ad set has a
 * pixel. `others` are the pixels carrying at least the config's share.
 */
export function resolvePixel(
  adSets: readonly { adsetId: string; spend: number }[],
  pixelOf: ReadonlyMap<string, string | null>,
  stored: string | null,
  config: Pick<PhaseConfig, "secondPixelSpendShare">,
): { pixel: PixelEvidence; others: OtherPixel[] } | null {
  const groups = new Map<string, { spend: number; adSets: number }>();
  let total = 0;
  for (const set of adSets) {
    if (!(set.spend > 0) || !pixelOf.has(set.adsetId)) continue;
    total += set.spend;
    const pixel = pixelOf.get(set.adsetId);
    if (!pixel) continue;
    const have = groups.get(pixel) ?? { spend: 0, adSets: 0 };
    have.spend += set.spend;
    have.adSets += 1;
    groups.set(pixel, have);
  }
  const ranked = [...groups].sort((a, b) => b[1].spend - a[1].spend || b[1].adSets - a[1].adSets || a[0].localeCompare(b[0]));
  const top = ranked[0];
  if (!top || total <= 0) return null;
  const share = (spend: number) => Math.round((spend / total) * 10_000) / 10_000;
  const storedId = stored?.trim() || null;
  return {
    pixel: { id: top[0], source: "ad_sets", spendShare: share(top[1].spend), stored: storedId, matches: storedId === top[0] },
    others: ranked
      .slice(1)
      .map(([id, group]) => ({ id, adSets: group.adSets, spendShare: share(group.spend) }))
      .filter((other) => other.spendShare >= config.secondPixelSpendShare),
  };
}

// ── E2 / E3: the count and the state ─────────────────────────────────────────

/** One day's Purchase count on one host, from Meta's domain breakdown of a pixel. `day` is the bucket's own date. */
export type HostDay = { day: string; host: string; count: number };

/**
 * The states, in the ticket-platform record's order (the first that
 * applies wins): not read; no pixel; no page or ticket URL; a domain with
 * a purchase in the history (shared_domain, under_bar, proposed); a
 * ticket link on a platform (platform_no_purchases, pixel_sells_elsewhere,
 * platform_under_bar, platform_proposed); then what is left
 * (no_own_domain, no_ticket_url, shared_domain, nothing_reaches). "Ticket
 * site only" is retired. Design, 13 Nov: a pixel with no purchases fails
 * the guard as its own state, first on the platform path; a show with a
 * domain nothing reaches and no ticket URL stored says so, ahead of
 * "nothing reaches", which stays for a ticket link on a site that is not
 * a platform.
 */
export type PurchaseState =
  | "not_read"
  | "no_pixel"
  | "no_url"
  | "no_own_domain"
  | "shared_domain"
  | "nothing_reaches"
  | "under_bar"
  | "proposed"
  | "no_ticket_url"
  | "platform_no_purchases"
  | "pixel_sells_elsewhere"
  | "platform_under_bar"
  | "platform_proposed";

/** One ad-day of the show, as the attributed count needs it. */
export type AttributedRow = { date: string; adsetId: string | null; campaign: string; spend: number; purchases: number };

export type AttributedOnPixel = {
  /** T2's trigger: purchases credited to the show's ads on the resolved pixel, from `fromDay` to the window end. */
  count: number;
  /** The later of the 14-day window's start and the show's on-sale date. */
  fromDay: string;
  /** The show has been on sale for less than the 14 days: the sentence says "since {d Mon}". */
  sinceOnSale: boolean;
  /** The same ads since the on-sale date (the 14-day start when none is stored), for T3's cost per attributed purchase. */
  total: { fromDay: string; purchases: number; spend: number; byCampaign: { campaign: string; purchases: number; spend: number }[] };
};

/**
 * T2: the purchases Meta credits to this show's ads on the resolved
 * pixel, counted from the on-sale date: a purchase credited before the
 * show could be bought is another show's. Only ad sets whose
 * promoted_object pixel is the resolved one count; an ad set that was
 * not read is left out.
 */
export function attributedOnPixel(rows: readonly AttributedRow[], pixelOf: ReadonlyMap<string, string | null>, pixelId: string, span: { windowEnd: string; onSaleDay: string | null }): AttributedOnPixel {
  const from14 = addDays(span.windowEnd, -13);
  const onSale = span.onSaleDay && span.onSaleDay <= span.windowEnd ? span.onSaleDay : null;
  const fromDay = onSale && onSale > from14 ? onSale : from14;
  const totalFrom = onSale ?? from14;
  const campaigns = new Map<string, { campaign: string; purchases: number; spend: number }>();
  let count = 0;
  let purchases = 0;
  let spend = 0;
  for (const row of rows) {
    if (row.date > span.windowEnd || row.date < totalFrom) continue;
    if (!row.adsetId || pixelOf.get(row.adsetId) !== pixelId) continue;
    purchases += row.purchases;
    spend += row.spend;
    const have = campaigns.get(row.campaign) ?? { campaign: row.campaign, purchases: 0, spend: 0 };
    have.purchases += row.purchases;
    have.spend += row.spend;
    campaigns.set(row.campaign, have);
    if (row.date >= fromDay) count += row.purchases;
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    count,
    fromDay,
    sinceOnSale: fromDay > from14,
    total: { fromDay: totalFrom, purchases, spend: round(spend), byCampaign: [...campaigns.values()].map((row) => ({ ...row, spend: round(row.spend) })).sort((a, b) => b.spend - a.spend) },
  };
}

export type PurchaseRead = {
  state: PurchaseState;
  pixel: PixelEvidence | null;
  pixelName: string | null;
  otherPixels: OtherPixel[];
  /** The own domain, or the shared one. */
  domain: string | null;
  domainVia: "signup_url" | "cirqlin_custom_domain" | null;
  domainKind: DomainClass["kind"];
  cirqlinPage: boolean;
  sharedWith: number;
  /** The site the show's own ticket link is on. */
  ticketSite: string | null;
  /** "Nothing reaches": where the purchases land instead — the show's ticket site, one that is not on the platform list. */
  landsOn: string | null;
  /** Purchases on the own domain, on the resolved pixel: 14 and 28 days to the window end, and everything Meta returned. */
  onDomain: { d14: number; d28: number; history: number } | null;
  /** Every host on the resolved pixel, the same spans; context only. */
  pixelWide: { d14: number; d28: number; history: number; topHost: string | null } | null;
  /** How far back the domain breakdown reaches (Meta returns 28 days; the record asked for 90). */
  historyDays: number;
  /** T1: the ticket platform the show's ticket link is on, from the config's list; null when it is on none. */
  platform: string | null;
  /** T2's guard, over the breakdown's history: the platform's purchases, the pixel's, the share, and the host most of the rest are on. Null off the platform path. */
  platformShare: { purchases: number; pixelPurchases: number; share: number | null; elsewhereHost: string | null } | null;
  /** T2's trigger on the platform path, and the totals since the on-sale date. Null when no pixel resolved. */
  attributedOnPixel: AttributedOnPixel | null;
  /** C2: the ads' attributed purchases are any show's, never this show's. */
  attributedPurchases: { count: number; scope: "any_show_on_pixel" };
  ticketsSold14: number | null;
  /** Why the read failed, raw. Evidence and the ops log only: the panel, the why line and Slack never show it. */
  notRead: string | null;
};

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Purchases on `host` (null = every host) between two days, inclusive. */
export function countOn(rows: readonly HostDay[], host: string | null, fromDay: string | null, toDay: string | null): number {
  let total = 0;
  for (const row of rows) {
    if (host != null && normaliseHost(row.host) !== host) continue;
    if (fromDay && row.day < fromDay) continue;
    if (toDay && row.day > toDay) continue;
    total += row.count;
  }
  return total;
}

function topHostOf(rows: readonly HostDay[]): string | null {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(normaliseHost(row.host), (totals.get(normaliseHost(row.host)) ?? 0) + row.count);
  return [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

export type ReadPurchasesInput = {
  /** Set when the ad sets' pixels could not be read at all (no token, a Meta error). */
  pixelError: string | null;
  resolved: { pixel: PixelEvidence; others: OtherPixel[] } | null;
  pixelName: string | null;
  domain: DomainClass;
  ticketSite: string | null;
  /** The resolved pixel's Purchase hosts by day; an error string when the read failed; null when it was not read. */
  stats: { rows: readonly HostDay[] } | { error: string } | null;
  windowEnd: string;
  attributed14: number;
  ticketsSold14: number | null;
  /** T1: the platform the show's ticket link is on (platformFor); null = not on a platform. */
  platform?: string | null;
  /** T2: the attributed count on the resolved pixel from the on-sale date (attributedOnPixel); null when no pixel resolved. */
  attributed?: AttributedOnPixel | null;
  config: Pick<PhaseConfig, "ownDomainPurchasesMinIn14Days" | "purchaseHistoryDays" | "ticketPlatforms" | "platformPurchasesMinIn14Days" | "platformShareMin">;
};

/** The purchases on a platform's hosts and on every host, and the host most of the rest are on. */
function platformShareOf(rows: readonly HostDay[], platform: string, platforms: Platforms): NonNullable<PurchaseRead["platformShare"]> {
  const hosts = platforms.find((entry) => entry.name === platform)?.hosts ?? [];
  const others = new Map<string, number>();
  let purchases = 0;
  let pixelPurchases = 0;
  for (const row of rows) {
    const host = normaliseHost(row.host);
    pixelPurchases += row.count;
    if (hosts.some((site) => onHost(host, site))) purchases += row.count;
    else others.set(host, (others.get(host) ?? 0) + row.count);
  }
  const elsewhereHost = [...others].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  return { purchases, pixelPurchases, share: pixelPurchases > 0 ? purchases / pixelPurchases : null, elsewhereHost };
}

/**
 * The state order of the ticket-platform record: the first that applies
 * wins. A read that failed is said, never shown as a zero; a read the
 * deciding state does not need (the breakdown, for a show with no pixel)
 * does not make it unread.
 */
export function readPurchases(input: ReadPurchasesInput): PurchaseRead {
  const { domain, config } = input;
  const base: PurchaseRead = {
    state: "not_read",
    pixel: input.resolved?.pixel ?? null,
    pixelName: input.pixelName,
    otherPixels: input.resolved?.others ?? [],
    domain: domain.kind === "own" || domain.kind === "shared_domain" ? domain.domain : null,
    domainVia: domain.kind === "own" ? domain.via : null,
    domainKind: domain.kind,
    cirqlinPage: domain.kind === "no_own_domain" ? domain.cirqlinPage : domain.kind === "own" && domain.via === "cirqlin_custom_domain",
    sharedWith: domain.kind === "shared_domain" ? domain.others : 0,
    ticketSite: input.ticketSite,
    landsOn: null,
    onDomain: null,
    pixelWide: null,
    historyDays: config.purchaseHistoryDays,
    platform: input.platform ?? null,
    platformShare: null,
    attributedOnPixel: input.attributed ?? null,
    attributedPurchases: { count: input.attributed14, scope: "any_show_on_pixel" },
    ticketsSold14: input.ticketsSold14,
    notRead: null,
  };
  const from14 = addDays(input.windowEnd, -13);
  const from28 = addDays(input.windowEnd, -27);
  const rows = input.stats && "rows" in input.stats ? input.stats.rows : null;
  if (rows) base.pixelWide = { d14: countOn(rows, null, from14, input.windowEnd), d28: countOn(rows, null, from28, input.windowEnd), history: countOn(rows, null, null, null), topHost: topHostOf(rows) };

  if (input.pixelError) return { ...base, notRead: input.pixelError };
  if (!input.resolved) return { ...base, state: "no_pixel" };
  if (domain.kind === "no_url") return { ...base, state: "no_url" };
  if (domain.kind === "not_read") return { ...base, notRead: domain.reason };
  const hasDomain = domain.kind === "own" || domain.kind === "shared_domain";
  const platform = input.platform ?? null;
  // From here a count decides. Nothing is asked of the breakdown for a show with no domain and no platform link.
  if (!rows && (hasDomain || platform)) return { ...base, notRead: input.stats && "error" in input.stats ? `the pixel's purchases couldn't be read: ${input.stats.error}` : "the pixel's purchases weren't read" };

  // T5: the own-domain rule first — a domain a purchase has reached in the history.
  const onDomain = hasDomain && rows ? { d14: countOn(rows, domain.domain, from14, input.windowEnd), d28: countOn(rows, domain.domain, from28, input.windowEnd), history: countOn(rows, domain.domain, null, null) } : null;
  const read = { ...base, onDomain };
  if (onDomain && onDomain.history > 0) {
    if (domain.kind === "shared_domain") return { ...read, state: "shared_domain" };
    return { ...read, state: onDomain.d14 >= config.ownDomainPurchasesMinIn14Days ? "proposed" : "under_bar" };
  }

  // T1–T4: the ticket link is on a platform and nothing reaches a domain of the show's own.
  if (platform && rows) {
    const platformShare = platformShareOf(rows, platform, config.ticketPlatforms);
    const shared = { ...read, platformShare };
    // A pixel with no purchases has nothing for Meta to optimise on: it fails the guard as its own state, whatever is credited.
    if (platformShare.share == null) return { ...shared, state: "platform_no_purchases" };
    // T2's guard: the pixel must mostly sell where this show sells.
    if (platformShare.share < config.platformShareMin) return { ...shared, state: "pixel_sells_elsewhere" };
    return { ...shared, state: (input.attributed?.count ?? 0) >= config.platformPurchasesMinIn14Days ? "platform_proposed" : "platform_under_bar" };
  }

  // What is left (E3, in the breakdown's history). "Ticket site only" is retired: a show whose only link is a ticket site that is not a platform has no domain of its own.
  if (domain.kind === "no_own_domain" || domain.kind === "ticket_site_only") return { ...read, state: "no_own_domain" };
  // A domain (own or shared) nothing has reached, and no ticket link stored: the sales can't be matched to a platform until one is.
  if (hasDomain && !input.ticketSite) return { ...read, state: "no_ticket_url" };
  if (domain.kind === "shared_domain") return { ...read, state: "shared_domain" };
  // E2: an own domain that never sees a purchase while the pixel has them isn't "under the bar". Its ticket link is on a site that is not a platform.
  if (base.pixelWide && base.pixelWide.history > 0) return { ...read, state: "nothing_reaches", landsOn: input.ticketSite };
  return { ...read, state: "under_bar" };
}

// ── E3 / F2: the words ───────────────────────────────────────────────────────

export type PurchaseWhy = {
  /** E4's setup lines: the pixel mismatch, then any second pixel. Empty when there is nothing to say. */
  pixel: string[];
  pixelNarrow: string[];
  purchase: string;
  purchaseNarrow: string;
  /** C2's any-show figure under the purchase line. Null on the platform path, where the attributed figure is the count itself (T4). */
  attributed: string | null;
  attributedNarrow: string | null;
  /** T4: the platform's share of the pixel's purchases, under the platform states in place of the attributed line. */
  context: string | null;
  contextNarrow: string | null;
  moves: string;
  /** The unlinked note, or the ticketing check in Proposed and Under the bar; null otherwise. */
  ticketing: string | null;
};

const last4 = (id: string) => `…${id.slice(-4)}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const UNLINKED_TICKETING = "No linked ticketing: the pixel's purchases can't be checked against real sales.";
const MOVES_INSIDE = "Budget moves stay inside each campaign.";
const MOVES_ACROSS = "Budget moves can cross campaigns on cost per purchase.";
const MOVES_ACROSS_ATTRIBUTED = "Budget moves can cross campaigns on cost per attributed purchase.";

const dayMonthOf = (day: string) => `${Number(day.slice(8, 10))} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(day.slice(5, 7)) - 1]}`;

/** Every sentence of the Objective block's purchase part, at 1280 and 393, from one read (F1, F2). */
export function purchaseWhy(read: PurchaseRead, ticketingLinked: boolean, config: Pick<PhaseConfig, "ownDomainPurchasesMinIn14Days" | "platformPurchasesMinIn14Days">): PurchaseWhy {
  const bar = config.ownDomainPurchasesMinIn14Days;
  // T2: the platform path's count is the attributed one, from the on-sale date; under 14 days on sale it says "since {d Mon}".
  const credited = read.attributedOnPixel?.count ?? 0;
  const span = read.attributedOnPixel?.sinceOnSale ? `since ${dayMonthOf(read.attributedOnPixel.fromDay)}` : "in 14 days";
  const platform = read.platform ?? "the ticket platform";
  const n = read.onDomain?.d14 ?? 0;
  const site = read.ticketSite ?? "the ticket site";
  const not = "Purchase campaign not proposed —";
  const no = "No Purchase campaign:";
  let purchase: string;
  let purchaseNarrow: string;
  switch (read.state) {
    case "proposed":
      purchase = `Purchase campaign proposed — ${plural(n, "purchase")} on ${read.domain} in 14 days.`;
      purchaseNarrow = `Purchase campaign: ${n} on ${read.domain} in 14 days.`;
      break;
    case "under_bar":
      purchase = `${not} ${plural(n, "purchase")} on ${read.domain} in 14 days, under ${bar}.`;
      purchaseNarrow = `${no} ${n} on ${read.domain} in 14 days, under ${bar}.`;
      break;
    case "nothing_reaches":
      purchase = `${not} no purchases have reached ${read.domain} in ${read.historyDays} days; they land on ${read.landsOn ?? site}, which can't be split by show.`;
      purchaseNarrow = `${no} purchases land on ${read.landsOn ?? site}.`;
      break;
    case "shared_domain":
      purchase = `${not} ${read.domain} carries ${plural(read.sharedWith, "other show")}, so this show's purchases can't be told apart.`;
      purchaseNarrow = `${no} ${read.domain} is shared.`;
      break;
    case "no_own_domain":
      purchase = `${not} this show has no domain of its own, so its purchases can't be told apart.${read.cirqlinPage ? " A custom domain on its CIRQLIN page would let them be counted." : ""}`;
      purchaseNarrow = `${no} no domain of its own.`;
      break;
    case "platform_proposed":
      purchase = `Purchase campaign proposed — ${plural(credited, "purchase")} attributed to these ads ${span}, on pixel ${read.pixel ? last4(read.pixel.id) : "—"}. The signal is shared: ${platform} sells every show on this pixel, so Meta optimises for buyers of any of them.`;
      purchaseNarrow = `Purchase campaign: ${credited} attributed ${span} · shared on ${platform}.`;
      break;
    case "platform_under_bar":
      purchase = `${not} ${plural(credited, "purchase")} attributed to these ads ${span}, under ${config.platformPurchasesMinIn14Days}. The signal is shared: ${platform} sells every show on this pixel.`;
      purchaseNarrow = `${no} ${credited} attributed ${span}, under ${config.platformPurchasesMinIn14Days} · shared on ${platform}.`;
      break;
    case "platform_no_purchases":
      purchase = `${not} this pixel has seen no purchases in ${read.historyDays} days, so there's nothing for Meta to optimise on. Check that ${platform} sends its purchases to this pixel.`;
      purchaseNarrow = `${no} no purchases on this pixel in ${read.historyDays} days.`;
      break;
    case "no_ticket_url":
      purchase = `${not} no ticket URL is stored for this show, so its sales can't be matched to a ticket platform. Add the ticket link on the event page.`;
      purchaseNarrow = `${no} no ticket URL stored.`;
      break;
    case "pixel_sells_elsewhere": {
      const elsewhere = read.platformShare?.elsewhereHost ?? "another site";
      purchase = `${not} most of this pixel's purchases are on ${elsewhere}, not ${platform} where this show sells, so optimising on them would chase another site's buyers.`;
      purchaseNarrow = `${no} this pixel's purchases are mostly on ${elsewhere}.`;
      break;
    }
    case "no_url":
      purchase = `${not} this show has no page or ticket URL set.`;
      purchaseNarrow = `${no} no page or ticket URL.`;
      break;
    case "no_pixel":
      purchase = `${not} none of this show's ad sets optimises on a pixel yet.`;
      purchaseNarrow = `${no} no pixel on its ad sets.`;
      break;
    default:
      // Fixed text (design, 13 Nov). The raw reason is in `read.notRead`: it goes to the evidence and the ops log, never the panel.
      purchase = `${not} this show's purchases couldn't be read this run. The next run tries again.`;
      purchaseNarrow = `${no} purchases not read this run.`;
  }

  const attributed = read.attributedPurchases.count;
  const pixel: string[] = [];
  const pixelNarrow: string[] = [];
  if (read.pixel && read.pixel.stored && !read.pixel.matches) {
    const used = last4(read.pixel.id);
    const stored = last4(read.pixel.stored);
    pixel.push(`Ads optimise on pixel ${used}${read.pixelName ? ` (${read.pixelName})` : ""}; the client's stored pixel is ${stored}. Counts use ${used}.`);
    pixelNarrow.push(`Ads use pixel ${used}; stored is ${stored}. Counts use ${used}.`);
  }
  for (const other of read.otherPixels) {
    const line = `${plural(other.adSets, "ad set")} optimise${other.adSets === 1 ? "s" : ""} on pixel ${last4(other.id)}`;
    pixel.push(line);
    pixelNarrow.push(line);
  }

  let ticketing: string | null = ticketingLinked ? null : UNLINKED_TICKETING;
  if (ticketingLinked && read.ticketsSold14 != null && read.onDomain && (read.state === "proposed" || read.state === "under_bar")) {
    const sold = read.ticketsSold14;
    const share = sold > 0 ? ` (${Math.round((n / sold) * 100)} % of sales)` : "";
    ticketing = `Ticketing: ${sold} sold in 14 days · the pixel saw ${n} on ${read.domain}${share}.`;
  }

  // T4: on the platform path the attributed figure is the count, so it isn't repeated; the platform's share takes its place.
  // A pixel with no purchases has neither line under it: there is no share of nothing.
  const onPlatform = read.state === "platform_proposed" || read.state === "platform_under_bar" || read.state === "pixel_sells_elsewhere" || read.state === "platform_no_purchases";
  let context: string | null = null;
  let contextNarrow: string | null = null;
  if (onPlatform && read.state !== "platform_no_purchases" && read.platformShare?.share != null) {
    const pct = Math.round(read.platformShare.share * 100);
    context = `${platform} took ${pct} % of this pixel's ${plural(read.platformShare.pixelPurchases, "purchase")} in ${read.historyDays} days.`;
    contextNarrow = `${platform}: ${pct} % of the pixel's purchases in ${read.historyDays} days.`;
  }

  return {
    pixel,
    pixelNarrow,
    purchase,
    purchaseNarrow,
    attributed: onPlatform ? null : `Attributed to these ads: ${plural(attributed, "purchase")} in 14 days, any show on this pixel.`,
    attributedNarrow: onPlatform ? null : `${plural(attributed, "attributed purchase")} in 14 days, any show.`,
    context,
    contextNarrow,
    moves: read.state === "proposed" ? MOVES_ACROSS : read.state === "platform_proposed" ? MOVES_ACROSS_ATTRIBUTED : MOVES_INSIDE,
    ticketing,
  };
}

/** A read for a campaign input built without one (tests, an old snapshot): nothing was read, and it says so. */
export function unreadPurchases(attributed14: number, config: Pick<PhaseConfig, "purchaseHistoryDays">, reason = "the purchase read didn't run"): PurchaseRead {
  return {
    state: "not_read",
    pixel: null,
    pixelName: null,
    otherPixels: [],
    domain: null,
    domainVia: null,
    domainKind: "not_read",
    cirqlinPage: false,
    sharedWith: 0,
    ticketSite: null,
    landsOn: null,
    onDomain: null,
    pixelWide: null,
    historyDays: config.purchaseHistoryDays,
    platform: null,
    platformShare: null,
    attributedOnPixel: null,
    attributedPurchases: { count: attributed14, scope: "any_show_on_pixel" },
    ticketsSold14: null,
    notRead: reason,
  };
}
