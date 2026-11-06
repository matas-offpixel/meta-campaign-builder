/**
 * In-memory stand-in for the supabase-js query builder: the chain methods
 * lib/creative-lab uses (select, eq, in, not is null, lte, order, limit,
 * range, maybeSingle, single, insert, upsert with onConflict).
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export type FakeDb = {
  from(table: string): unknown;
  tables: Record<string, Row[]>;
  writes: { table: string; op: "insert" | "upsert" | "update"; rows: Row[] }[];
};

export function fakeDb(seed: Record<string, Row[]>): FakeDb {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const writes: FakeDb["writes"] = [];
  let nextId = 1;

  function builder(table: string) {
    const filters: Filter[] = [];
    let order: { column: string; ascending: boolean } | null = null;
    let limit: number | null = null;
    let offset = 0;
    let written: Row[] | null = null;
    let updatePayload: Row | null = null;

    const rows = (): Row[] => {
      if (written) return written;
      let out = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (order) {
        const { column, ascending } = order;
        out = [...out].sort((a, b) => {
          const x = a[column] as string | number;
          const y = b[column] as string | number;
          return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
        });
      }
      out = out.slice(offset);
      return limit == null ? out : out.slice(0, limit);
    };

    const write = (op: "insert" | "upsert", payload: Row | Row[], conflict?: string) => {
      const list = Array.isArray(payload) ? payload : [payload];
      const keys = conflict?.split(",").map((k) => k.trim()) ?? [];
      tables[table] ??= [];
      written = list.map((p) => {
        const existing = keys.length ? tables[table].find((r) => keys.every((k) => r[k] === p[k])) : undefined;
        if (existing) {
          Object.assign(existing, p);
          return existing;
        }
        const row = { ...p };
        if (row.id == null) row.id = `${table}-${nextId++}`;
        tables[table].push(row);
        return row;
      });
      writes.push({ table, op, rows: list });
    };

    const api = {
      select: () => api,
      eq: (column: string, value: unknown) => (filters.push((r) => r[column] === value), api),
      in: (column: string, values: unknown[]) => (filters.push((r) => values.includes(r[column])), api),
      // Only `not(column, "is", null)` is used.
      not: (column: string) => (filters.push((r) => r[column] != null), api),
      lte: (column: string, value: string) => (filters.push((r) => String(r[column]) <= value), api),
      lt: (column: string, value: string) => (filters.push((r) => String(r[column]) < String(value)), api),
      gte: (column: string, value: string) => (filters.push((r) => String(r[column]) >= String(value)), api),
      order: (column: string, options: { ascending: boolean }) => ((order = { column, ascending: options.ascending }), api),
      limit: (n: number) => ((limit = n), api),
      range: (from: number, to: number) => ((offset = from), (limit = to - from + 1), api),
      insert: (payload: Row | Row[]) => (write("insert", payload), api),
      upsert: (payload: Row | Row[], options?: { onConflict?: string }) => (write("upsert", payload, options?.onConflict), api),
      update: (payload: Row) => ((updatePayload = payload), api),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => {
        const first = rows()[0];
        return first ? { data: first, error: null } : { data: null, error: { message: "no rows" } };
      },
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => {
        if (updatePayload) {
          const matched = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          for (const row of matched) Object.assign(row, updatePayload);
          writes.push({ table, op: "update", rows: matched });
          updatePayload = null;
          return resolve({ data: matched, error: null });
        }
        return resolve({ data: rows(), error: null });
      },
    };
    return api;
  }

  return { from: builder, tables, writes };
}
