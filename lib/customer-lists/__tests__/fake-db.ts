/**
 * A small in-memory stand-in for the Supabase query builder: enough of
 * select / insert / update / upsert / delete with eq, in, order, limit,
 * range and maybeSingle for the signup sync and the Meta write ledger.
 * Every write is recorded in `writes` so a test can scan it for hashes.
 */

import type { Db } from "../sync.ts";

type Row = Record<string, unknown>;
type Filter = { col: string; op: "eq" | "in" | "is"; value: unknown };

export type FakeDb = {
  tables: Record<string, Row[]>;
  writes: { table: string; op: string; payload: unknown }[];
  /** Make the next writes to a table fail with this error. */
  failWrites: Record<string, { code?: string; message: string } | undefined>;
  /** Typed as Supabase's builder so a FakeDb passes where the sync takes a Db. */
  from(table: string): ReturnType<Db["from"]>;
};

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private filters: Filter[] = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private lim: number | null = null;
  private rng: [number, number] | null = null;
  private single = false;
  private conflict: string[] = [];
  private returning = false;

  private db: FakeDb;
  private table: string;

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }

  select(cols?: string) {
    void cols;
    if (this.op !== "select") this.returning = true;
    return this;
  }
  insert(payload: Row | Row[]) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  upsert(payload: Row, opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = payload;
    this.conflict = (opts?.onConflict ?? "id").split(",").map((s) => s.trim());
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push({ col, op: "eq", value });
    return this;
  }
  in(col: string, value: unknown[]) {
    this.filters.push({ col, op: "in", value });
    return this;
  }
  is(col: string, value: unknown) {
    this.filters.push({ col, op: "is", value });
    return this;
  }
  neq(col: string, value: unknown) {
    this.filters.push({ col, op: "eq", value: { not: value } });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  range(from: number, to: number) {
    this.rng = [from, to];
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  private match(row: Row): boolean {
    return this.filters.every((f) => {
      if (f.op === "in") return (f.value as unknown[]).includes(row[f.col]);
      if (f.op === "is") return (row[f.col] ?? null) === f.value;
      if (f.value && typeof f.value === "object" && "not" in (f.value as Row)) return row[f.col] !== (f.value as Row).not;
      return row[f.col] === f.value;
    });
  }

  private run(): { data: unknown; error: unknown } {
    const rows = (this.db.tables[this.table] ??= []);
    if (this.op !== "select") {
      const fail = this.db.failWrites[this.table];
      this.db.writes.push({ table: this.table, op: this.op, payload: this.payload });
      if (fail) return { data: null, error: fail };
    }
    if (this.op === "select") {
      let out = rows.filter((r) => this.match(r));
      if (this.orderBy) {
        const { col, asc } = this.orderBy;
        out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? (asc ? -1 : 1) : String(a[col]) > String(b[col]) ? (asc ? 1 : -1) : 0));
      }
      if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim != null) out = out.slice(0, this.lim);
      return { data: this.single ? (out[0] ?? null) : out.map((r) => ({ ...r })), error: null };
    }
    if (this.op === "insert") {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((p) => ({ id: `${this.table}_${rows.length + 1}`, ...p }));
      rows.push(...list);
      return { data: this.single ? list[0] : list, error: null };
    }
    if (this.op === "update") {
      const hit = rows.filter((r) => this.match(r));
      for (const r of hit) Object.assign(r, this.payload);
      return { data: hit, error: null };
    }
    if (this.op === "upsert") {
      const p = this.payload as Row;
      let row = rows.find((r) => this.conflict.every((c) => r[c] === p[c]));
      if (row) Object.assign(row, p);
      else {
        row = { id: `${this.table}_${rows.length + 1}`, op_result_id: null, ...p };
        rows.push(row);
      }
      return { data: this.single || this.returning ? { id: row.id } : [row], error: null };
    }
    const keep = rows.filter((r) => !this.match(r));
    this.db.tables[this.table] = keep;
    return { data: null, error: null };
  }

  then<A = { data: unknown; error: unknown }, B = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

export function fakeDb(tables: Record<string, Row[]> = {}): FakeDb {
  const db: FakeDb = {
    tables,
    writes: [],
    failWrites: {},
    from(table: string) {
      return new Query(db, table) as unknown as ReturnType<Db["from"]>;
    },
  };
  return db;
}
