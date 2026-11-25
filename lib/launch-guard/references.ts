import type { GuardEvent, VenueDefault } from "./types.ts";

/**
 * Other shows' references (brief R4 §2): code, `event_artists` names,
 * venue, city, signup slug and domain. Never the target event's own, and
 * never a name under 4 characters.
 */

/** Hosts that many shows share: never one show's domain. */
const SHARED_HOSTS = [
  "crqln.com",
  "cirqlin.com",
  "app.cirqlin.com",
  "skiddle.com",
  "universe.com",
  "ticketmaster.co.uk",
  "ticketmaster.com",
  "dice.fm",
  "link.dice.fm",
  "eventbrite.co.uk",
  "eventbrite.com",
  "ra.co",
  "fatsoma.com",
  "seetickets.com",
  "instagram.com",
  "facebook.com",
  "linktr.ee",
];

export type ReferenceKind = "domain" | "slug" | "code" | "artist" | "venue" | "city";

/** Checked in this order; the first hit in a text wins for that show. */
const KIND_ORDER: readonly ReferenceKind[] = ["domain", "slug", "code", "artist", "venue", "city"];

export interface ReferenceTerm {
  kind: ReferenceKind;
  /** As shown in the sentence: "paulvandyk-newcastle.com", "Paul van Dyk". */
  value: string;
  /** The shows it belongs to. A venue or city can belong to several. */
  eventIds: string[];
}

export function parseUrl(raw: string | null | undefined): URL | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
}

export function hostOf(raw: string | null | undefined): string | null {
  const url = parseUrl(raw);
  return url ? url.hostname.toLowerCase().replace(/^www\./, "") : null;
}

function isSharedHost(host: string): boolean {
  return SHARED_HOSTS.some((shared) => host === shared || host.endsWith(`.${shared}`));
}

/** "https://www.Glitterbox-Newcastle.com/?utm=x" → "glitterbox-newcastle.com". */
export function linkKey(raw: string | null | undefined): string | null {
  const url = parseUrl(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  return `${host}${path}`;
}

/** The link as the sentence shows it: no scheme, no www, no trailing slash, no query. */
export function displayLink(raw: string): string {
  return linkKey(raw) ?? raw.trim();
}

/** The show's own domain: its signup URL's host, unless many shows share it. */
export function ownDomain(event: Pick<GuardEvent, "signupUrl">): string | null {
  const host = hostOf(event.signupUrl);
  if (!host || isSharedHost(host)) return null;
  return host;
}

/** The CIRQLIN slug: `crqln.com/l/{slug}`, else the stored page slug. */
export function signupSlug(event: Pick<GuardEvent, "signupUrl" | "cirqlinPageSlug">): string | null {
  const url = parseUrl(event.signupUrl);
  const match = url?.pathname.match(/\/l\/([^/?#]+)/i);
  const slug = (match?.[1] ?? event.cirqlinPageSlug ?? "").trim().toLowerCase();
  return slug || null;
}

function cleanName(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().replace(/\s+/g, " ");
  return value.length >= 4 ? value : null;
}

/** Every term that names this show, own venue included. */
export function termsOfEvent(
  event: GuardEvent,
  venue: VenueDefault | null,
): Array<{ kind: ReferenceKind; value: string }> {
  const out: Array<{ kind: ReferenceKind; value: string }> = [];
  const push = (kind: ReferenceKind, value: string | null) => {
    if (value) out.push({ kind, value });
  };
  push("domain", ownDomain(event));
  push("slug", cleanName(signupSlug(event)));
  push("code", cleanName(event.code));
  for (const artist of event.artists) push("artist", cleanName(artist));
  push("venue", cleanName(event.venueName));
  push("venue", cleanName(venue?.name));
  push("city", cleanName(event.venueCity));
  push("city", cleanName(venue?.city));
  return out;
}

const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Other shows' terms, minus anything the target itself is called (its own
 * artists, venue, city, slug, domain, code). A term two shows share is one
 * term carrying both ids.
 */
export function buildReferenceTerms(
  target: GuardEvent,
  others: readonly GuardEvent[],
  venueOf: (event: GuardEvent) => VenueDefault | null,
): ReferenceTerm[] {
  const own = new Set(termsOfEvent(target, venueOf(target)).map((term) => norm(term.value)));
  // The target's own name ("Glitterbox") is never another show's, even
  // when its lineup isn't stored.
  if (target.name?.trim()) own.add(norm(target.name));
  const byKey = new Map<string, ReferenceTerm>();
  for (const other of others) {
    if (other.id === target.id) continue;
    for (const term of termsOfEvent(other, venueOf(other))) {
      const key = norm(term.value);
      if (own.has(key)) continue;
      const mapKey = `${term.kind}:${key}`;
      const existing = byKey.get(mapKey);
      if (existing) {
        if (!existing.eventIds.includes(other.id)) existing.eventIds.push(other.id);
      } else {
        byKey.set(mapKey, { kind: term.kind, value: term.value, eventIds: [other.id] });
      }
    }
  }
  return [...byKey.values()].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.value.length - a.value.length,
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-word match, case-insensitive. Domains, slugs and codes treat a
 * hyphen as part of the word ("glitterbox-bristol" never matches inside
 * "glitterbox-bristol-2"); names treat it as a break.
 */
export function textHasTerm(text: string, term: Pick<ReferenceTerm, "kind" | "value">): boolean {
  if (!text) return false;
  const tight = term.kind === "domain" || term.kind === "slug" || term.kind === "code";
  const edge = tight ? "[^\\p{L}\\p{N}-]" : "[^\\p{L}\\p{N}]";
  const pattern = new RegExp(`(^|${edge})${escapeRegex(term.value.trim())}(?=${edge}|$)`, "iu");
  return pattern.test(text);
}
