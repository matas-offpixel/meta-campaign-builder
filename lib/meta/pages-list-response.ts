/**
 * lib/meta/pages-list-response.ts
 *
 * Pure helpers for GET /api/meta/pages: per-source failure isolation and
 * the module-level pages-cache write policy used by useFetchPages.
 *
 * Success-path union (owned → client → personal, first-seen dedupe) is
 * unchanged; these helpers only make a swallowed 429 visible so a short
 * list cannot pin `_pagesCache` for the session.
 */

import type { MetaApiPage } from "../types.ts";

export type PagesSourceFetch = {
  pages: MetaApiPage[];
  failed: boolean;
};

export type PagesListPayload = {
  data: MetaApiPage[];
  count: number;
  tokenSource: string;
  sources: {
    business: number;
    client: number;
    personal: number;
    total: number;
  };
  degraded: {
    client: boolean;
    personal: boolean;
  };
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
  source: "client" | "personal",
  load: () => Promise<MetaApiPage[]>,
  log: (message: string) => void,
): Promise<PagesSourceFetch> {
  try {
    return { pages: await load(), failed: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`[/api/meta/pages] ${source} fetch failed: ${message}`);
    return { pages: [], failed: true };
  }
}

/**
 * Assemble the /api/meta/pages JSON body. `data` order is BM-owned, then
 * client, then personal (first-seen wins) — identical to the pre-fix route.
 */
export function buildPagesListPayload(args: {
  businessPages: MetaApiPage[];
  client: PagesSourceFetch;
  personal: PagesSourceFetch;
  tokenSource: string;
}): PagesListPayload {
  const pages = deduplicatePages([
    ...args.businessPages,
    ...args.client.pages,
    ...args.personal.pages,
  ]);
  return {
    data: pages,
    count: pages.length,
    tokenSource: args.tokenSource,
    sources: {
      business: args.businessPages.length,
      client: args.client.pages.length,
      personal: args.personal.pages.length,
      total: pages.length,
    },
    degraded: {
      client: args.client.failed,
      personal: args.personal.failed,
    },
  };
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

/** refetch() bypass: drop the key so the next apply is not biased by stale short data. */
export function bypassPagesCache(cache: Map<string, MetaApiPage[]>, key: string): void {
  cache.delete(key);
}
