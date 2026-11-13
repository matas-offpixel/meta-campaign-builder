/**
 * Every whole-table read in the learning loop goes through here.
 *
 * PostgREST caps a SELECT at 1,000 rows, so a table is read in `.range`
 * pages. Without an ORDER BY, Postgres is free to return the pages in
 * any order: a row can appear on two pages and another on none, and the
 * sums built on top are wrong by exactly those rows. So every page is
 * ordered by a key that is unique on the table (its primary key, or a
 * column set unique together) and the rows are deduped on that key, so a
 * page overlap can never double a row.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type Db = Pick<SupabaseClient, "from">;

export type PagedQuery = {
  not(column: string, operator: string, value: unknown): PagedQuery;
  eq(column: string, value: unknown): PagedQuery;
  order(column: string, options: { ascending: boolean }): PagedQuery;
  range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};

export const PAGE_SIZE = 1000;

/**
 * Every row of `table`, `PAGE_SIZE` at a time, ordered by `keys` (unique
 * on the table) and deduped on them. `keys` must be in `columns`: the
 * guard reads them off each row. Throws on a page error.
 */
export async function loadAllPaged<T extends Record<string, unknown>>(
  db: Db,
  table: string,
  columns: string,
  keys: readonly string[],
  filter?: (q: PagedQuery) => PagedQuery,
): Promise<T[]> {
  if (!keys.length) throw new Error(`${table}: a paged read needs a unique key to order by`);
  const selected = new Set(columns.split(",").map((column) => column.trim().split(":")[0]!.trim()));
  for (const key of keys) if (!selected.has(key)) throw new Error(`${table}: order key "${key}" is not in the selected columns`);
  const rows: T[] = [];
  const seen = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = db.from(table).select(columns) as unknown as PagedQuery;
    if (filter) query = filter(query);
    for (const key of keys) query = query.order(key, { ascending: true });
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const chunk = (data ?? []) as T[];
    for (const row of chunk) {
      // A row that does not carry the key (a fixture, or a view that drops it) is kept: the guard can't judge it.
      if (keys.some((column) => row[column] === undefined)) {
        rows.push(row);
        continue;
      }
      const key = keys.map((column) => String(row[column] ?? "")).join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    if (chunk.length < PAGE_SIZE) break;
  }
  return rows;
}
