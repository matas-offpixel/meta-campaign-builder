/**
 * An in-memory stand-in for the Supabase query builder: select · eq · in ·
 * order · range · maybeSingle, insert and update. Enough for the tree's
 * reads and the additions log. `detail->>runId` filters read the JSON key.
 */

type Row = Record<string, unknown>;

function get(row: Row, col: string): unknown {
  const arrow = col.indexOf("->>");
  if (arrow < 0) return row[col];
  const base = row[col.slice(0, arrow)] as Row | null | undefined;
  return base ? base[col.slice(arrow + 3)] : undefined;
}

function project(row: Row, cols: string): Row {
  const out: Row = {};
  for (const part of cols.split(",").map((c) => c.trim()).filter(Boolean)) {
    const [alias, path] = part.includes(":") ? part.split(":") : [part, part];
    const json = path!.match(/^(\w+)->>(\w+)$/);
    out[alias!] = json ? ((row[json[1]!] as Row | null | undefined)?.[json[2]!] ?? null) : row[path!];
  }
  return out;
}

export class FakeDb {
  tables: Record<string, Row[]>;
  inserts: Array<{ table: string; row: Row }> = [];
  updates: Array<{ table: string; patch: Row; id: unknown }> = [];

  constructor(tables: Record<string, Row[]>) {
    this.tables = tables;
  }

  from(table: string) {
    const tables = this.tables;
    const inserts = this.inserts;
    const updates = this.updates;
    const rows = () => tables[table] ?? [];
    return {
      select(cols: string) {
        const filters: Array<(r: Row) => boolean> = [];
        const query = {
          eq(col: string, value: unknown) {
            filters.push((r) => get(r, col) === value);
            return query;
          },
          in(col: string, values: unknown[]) {
            filters.push((r) => values.includes(get(r, col)));
            return query;
          },
          order() {
            return query;
          },
          async limit(n: number) {
            return { data: rows().filter((r) => filters.every((f) => f(r))).slice(0, n).map((r) => project(r, cols)), error: null };
          },
          async range(from: number, to: number) {
            const all = rows().filter((r) => filters.every((f) => f(r)));
            return { data: all.slice(from, to + 1).map((r) => project(r, cols)), error: null };
          },
          async maybeSingle() {
            const hit = rows().find((r) => filters.every((f) => f(r)));
            return { data: hit ? project(hit, cols) : null, error: null };
          },
          then(resolve: (v: { data: Row[]; error: null }) => unknown) {
            return Promise.resolve({ data: rows().filter((r) => filters.every((f) => f(r))).map((r) => project(r, cols)), error: null }).then(resolve);
          },
        };
        return query;
      },
      async insert(row: Row) {
        inserts.push({ table, row });
        (tables[table] ??= []).push({ id: `row-${inserts.length}`, created_at: new Date().toISOString(), ...row });
        return { error: null };
      },
      update(patch: Row) {
        return {
          async eq(col: string, value: unknown) {
            updates.push({ table, patch, id: value });
            for (const r of rows()) if (r[col] === value) Object.assign(r, patch);
            return { error: null };
          },
        };
      },
    };
  }
}
