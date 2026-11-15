/**
 * The database handle the Drive export uses, typed by the generated schema
 * (lib/db/database.types.ts, migration 218 included), and the three reads it
 * repeats. Reads page by 1,000 (the PostgREST cap).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables } from "../db/database.types.ts";
import { pageAll } from "../db/paged-read.ts";

export type DriveDb = Pick<SupabaseClient<Database>, "from">;
export type TableName = keyof Database["public"]["Tables"];
export type RowOf<T extends TableName> = Tables<T>;

/**
 * supabase-js cannot narrow a builder over a table-name type parameter, so the
 * three generic reads below go through this one shape. Their results are
 * typed by the table they name.
 */
type Reader = {
  select(columns: string): Reader;
  eq(column: string, value: string): Reader;
  order(column: string, options: { ascending: boolean }): Reader;
  range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
  maybeSingle(): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

function reader(db: DriveDb, table: TableName): Reader {
  return db.from(table) as unknown as Reader;
}

const PAGE = 1000;

export async function rowById<T extends TableName>(db: DriveDb, table: T, id: string | null | undefined): Promise<RowOf<T> | null> {
  if (!id) return null;
  const res = await reader(db, table).select("*").eq("id", id).maybeSingle();
  if (res.error) throw new Error(`${table}: ${res.error.message}`);
  return (res.data as RowOf<T> | null) ?? null;
}

export function rowsWhere<T extends TableName>(db: DriveDb, table: T, column: keyof RowOf<T> & string, value: string): Promise<RowOf<T>[]> {
  return pageAll<RowOf<T>>((from, to) => reader(db, table).select("*").eq(column, value).order("id", { ascending: true }).range(from, to), ["id"], table, PAGE);
}

export function allRows<T extends TableName>(db: DriveDb, table: T): Promise<RowOf<T>[]> {
  return pageAll<RowOf<T>>((from, to) => reader(db, table).select("*").order("id", { ascending: true }).range(from, to), ["id"], table, PAGE);
}
