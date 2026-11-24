/**
 * RT13 — the show's own links (docs/design-record/2026-11-17-retargeting-campaign-2.html),
 * with ops' ruling of 17 Nov on what the tier rows say about them.
 *
 *   - Every page's landing_url, and every ticket link on every page, is one
 *     URL rule: "URL contains" the link from its host to the end of its
 *     path, exactly as returned (no scheme or query string, no
 *     case-folding, nothing trimmed).
 *   - Ticket links feed ticket-link visitors and checkout starters (the
 *     pixel's InitiateCheckout on a ticket link's rule, never pixel-wide).
 *     Landing pages feed page visitors and registrations (RT15).
 *   - A ticket link is named by its host (RT18, -3.html): Skiddle,
 *     RA, Fatsoma, Fixr, DICE, Eventbrite, Ticketmaster, See Tickets, else
 *     "Other ({host})". Two links on one platform are told apart by their
 *     shop_name, else their label, in brackets. A landing page is named by
 *     host and path. The link shown first goes first, then the page's order.
 *   - No CIRQLIN tag: RT2's two links, the event's page and its ticket URL,
 *     named the same way.
 *   - Meta's pixel stats give origins only, so the row says, per third-party
 *     platform and a show's own domain, whether the resolved pixel recorded
 *     any event from that host in 28 days. No line for crqln.com or any
 *     landing host another show's pages share.
 *
 * Pure.
 */

import type { PartnerPageLinks } from "../cirqlin/page-links.ts";

export type LinkKind = "ticket" | "landing";

export type ShowLink = {
  kind: LinkKind;
  /** RT13's rule: host to the end of the path, exactly as returned. */
  rule: string;
  host: string;
  /** The tier row's name: the platform (ticket links) or host and path (landing pages). */
  name: string;
  /** CIRQLIN's platform slug; null for a landing page. */
  platform: string | null;
};

/** CIRQLIN's platform slugs (cirqlin#653) as ops named them; anything else is "Other ({host})". */
export const PLATFORM_NAME: Record<string, string> = {
  skiddle: "Skiddle",
  ra: "RA",
  fatsoma: "Fatsoma",
  fixr: "Fixr",
  dice: "DICE",
  eventbrite: "Eventbrite",
  ticketmaster: "Ticketmaster",
  seetickets: "See Tickets",
};

/** Hosts many shows share: no per-host pixel line (ops, 17 Nov). */
export const SHARED_HOSTS: readonly string[] = ["crqln.com", "app.cirqlin.com", "cirqlin.com"];

/** RT18: a ticket link's platform, by its host. */
const HOST_PLATFORM: [RegExp, string][] = [
  [/(^|\.)skiddle\.com$/i, "skiddle"],
  [/(^|\.)ra\.co$/i, "ra"],
  [/(^|\.)residentadvisor\.net$/i, "ra"],
  [/(^|\.)fatsoma\.com$/i, "fatsoma"],
  [/(^|\.)fixr\.co$/i, "fixr"],
  [/(^|\.)dice\.fm$/i, "dice"],
  [/(^|\.)eventbrite\.[a-z.]+$/i, "eventbrite"],
  [/(^|\.)ticketmaster\.[a-z.]+$/i, "ticketmaster"],
  [/(^|\.)seetickets\.com$/i, "seetickets"],
];

/** RT13: "URL contains" from the host to the end of the path, exactly as returned; null when it isn't a URL. */
export function urlRule(url: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)([^?#]*)/i.exec(url.trim());
  if (!match) return null;
  return `${match[1]}${match[2]}`;
}

export function hostOf(url: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url.trim());
  return match ? match[1]!.toLowerCase() : null;
}

export function isSharedHost(host: string): boolean {
  const value = host.toLowerCase().replace(/^www\./, "");
  return SHARED_HOSTS.some((shared) => value === shared || value.endsWith(`.${shared}`));
}

export function platformName(slug: string | null, host: string): string {
  return (slug && PLATFORM_NAME[slug]) || `Other (${host.replace(/^www\./, "")})`;
}

/** The platform slug for a ticket URL's host, else "other". */
export function platformOfHost(host: string): string {
  return HOST_PLATFORM.find(([pattern]) => pattern.test(host))?.[1] ?? "other";
}

/** A landing page's name: host and path, as the rule reads (no trailing slash shown). */
function landingName(rule: string): string {
  return rule.replace(/^www\./, "").replace(/\/$/, "");
}

