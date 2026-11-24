/**
 * E9's store (migration 265): the only module that names ad_library_pages and
 * ad_library_ads. Both tables are service role only, and the data is
 * operator-only cross-client knowledge (OP10). Share links and
 * /admin/[clientSlug] never read it (lib/learning/__tests__/cross-client-guard.test.ts).
 *
 * Reads page by 1,000 (the PostgREST cap) and look ads up by id in chunks of
 * 150 (the URL limit, lib/ad-daily-insights/id-lookup.ts). This module never
 * creates a table: when 265 isn't applied, tablesMissing says so and the
 * script refuses to write.
 *
 * Relative imports only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PageKind, PageRow, StoredAd } from "./ingest.ts";

export const AD_LIBRARY_PAGES = "ad_library_pages";
export const AD_LIBRARY_ADS = "ad_library_ads";

export type Db = Pick<SupabaseClient, "from">;

const PAGE = 1000;
const LOOKUP = 150;
const WRITE = 200;

type DbError = { message: string; code?: string } | null;

export function isMissingTable(error: DbError): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache|could not find the table/i.test(error.message);
}

/** The 265 tables that aren't there. Empty when the migration is applied. */
export async function tablesMissing(db: Db): Promise<string[]> {
  const missing: string[] = [];
  // A GET, not a HEAD: a HEAD on a missing table comes back with no error body.
  for (const [table, key] of [[AD_LIBRARY_PAGES, "page_id"], [AD_LIBRARY_ADS, "ad_archive_id"]] as const) {
    const { error } = await db.from(table).select(key).limit(1);
    if (isMissingTable(error)) missing.push(table);
    else if (error) throw new Error(`${table}: ${error.message}`);
  }
  return missing;
}

export async function loadPages(db: Db): Promise<Map<string, PageRow>> {
  const pages = new Map<string, PageRow>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(AD_LIBRARY_PAGES)
      .select("page_id, name, kind, derived_from_page_id, active")
      .order("page_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${AD_LIBRARY_PAGES}: ${error.message}`);
    const rows = (data ?? []) as { page_id: string; name: string; kind: PageKind; derived_from_page_id: string | null; active: boolean }[];
    for (const row of rows) pages.set(row.page_id, row);
    if (rows.length < PAGE) return pages;
  }
}

export async function loadStoredAds(db: Db, ids: readonly string[]): Promise<Map<string, StoredAd>> {
  const stored = new Map<string, StoredAd>();
  for (let i = 0; i < ids.length; i += LOOKUP) {
    const chunk = ids.slice(i, i + LOOKUP);
    const { data, error } = await db
      .from(AD_LIBRARY_ADS)
      .select("ad_archive_id, page_id, first_seen, last_seen, start_date, countries, link_url, cta, link_title, snapshot_url, raw")
      .in("ad_archive_id", chunk);
    if (error) throw new Error(`${AD_LIBRARY_ADS}: ${error.message}`);
    for (const row of (data ?? []) as StoredAd[]) stored.set(row.ad_archive_id, { ...row, countries: row.countries ?? [], raw: row.raw ?? {} });
  }
  return stored;
}

async function upsert(db: Db, table: string, rows: readonly Record<string, unknown>[], onConflict: string): Promise<number> {
  const updatedAt = new Date().toISOString();
  let written = 0;
  for (let i = 0; i < rows.length; i += WRITE) {
    const chunk = rows.slice(i, i + WRITE).map((row) => ({ ...row, updated_at: updatedAt }));
    const { error } = await db.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
    written += chunk.length;
  }
  return written;
}

/** Inserts and changed rows only: an unchanged ad is never written, so a rerun is a no-op. */
export function writeAds(db: Db, rows: readonly StoredAd[]): Promise<number> {
  return upsert(db, AD_LIBRARY_ADS, rows, "ad_archive_id");
}

/** Parents first (parseSeed's order), so derived_from_page_id always has its row. */
export function writePages(db: Db, rows: readonly PageRow[]): Promise<number> {
  return upsert(db, AD_LIBRARY_PAGES, rows, "page_id");
}
