/**
 * The one way to read a table in pages.
 *
 * PostgREST caps a SELECT at 1,000 rows, so whole tables are read with
 * `.range`. Without an ORDER BY, Postgres may hand the pages back in any
 * order: a row lands on two pages and another on none. Measured on prod
 * on 13 Nov 2026: the client ticket-sales spend read got 2,233 rows with
 * 1,705 distinct — 528 doubled, 528 missing — moving up to £2,192 of
 * spend between Electric Brixton's events. So every page is ordered by a
 * key that is unique on the table (its primary key, or a column set
 * unique together), the key is the final tie-breaker under any business
 * order, and the rows are deduped on it, so a page overlap can never
 * double a row.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type Db = Pick<SupabaseClient, "from">;

export type PagedQuery = {
  not(column: string, operator: string, value: unknown): PagedQuery;
  is(column: string, value: unknown): PagedQuery;
  eq(column: string, value: unknown): PagedQuery;
  gt(column: string, value: unknown): PagedQuery;
  gte(column: string, value: unknown): PagedQuery;
  lte(column: string, value: unknown): PagedQuery;
  in(column: string, values: readonly unknown[]): PagedQuery;
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }): PagedQuery;
  range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};

export type PageResult = { data: unknown[] | null; error: { message: string } | null };

export type OrderBy = { column: string; ascending: boolean; nullsFirst?: boolean };

export const PAGE_SIZE = 1000;

/** The dedupe key of a row, or null when the row does not carry every key column (a fixture, or a view that drops it). */
function keyOf(row: object, keys: readonly string[]): string | null {
  const parts: string[] = [];
  for (const column of keys) {
    const value = (row as Record<string, unknown>)[column];
    if (value === undefined) return null;
    parts.push(String(value ?? ""));
  }
  return parts.join("\u0000");
}

/** Rows deduped on `keys`, first sighting wins; a row without the key is kept. */
export function dedupeOn<T extends object>(rows: readonly T[], keys: readonly string[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = keyOf(row, keys);
    if (key != null) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(row);
  }
  return out;
}

/**
 * Page through `build(from, to)` until a short page, deduping on `keys`.
 * The builder orders the query itself (business order first, then every
 * key as the tie-breaker). For loops that need per-page work, call
 * `dedupeOn` yourself with one `seen` set across pages.
 */
export async function pageAll<T extends object>(
  build: (from: number, to: number) => PromiseLike<PageResult>,
  keys: readonly string[],
  label: string,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const chunk = (data ?? []) as T[];
    for (const row of chunk) {
      const key = keyOf(row, keys);
      if (key != null) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      rows.push(row);
    }
    if (chunk.length < pageSize) break;
  }
  return rows;
}

/**
 * Every row of `table`, ordered by `opts.orderBy` (business order, if
 * any) then by `keys` ascending, deduped on `keys`. `keys` must be in
 * `columns`: the guard reads them off each row. Throws on a page error.
 */
export async function loadAllPaged<T extends object>(
  db: Db,
  table: string,
  columns: string,
  keys: readonly string[],
  filter?: (q: PagedQuery) => PagedQuery,
  opts: { orderBy?: readonly OrderBy[]; pageSize?: number } = {},
): Promise<T[]> {
  if (!keys.length) throw new Error(`${table}: a paged read needs a unique key to order by`);
  const selected = new Set(columns.split(",").map((column) => column.trim().split(":")[0]!.trim()));
  for (const key of keys) if (!selected.has(key)) throw new Error(`${table}: order key "${key}" is not in the selected columns`);
  return pageAll<T>(
    (from, to) => {
      let query = db.from(table).select(columns) as unknown as PagedQuery;
      if (filter) query = filter(query);
      for (const order of opts.orderBy ?? []) query = query.order(order.column, { ascending: order.ascending, nullsFirst: order.nullsFirst });
      for (const key of keys) query = query.order(key, { ascending: true });
      return query.range(from, to);
    },
    keys,
    table,
    opts.pageSize ?? PAGE_SIZE,
  );
}
