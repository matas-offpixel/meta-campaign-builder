/**
 * Per-event purchases (E1–E4 of
 * docs/design-record/2026-11-13-per-event-purchases.html), pure: which
 * pixel a show's ads really use, whether the show has a domain of its
 * own, what the pixel counted on it, and the sentence the panel says.
 * No database, no Meta, no HTTP — purchase-read.ts gathers the facts.
 *
 * The count that triggers is the count the Purchase campaign would
 * optimise on: the pixel's purchases on the show's own domain, on the
 * pixel its ad sets carry. The attributed figure (any show on the
 * pixel) is context and is always labelled so.
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
  { host: "dice.fm", name: "DICE" },
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

export type PurchaseState = "not_read" | "no_pixel" | "no_url" | "ticket_site_only" | "no_own_domain" | "shared_domain" | "nothing_reaches" | "under_bar" | "proposed";

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
  /** "Nothing reaches": where the purchases land instead — the show's ticket site, else the host the pixel's purchases mostly come from. */
  landsOn: string | null;
  /** Purchases on the own domain, on the resolved pixel: 14 and 28 days to the window end, and everything Meta returned. */
  onDomain: { d14: number; d28: number; history: number } | null;
  /** Every host on the resolved pixel, the same spans; context only. */
  pixelWide: { d14: number; d28: number; history: number; topHost: string | null } | null;
  /** How far back the domain breakdown reaches (Meta returns 28 days; the record asked for 90). */
  historyDays: number;
  /** C2: the ads' attributed purchases are any show's, never this show's. */
  attributedPurchases: { count: number; scope: "any_show_on_pixel" };
  ticketsSold14: number | null;
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
  config: Pick<PhaseConfig, "ownDomainPurchasesMinIn14Days" | "purchaseHistoryDays">;
};

/** E3: the first state that applies wins. A read that failed is said, never shown as an empty count. */
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
  if (domain.kind === "ticket_site_only") return { ...base, state: "ticket_site_only", ticketSite: domain.ticketSite };
  if (domain.kind === "no_own_domain") return { ...base, state: "no_own_domain" };
  if (domain.kind === "shared_domain") return { ...base, state: "shared_domain" };
  if (domain.kind === "not_read") return { ...base, notRead: domain.reason };
  if (!rows) return { ...base, notRead: input.stats && "error" in input.stats ? `the pixel's purchases couldn't be read: ${input.stats.error}` : "the pixel's purchases weren't read" };

  const onDomain = { d14: countOn(rows, domain.domain, from14, input.windowEnd), d28: countOn(rows, domain.domain, from28, input.windowEnd), history: countOn(rows, domain.domain, null, null) };
  const read = { ...base, onDomain };
  // E2: an own domain that never sees a purchase while the pixel has them isn't "under the bar".
  if (onDomain.history === 0 && base.pixelWide!.history > 0) {
    const landsOn = input.ticketSite ?? ticketSiteOf(base.pixelWide!.topHost) ?? base.pixelWide!.topHost;
    return { ...read, state: "nothing_reaches", landsOn };
  }
  return { ...read, state: onDomain.d14 >= config.ownDomainPurchasesMinIn14Days ? "proposed" : "under_bar" };
}

// ── E3 / F2: the words ───────────────────────────────────────────────────────

export type PurchaseWhy = {
  /** E4's setup lines: the pixel mismatch, then any second pixel. Empty when there is nothing to say. */
  pixel: string[];
  pixelNarrow: string[];
  purchase: string;
  purchaseNarrow: string;
  attributed: string;
  attributedNarrow: string;
  moves: string;
  /** The unlinked note, or the ticketing check in Proposed and Under the bar; null otherwise. */
  ticketing: string | null;
};

const last4 = (id: string) => `…${id.slice(-4)}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const UNLINKED_TICKETING = "No linked ticketing: the pixel's purchases can't be checked against real sales.";
const MOVES_INSIDE = "Budget moves stay inside each campaign.";
const MOVES_ACROSS = "Budget moves can cross campaigns on cost per purchase.";

/** Every sentence of the Objective block's purchase part, at 1280 and 393, from one read (F1, F2). */
export function purchaseWhy(read: PurchaseRead, ticketingLinked: boolean, config: Pick<PhaseConfig, "ownDomainPurchasesMinIn14Days">): PurchaseWhy {
  const bar = config.ownDomainPurchasesMinIn14Days;
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
    case "ticket_site_only":
      purchase = `${not} tickets sell on ${site}, which sells every show, so this show's purchases can't be told apart.`;
      purchaseNarrow = `${no} tickets sell on ${site}.`;
      break;
    case "no_url":
      purchase = `${not} this show has no page or ticket URL set.`;
      purchaseNarrow = `${no} no page or ticket URL.`;
      break;
    case "no_pixel":
      purchase = `${not} none of this show's ad sets optimises on a pixel yet.`;
      purchaseNarrow = `${no} no pixel on its ad sets.`;
      break;
    default:
      purchase = `${not} this show's purchases couldn't be read this run${read.notRead ? ` (${read.notRead})` : ""}.`;
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

  return {
    pixel,
    pixelNarrow,
    purchase,
    purchaseNarrow,
    attributed: `Attributed to these ads: ${plural(attributed, "purchase")} in 14 days, any show on this pixel.`,
    attributedNarrow: `${plural(attributed, "attributed purchase")} in 14 days, any show.`,
    moves: read.state === "proposed" ? MOVES_ACROSS : MOVES_INSIDE,
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
    attributedPurchases: { count: attributed14, scope: "any_show_on_pixel" },
    ticketsSold14: null,
    notRead: reason,
  };
}
