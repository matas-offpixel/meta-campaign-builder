/**
 * lib/event-config/cirqlin.ts
 *
 * The "CIRQLIN page" field's words and the pure parts of linking a page
 * (D9, design's ruling on HD2). The operator pastes a link; the server
 * resolves it with CIRQLIN's GET /api/partner/page and stores the page id
 * with a cached title and slug. The pasted link is never stored.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { CirqlinPageFailure, CirqlinPageLookup, CirqlinPageRef } from "../cirqlin/page.ts";
import type { CachedCirqlinPage } from "./read.ts";

/** Design's ruling, exact (the second round, after cirqlin #625). */
export const CIRQLIN_PAGE_LABEL = "CIRQLIN page";
export const CIRQLIN_PAGE_PLACEHOLDER = "crqln.com/…";
/** 404 no_page: a draft, an unpublished page or an unknown link. Nothing is saved. */
export const CIRQLIN_PAGE_NOT_FOUND = "That link isn't a live CIRQLIN page. Publish it first, or check the link.";
/** 401 / 429 / 500 / a network failure. Nothing is saved and the stored page is kept. */
export const CIRQLIN_PAGE_CHECK_FAILED = "Couldn't check the link with CIRQLIN just now. Try again.";
/** Input that isn't a link. Caught before CIRQLIN is called. */
export const CIRQLIN_PAGE_NOT_A_LINK = "Paste the page's link.";
/** A stored page whose ?id= refresh came back 404: "{stored title} · not live now". */
export const CIRQLIN_PAGE_NOT_LIVE_SUFFIX = "not live now";

/** The shown host: crqln.com even when the page has a custom domain (design wrote it so). */
export const CIRQLIN_LINKS_HOST = "crqln.com";

/** "{page title} · crqln.com/{slug}" under the field; null when the cache has no slug yet. */
export function cirqlinPageLine(page: { title: string | null; slug: string | null } | null): string | null {
  if (!page?.slug) return null;
  const where = `${CIRQLIN_LINKS_HOST}/${page.slug}`;
  return page.title ? `${page.title} · ${where}` : where;
}

/** "{stored title} · not live now", from the cached title (else the crqln.com link). */
export function cirqlinNotLiveLine(page: { title: string | null; slug: string | null }): string {
  const name = page.title || (page.slug ? `${CIRQLIN_LINKS_HOST}/${page.slug}` : "The linked page");
  return `${name} · ${CIRQLIN_PAGE_NOT_LIVE_SUFFIX}`;
}

/** What the field holds when the panel opens: the page's crqln.com link, else empty. */
export function cirqlinFieldValue(page: CachedCirqlinPage | null): string {
  return page?.slug ? `${CIRQLIN_LINKS_HOST}/${page.slug}` : "";
}

export function cirqlinFailureMessage(reason: CirqlinPageFailure): string {
  return reason === "no_page" ? CIRQLIN_PAGE_NOT_FOUND : CIRQLIN_PAGE_CHECK_FAILED;
}

/** The events-row columns for a linked page (from CIRQLIN's answer) or for no page. */
export function cirqlinPageColumns(
  page: CirqlinPageRef | null,
  now: Date,
): { cirqlin_page_id: string | null; cirqlin_page_title: string | null; cirqlin_page_slug: string | null; cirqlin_page_checked_at: string | null } {
  if (!page) return { cirqlin_page_id: null, cirqlin_page_title: null, cirqlin_page_slug: null, cirqlin_page_checked_at: null };
  return { cirqlin_page_id: page.id, cirqlin_page_title: page.title, cirqlin_page_slug: page.slug, cirqlin_page_checked_at: now.toISOString() };
}

/**
 * A pasted link: a host with a dot and an optional path, with or without
 * https://. Not a bare slug, a page title, or text with spaces in it.
 * CIRQLIN decides whether it is a page; this only decides whether to ask.
 */
export function looksLikeLink(text: string): boolean {
  const s = text.trim();
  if (!s || /\s/.test(s)) return false;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  // "mailto:a@b.com" parses as user "mailto", host "b.com".
  if (url.username || url.password) return false;
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname);
}

/**
 * What the save does with the field. `null` (the field wasn't touched) keeps
 * the stored page and calls nothing; blank removes the page; text that isn't
 * a link is refused before CIRQLIN is called; a link is resolved.
 */
export type CirqlinFieldIntent = { kind: "keep" } | { kind: "clear" } | { kind: "not_a_link" } | { kind: "resolve"; url: string };

export function cirqlinFieldIntent(link: string | null | undefined): CirqlinFieldIntent {
  if (link == null) return { kind: "keep" };
  const url = link.trim();
  if (!url) return { kind: "clear" };
  return looksLikeLink(url) ? { kind: "resolve", url } : { kind: "not_a_link" };
}

export type CirqlinFieldOutcome =
  | { ok: true; cirqlin?: { page: CirqlinPageRef | null; now: Date } }
  | { ok: false; error: string; field: "cirqlinPage" };

/**
 * The save's CIRQLIN step, before anything is written. `lookup` is CIRQLIN's
 * GET /api/partner/page (?url=); it is called only for a link.
 */
export async function resolveCirqlinField(
  link: string | null | undefined,
  deps: { lookup: (q: { url: string }) => Promise<CirqlinPageLookup>; now?: () => Date },
): Promise<CirqlinFieldOutcome> {
  const now = deps.now ?? (() => new Date());
  const intent = cirqlinFieldIntent(link);
  if (intent.kind === "keep") return { ok: true };
  if (intent.kind === "clear") return { ok: true, cirqlin: { page: null, now: now() } };
  if (intent.kind === "not_a_link") return { ok: false, error: CIRQLIN_PAGE_NOT_A_LINK, field: "cirqlinPage" };
  const found = await deps.lookup({ url: intent.url });
  if (!found.ok) return { ok: false, error: cirqlinFailureMessage(found.reason), field: "cirqlinPage" };
  return { ok: true, cirqlin: { page: found.page, now: now() } };
}

/** The edit page refreshes the cache at most this often. */
export const CIRQLIN_REFRESH_AFTER_MS = 60 * 60 * 1000;

export function cirqlinCacheIsFresh(page: CachedCirqlinPage, now: Date): boolean {
  if (!page.checkedAt || !page.slug) return false;
  const at = Date.parse(page.checkedAt);
  return Number.isFinite(at) && now.getTime() - at < CIRQLIN_REFRESH_AFTER_MS;
}
