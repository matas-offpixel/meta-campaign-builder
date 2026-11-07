/**
 * PostgREST sends `.in()` in the request URL. A thousand meta ad ids is
 * about 21KB, and Supabase rejects a URL over about 16KB. 150 ids stays
 * under 8KB, including uuids.
 */

const RESERVED = /[,()]/;

export const ID_LOOKUP_BATCH = 150;
export const ID_LOOKUP_URL_LIMIT = 8_000;

export function chunkLookupIds<T>(ids: readonly T[], size = ID_LOOKUP_BATCH): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < ids.length; start += size) out.push(ids.slice(start, start + size));
  return out;
}

/** The URL supabase-js builds for `.from(table).select(select).in(column, ids)`. */
export function lookupInUrl(args: {
  origin: string;
  table: string;
  select: string;
  column: string;
  ids: readonly string[];
}): string {
  const url = new URL(`${args.origin.replace(/\/$/, "")}/rest/v1/${args.table}`);
  url.searchParams.append("select", args.select);
  const values = args.ids.map((id) => (RESERVED.test(id) ? `"${id}"` : id)).join(",");
  url.searchParams.append(args.column, `in.(${values})`);
  return url.toString();
}

export async function selectIn<T>(
  query: (ids: readonly string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  ids: readonly string[],
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (const chunk of chunkLookupIds(ids)) {
    const { data, error } = await query(chunk);
    if (error) return { rows, error: error.message };
    if (data) rows.push(...data);
  }
  return { rows, error: null };
}
