/**
 * A small in-memory stand-in for the supabase-js query builder: select with
 * eq / in / not-is-null / gte / lte / gt / is / order / range, thenable,
 * plus upsert, rpc. Records every query, order and upsert so tests can
 * check paging order and what was written.
 */

type Row = Record<string, unknown>;

export type FakeDb = {
  tables: Record<string, Row[]>;
  upserts: { table: string; rows: Row[]; onConflict?: string }[];
  orders: { table: string; columns: string[] }[];
  from(table: string): unknown;
};

export function fakeDb(tables: Record<string, Row[]>, opts: { missing?: string[]; failUpsert?: string } = {}): FakeDb {
  const db: FakeDb = {
    tables,
    upserts: [],
    orders: [],
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      const order: { column: string; ascending: boolean }[] = [];
      let columns = "*";
      const run = (from?: number, to?: number) => {
        if (opts.missing?.includes(table)) return { data: null, error: { message: `relation "public.${table}" does not exist` } };
        let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (order.length) {
          rows = [...rows].sort((a, b) => {
            for (const o of order) {
              const x = String(a[o.column] ?? "");
              const y = String(b[o.column] ?? "");
              if (x !== y) return (x < y ? -1 : 1) * (o.ascending ? 1 : -1);
            }
            return 0;
          });
        }
        if (from != null && to != null) rows = rows.slice(from, to + 1);
        const pick = columns === "*" ? null : columns.split(",").map((c) => c.trim());
        return { data: rows.map((r) => (pick ? Object.fromEntries(pick.map((c) => [c, r[c] ?? null])) : { ...r })), error: null };
      };
      const q = {
        select(cols: string) {
          columns = cols;
          return q;
        },
        eq(c: string, v: unknown) {
          filters.push((r) => r[c] === v);
          return q;
        },
        neq(c: string, v: unknown) {
          filters.push((r) => r[c] !== v);
          return q;
        },
        in(c: string, vs: readonly unknown[]) {
          filters.push((r) => vs.includes(r[c]));
          return q;
        },
        not(c: string, op: string, v: unknown) {
          if (op === "is" && v === null) filters.push((r) => r[c] != null);
          return q;
        },
        is(c: string, v: unknown) {
          filters.push((r) => (r[c] ?? null) === v);
          return q;
        },
        gt(c: string, v: unknown) {
          filters.push((r) => String(r[c]) > String(v));
          return q;
        },
        gte(c: string, v: unknown) {
          filters.push((r) => String(r[c]) >= String(v));
          return q;
        },
        lte(c: string, v: unknown) {
          filters.push((r) => String(r[c]) <= String(v));
          return q;
        },
        or() {
          return q;
        },
        order(column: string, o: { ascending: boolean }) {
          order.push({ column, ascending: o.ascending });
          return q;
        },
        range(from: number, to: number) {
          db.orders.push({ table, columns: order.map((o) => o.column) });
          return Promise.resolve(run(from, to));
        },
        maybeSingle() {
          const r = run();
          return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error });
        },
        then<T>(resolve: (v: ReturnType<typeof run>) => T, reject?: (e: unknown) => unknown) {
          return Promise.resolve(run()).then(resolve, reject);
        },
        upsert(rows: Row[], o?: { onConflict?: string }) {
          db.upserts.push({ table, rows, onConflict: o?.onConflict });
          if (opts.failUpsert === table) return Promise.resolve({ error: { message: "boom" } });
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  };
  return db;
}
