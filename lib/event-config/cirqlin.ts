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

import type { CirqlinPageFailure, CirqlinPageRef } from "../cirqlin/page.ts";
import type { CachedCirqlinPage } from "./read.ts";

/** Design's ruling, exact. */
export const CIRQLIN_PAGE_LABEL = "CIRQLIN page";
export const CIRQLIN_PAGE_PLACEHOLDER = "crqln.com/…";
export const CIRQLIN_PAGE_NOT_FOUND = "That link isn't a CIRQLIN page we can see.";

/**
 * Not in the ruling: the words for a check that didn't happen. Nothing is
 * saved and the stored page is kept. Listed in the PR body for design.
 */
export const CIRQLIN_PAGE_UNAUTHORIZED = "CIRQLIN didn't let us check that link. Nothing was saved.";
export const CIRQLIN_PAGE_RATE_LIMITED = "CIRQLIN has had too many checks in the last few minutes. Try again shortly. Nothing was saved.";
export const CIRQLIN_PAGE_READ_FAILED = "CIRQLIN couldn't check that link just now. Nothing was saved.";

/** The shown host: crqln.com even when the page has a custom domain (design wrote it so). */
export const CIRQLIN_LINKS_HOST = "crqln.com";

/** "{page title} · crqln.com/{slug}" under the field; null when the cache has no slug yet. */
export function cirqlinPageLine(page: { title: string | null; slug: string | null } | null): string | null {
  if (!page?.slug) return null;
  const where = `${CIRQLIN_LINKS_HOST}/${page.slug}`;
  return page.title ? `${page.title} · ${where}` : where;
}

/** What the field holds when the panel opens: the page's crqln.com link, else empty. */
export function cirqlinFieldValue(page: CachedCirqlinPage | null): string {
  return page?.slug ? `${CIRQLIN_LINKS_HOST}/${page.slug}` : "";
}

export function cirqlinFailureMessage(reason: CirqlinPageFailure): string {
  switch (reason) {
    case "no_page":
      return CIRQLIN_PAGE_NOT_FOUND;
    case "unauthorized":
      return CIRQLIN_PAGE_UNAUTHORIZED;
    case "rate_limited":
      return CIRQLIN_PAGE_RATE_LIMITED;
    default:
      return CIRQLIN_PAGE_READ_FAILED;
  }
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
 * What the save does with the field. `null` (the field wasn't touched) keeps
 * the stored page and calls nothing; blank removes the page; anything else
 * is a link to resolve.
 */
export type CirqlinFieldIntent = { kind: "keep" } | { kind: "clear" } | { kind: "resolve"; url: string };

export function cirqlinFieldIntent(link: string | null | undefined): CirqlinFieldIntent {
  if (link == null) return { kind: "keep" };
  const url = link.trim();
  return url ? { kind: "resolve", url } : { kind: "clear" };
}

/** The edit page refreshes the cache at most this often. */
export const CIRQLIN_REFRESH_AFTER_MS = 60 * 60 * 1000;

export function cirqlinCacheIsFresh(page: CachedCirqlinPage, now: Date): boolean {
  if (!page.checkedAt || !page.slug) return false;
  const at = Date.parse(page.checkedAt);
  return Number.isFinite(at) && now.getTime() - at < CIRQLIN_REFRESH_AFTER_MS;
}