/** RT13: the show's links from CIRQLIN's pages — landing pages in page order, ticket links shown first then in page order; one per rule. */
export function linksFromPages(pages: readonly PartnerPageLinks[]): ShowLink[] {
  const landing: ShowLink[] = [];
  const tickets: { link: ShowLink; first: boolean; tell: string | null }[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    const rule = urlRule(page.landing_url);
    const host = hostOf(page.landing_url);
    if (rule && host && !seen.has(rule)) {
      seen.add(rule);
      landing.push({ kind: "landing", rule, host, name: landingName(rule), platform: null });
    }
    for (const ticket of page.ticket_links) {
      const ticketRule = urlRule(ticket.url);
      const ticketHost = hostOf(ticket.url);
      if (!ticketRule || !ticketHost || seen.has(ticketRule)) continue;
      seen.add(ticketRule);
      // Named by its host (RT18); CIRQLIN's slug is kept for the record.
      const platform = platformOfHost(ticketHost);
      tickets.push({ link: { kind: "ticket", rule: ticketRule, host: ticketHost, name: platformName(platform, ticketHost), platform }, first: ticket.shown_first, tell: ticket.shop_name?.trim() || ticket.label?.trim() || null });
    }
  }
  // The link shown first goes first; the rest keep the page's order.
  const ordered = [...tickets.filter((row) => row.first), ...tickets.filter((row) => !row.first)];
  // Two links on one platform: told apart by shop_name, else label, in brackets.
  const counts = new Map<string, number>();
  for (const row of ordered) counts.set(row.link.name, (counts.get(row.link.name) ?? 0) + 1);
  const named = ordered.map((row) => (counts.get(row.link.name)! > 1 && row.tell ? { ...row.link, name: `${row.link.name} (${row.tell})` } : row.link));
  return [...named, ...landing];
}

/** RT13: a show with no CIRQLIN tag keeps RT2's two links, named the same way. */
export function linksFallback(event: { ticket_url?: string | null; signup_url?: string | null }): ShowLink[] {
  const out: ShowLink[] = [];
  const ticketRule = event.ticket_url ? urlRule(event.ticket_url) : null;
  const ticketHost = event.ticket_url ? hostOf(event.ticket_url) : null;
  if (ticketRule && ticketHost) {
    const platform = platformOfHost(ticketHost);
    out.push({ kind: "ticket", rule: ticketRule, host: ticketHost, name: platformName(platform, ticketHost), platform });
  }
  const pageRule = event.signup_url ? urlRule(event.signup_url) : null;
  const pageHost = event.signup_url ? hostOf(event.signup_url) : null;
  if (pageRule && pageHost && pageRule !== ticketRule) out.push({ kind: "landing", rule: pageRule, host: pageHost, name: landingName(pageRule), platform: null });
  return out;
}

export const ticketLinks = (links: readonly ShowLink[]) => links.filter((link) => link.kind === "ticket");
export const landingLinks = (links: readonly ShowLink[]) => links.filter((link) => link.kind === "landing");

/**
 * The hosts the pixel recorded events on in 28 days (aggregation=host): `any`
 * is every event (no event filter), the rest per event for RT15 and the
 * empty-Bottom check. Null when not read.
 */
export type PixelHosts = { any: string[]; pageView: string[]; checkout: string[]; registration: string[] } | null;

/** The pixel fired on this host (www. and subdomains of the same site count). */
export function firedOn(hosts: readonly string[] | undefined, host: string): boolean {
  const want = host.toLowerCase().replace(/^www\./, "");
  return (hosts ?? []).some((seen) => {
    const value = seen.toLowerCase().replace(/^www\./, "");
    return value === want || value.endsWith(`.${want}`) || want.endsWith(`.${value}`);
  });
}

const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** RT13: a landing host with no pixel line — crqln.com, or one another show's pages use. */
export function landingShared(host: string, otherShowsHosts: ReadonlySet<string>): boolean {
  return isSharedHost(host) || otherShowsHosts.has(bare(host));
}

/** The landing hosts of every show but this one, for `landingShared`. */
export function otherLandingHosts(byShow: ReadonlyMap<string, readonly ShowLink[]>, showId: string): Set<string> {
  const out = new Set<string>();
  for (const [id, links] of byShow) if (id !== showId) for (const link of landingLinks(links)) out.add(bare(link.host));
  return out;
}

export type PixelEntry = { name: string; on: boolean };

/** RT13: per third-party ticket platform (named by host), the pixel on it yes / no. Null when the hosts weren't read. */
export function pixelOnPlatforms(links: readonly ShowLink[], hosts: PixelHosts): PixelEntry[] | null {
  if (!hosts) return null;
  const seen = new Set<string>();
  const out: PixelEntry[] = [];
  for (const link of ticketLinks(links)) {
    const name = platformName(link.platform ?? platformOfHost(link.host), link.host);
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, on: firedOn(hosts.any, link.host) });
  }
  return out;
}

/** RT13: per own landing domain (not shared), the pixel on it yes / no. Null when the hosts weren't read. */
export function pixelOnOwnDomains(links: readonly ShowLink[], hosts: PixelHosts, otherShowsHosts: ReadonlySet<string>): PixelEntry[] | null {
  if (!hosts) return null;
  const seen = new Set<string>();
  const out: PixelEntry[] = [];
  for (const link of landingLinks(links)) {
    const name = bare(link.host);
    if (landingShared(link.host, otherShowsHosts) || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, on: firedOn(hosts.any, link.host) });
  }
  return out;
}
