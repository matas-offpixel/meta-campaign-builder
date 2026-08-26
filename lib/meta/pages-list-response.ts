/**
 * lib/meta/pages-list-response.ts
 *
 * Pure helpers for GET /api/meta/pages: per-source failure isolation,
 * cursor exhaustion, and the module-level pages-cache write policy used
 * by useFetchPages.
 *
 * Union order: BM-owned → client → personal → ad-account promote_pages
 * (first-seen dedupe). Promote is last so richer BM/personal records win
 * on overlap; IDs that only exist on promote_pages still appear.
 */

import type { MetaApiPage } from "../types.ts";

export const PAGES_LIST_PAGE_SIZE = 200;
export const PAGES_LIST_MAX_PAGES = 10;
export const PAGES_LIST_PAGINATION_CAP = "PAGES_LIST_PAGINATION_CAP";
export const PAGES_ERROR_TTL_MS = 30_000;
export const PAGES_LOAD_INCOMPLETE_MESSAGE =
  "couldn't load all pages — retry";

export type PagesSourceFetch = {
  pages: MetaApiPage[];
  failed: boolean;
  truncated?: boolean;
};

export type PagesListPayload = {
  data: MetaApiPage[];
  count: number;
  tokenSource: string;
  sources: {
    business: number;
    client: number;
    personal: number;
    promote: number;
    total: number;
  };
  degraded: {
    client: boolean;
    personal: boolean;
    business: boolean;
    promote: boolean;
    truncated: boolean;
  };
  warning?: string;
};

export type GraphPage<T> = {
  data: T[];
  after?: string | null;
  hasNext: boolean;
};

/** Deduplicates pages, preserving first-seen order. */
export function deduplicatePages(pages: MetaApiPage[]): MetaApiPage[] {
  const seen = new Set<string>();
  return pages.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

export async function settlePagesSource(
  source: "business" | "client" | "personal" | "promote",
  load: () => Promise<MetaApiPage[] | { pages: MetaApiPage[]; truncated: boolean }>,
  log: (message: string) => void,
): Promise<PagesSourceFetch> {
  try {
    const result = await load();
    if (Array.isArray(result)) return { pages: result, failed: false };
    return { pages: result.pages, failed: false, truncated: result.truncated };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`[/api/meta/pages] ${source} fetch failed: ${message}`);
    return { pages: [], failed: true };
  }
}

/**
 * Follow Graph cursors until exhaustion or the hard cap.
 * Cap hit is a named warning — never a silent one-page stop.
 */
export async function followCursors<T>(
  fetchPage: (after: string | undefined) => Promise<GraphPage<T>>,
  opts?: {
    maxPages?: number;
    warn?: (code: string, fetchedPages: number) => void;
  },
): Promise<{ items: T[]; truncated: boolean }> {
  const maxPages = opts?.maxPages ?? PAGES_LIST_MAX_PAGES;
  const items: T[] = [];
  let after: string | undefined;
  for (let i = 0; i < maxPages; i += 1) {
    const page = await fetchPage(after);
    items.push(...page.data);
    if (!page.hasNext || !page.after) {
      return { items, truncated: false };
    }
    after = page.after;
  }
  opts?.warn?.(PAGES_LIST_PAGINATION_CAP, maxPages);
  return { items, truncated: true };
}

/**
 * Assemble the /api/meta/pages JSON body. Richer BM/personal rows win on
 * id collision; promote_pages only contributes IDs the other edges missed.
 */
export function buildPagesListPayload(args: {
  businessPages: MetaApiPage[];
  client: PagesSourceFetch;
  personal: PagesSourceFetch;
  tokenSource: string;
  promote?: PagesSourceFetch;
  businessFailed?: boolean;
  businessTruncated?: boolean;
}): PagesListPayload {
  const promote = args.promote ?? { pages: [], failed: false };
  const pages = deduplicatePages([
    ...args.businessPages,
    ...args.client.pages,
    ...args.personal.pages,
    ...promote.pages,
  ]);
  const truncated = Boolean(
    args.client.truncated ||
      args.personal.truncated ||
      promote.truncated ||
      args.businessTruncated,
  );
  const degraded = {
    client: args.client.failed,
    personal: args.personal.failed,
    business: Boolean(args.businessFailed),
    promote: promote.failed,
    truncated,
  };
  const incomplete =
    degraded.client ||
    degraded.personal ||
    degraded.business ||
    degraded.promote ||
    degraded.truncated;
  return {
    data: pages,
    count: pages.length,
    tokenSource: args.tokenSource,
    sources: {
      business: args.businessPages.length,
      client: args.client.pages.length,
      personal: args.personal.pages.length,
      promote: promote.pages.length,
      total: pages.length,
    },
    degraded,
    warning: incomplete
      ? truncated
        ? PAGES_LIST_PAGINATION_CAP
        : PAGES_LOAD_INCOMPLETE_MESSAGE
      : undefined,
  };
}

export function pagesListIsDegraded(payload: PagesListPayload): boolean {
  return (
    payload.degraded.client ||
    payload.degraded.personal ||
    payload.degraded.business ||
    payload.degraded.promote ||
    payload.degraded.truncated
  );
}

export type PagesCacheApplyResult = {
  data: MetaApiPage[];
  degraded: boolean;
  wroteCache: boolean;
};

/**
 * Cache write policy for useFetchPages:
 *   - success → write and serve
 *   - degraded, no (or shorter) cache → serve fresh, do not write
 *   - degraded, cache already holds a longer list → keep serving cache
 */
export function applyPagesResponseToCache(
  cache: Map<string, MetaApiPage[]>,
  key: string,
  incoming: MetaApiPage[],
  degraded: boolean,
): PagesCacheApplyResult {
  if (!degraded) {
    cache.set(key, incoming);
    return { data: incoming, degraded: false, wroteCache: true };
  }
  const cached = cache.get(key);
  if (cached && cached.length > incoming.length) {
    return { data: cached, degraded: true, wroteCache: false };
  }
  return { data: incoming, degraded: true, wroteCache: false };
}

export type PagesErrorEntry = { message: string; expiresAt: number };

export function applyPagesErrorToCache(
  errors: Map<string, PagesErrorEntry>,
  key: string,
  message: string,
  now = Date.now(),
  ttlMs = PAGES_ERROR_TTL_MS,
): PagesErrorEntry {
  const entry = { message, expiresAt: now + ttlMs };
  errors.set(key, entry);
  return entry;
}

export function readPagesError(
  errors: Map<string, PagesErrorEntry>,
  key: string,
  now = Date.now(),
): string | null {
  const entry = errors.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    errors.delete(key);
    return null;
  }
  return entry.message;
}

/** refetch() bypass: drop the key so the next apply is not biased by stale short data. */
export function bypassPagesCache(
  cache: Map<string, MetaApiPage[]>,
  key: string,
  errors?: Map<string, PagesErrorEntry>,
): void {
  cache.delete(key);
  errors?.delete(key);
}
