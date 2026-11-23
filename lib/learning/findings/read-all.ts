/**
 * The findings loaders' paged reader. PostgREST caps a SELECT at 1,000 rows, so
 * every read pages by 1,000 in a unique order and dedupes on it
 * (lib/db/paged-read.ts's rule). Relative imports only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type Db = Pick<SupabaseClient, "from">;
export type Row = Record<string, unknown>;

export type Filter = (q: FilterQuery) => FilterQuery;
export type FilterQuery = {
  eq(c: string, v: unknown): FilterQuery;
  in(c: string, v: readonly unknown[]): FilterQuery;
  ilike(c: string, v: string): FilterQuery;
  not(c: string, op: string, v: unknown): FilterQuery;
  gte(c: string, v: string): FilterQuery;
  lte(c: string, v: string): FilterQuery;
  order(c: string, o: { ascending: boolean }): FilterQuery;
  range(a: number, b: number): PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null }>;
};

/** Every row, paged by 1,000 in a unique order and deduped on it (the PostgREST cap; lib/db/paged-read.ts's rule). */
export async function all(db: Db, table: string, columns: string, filter: Filter, order: readonly string[]): Promise<Row[]> {
  const out: Row[] = [];
  const seen = new Set<string>();
  for (let from = 0; ; from += 1000) {
    let q = filter(db.from(table).select(columns) as unknown as FilterQuery);
    for (const column of order) q = q.order(column, { ascending: true });
    const res = await q.range(from, from + 999);
    if (res.error) throw new Error(`${table}: ${res.error.message}`);
    const page = (res.data ?? []) as Row[];
    for (const row of page) {
      const key = order.map((c) => String(row[c] ?? "")).join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    if (page.length < 1000) return out;
  }
}

export const str = (row: Row | null | undefined, key: string): string => String(row?.[key] ?? "").trim();
export const chunks = <T>(xs: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
