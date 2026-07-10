/**
 * lib/audiences/page-source-union.ts
 *
 * Pure merge/dedup logic for the FB page source picker. Deliberately has no
 * dependency on the Meta client SDK or Supabase — it only combines plain
 * objects — so it can be unit tested without mocking either.
 *
 * The audience-builder page picker (components/audiences/source-picker.tsx)
 * used to render "No sources found" for pages the operator can actually run
 * ads on but that Meta's live `/me/accounts` + `owned_pages` + `client_pages`
 * query doesn't surface, e.g.:
 *   - Pages shared into a client's Business Manager by a *different* BM
 *     (`bm_pages.is_owned_by_bm = false`), which `/me/accounts` frequently
 *     omits.
 *   - Pages the operator only has Partial (not full) access on.
 *
 * `unionAudiencePageSources` combines the Meta live result with two backfill
 * sources — the BM Asset Sync tool's `bm_pages` table and a client's curated
 * `default_page_ids` allow-list — deduping by page id and preferring the
 * earliest-listed source's metadata for any id that appears more than once.
 */

export interface UnionPageSource {
  id: string;
  name: string;
  slug?: string;
  thumbnailUrl?: string;
  instagramBusinessAccount?: {
    id: string;
    username?: string;
    name?: string;
    thumbnailUrl?: string;
  } | null;
  /** Set on pages that only came from the BM Asset Sync `bm_pages` table (shared/non-owned pages). */
  source?: "bm-shared";
}

/** Minimal shape read from `bm_pages` for a client's Business Manager. */
export interface BMSharedPageInput {
  page_id: string;
  page_name?: string | null;
  category?: string | null;
}

/** A page resolved (or id-only, if Meta metadata lookup failed) from `clients.default_page_ids`. */
export interface DefaultListPageInput {
  id: string;
  name?: string;
}

/**
 * Union three page sources in priority order, deduping by page id:
 *   1. `metaPages`        — the existing live Meta query (owned_pages / client_pages / me/accounts)
 *   2. `bmSharedPages`     — `bm_pages` rows where the operator has confirmed access
 *   3. `defaultListPages`  — the client's curated `default_page_ids` allow-list
 *
 * The first source to mention a page id wins; later duplicates are dropped.
 * Order of the returned array follows the source priority above, matching the
 * order pages were merged in (each source's own internal order is preserved).
 */
export function unionAudiencePageSources(
  metaPages: readonly UnionPageSource[],
  bmSharedPages: readonly BMSharedPageInput[],
  defaultListPages: readonly DefaultListPageInput[],
): UnionPageSource[] {
  const seen = new Set<string>();
  const result: UnionPageSource[] = [];

  for (const page of metaPages) {
    if (!page.id || seen.has(page.id)) continue;
    seen.add(page.id);
    result.push(page);
  }

  for (const page of bmSharedPages) {
    if (!page.page_id || seen.has(page.page_id)) continue;
    seen.add(page.page_id);
    result.push({
      id: page.page_id,
      name: page.page_name?.trim() || page.page_id,
      source: "bm-shared",
    });
  }

  for (const page of defaultListPages) {
    if (!page.id || seen.has(page.id)) continue;
    seen.add(page.id);
    result.push({
      id: page.id,
      name: page.name?.trim() || page.id,
    });
  }

  return result;
}
