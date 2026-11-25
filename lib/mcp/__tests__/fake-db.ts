/**
 * A small in-memory stand-in for the supabase-js query builder, enough for
 * the MCP readers: select / eq / neq / in / is / not is null / gte / lte /
 * gt / lt / or (simple) / order / range / limit / maybeSingle / single,
 * head counts, and insert / update (recorded). A table not in the map
 * answers PostgREST's missing-table error.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;

export interface FakeDb {
  writes: Array<{ table: string; op: "insert" | "update" | "upsert" | "delete"; rows: unknown }>;
  reads: string[];
}

const cmp = (a: unknown, b: unknown) => (a == null ? -1 : b == null ? 1 : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

function parseOr(expr: string): Pred {
  const parts = expr.split(",").map((p) => {
    const [col, op, ...rest] = p.split(".");
    const val = rest.join(".");
    return (r: Row) => {
      const v = r[col!];
      if (op === "is" && val === "null") return v == null;
      if (op === "gte") return v != null && String(v) >= val;
      if (op === "lte") return v != null && String(v) <= val;
      if (op === "eq") return String(v) === val;
      return false;
    };
  });
  return (r) => parts.some((p) => p(r));
}

export class FakeQuery implements PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }> {
  private preds: Pred[] = [];
  private orders: Array<{ col: string; asc: boolean }> = [];
  private slice: [number, number] | null = null;
  private lim: number | null = null;
  private mode: "many" | "maybe" | "single" = "many";
  private head = false;
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private payload: unknown = null;
  private conflict: string[] = ["id"];

  private readonly db: { tables: Record<string, Row[]>; writes: FakeDb["writes"]; reads: string[] };
  private readonly table: string;

  constructor(db: { tables: Record<string, Row[]>; writes: FakeDb["writes"]; reads: string[] }, table: string) {
    this.db = db;
    this.table = table;
  }

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.head) this.head = true;
    return this;
  }
  insert(rows: unknown) {
    this.op = "insert";
    this.payload = rows;
    return this;
  }
  /** Insert, or merge onto the row with the same `onConflict` columns (comma list). */
  upsert(rows: unknown, opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = rows;
    this.conflict = opts?.onConflict ? opts.onConflict.split(",").map((c) => c.trim()) : ["id"];
    return this;
  }
  update(patch: unknown) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  eq(c: string, v: unknown) {
    this.preds.push((r) => r[c] === v);
    return this;
  }
  neq(c: string, v: unknown) {
    this.preds.push((r) => r[c] !== v);
    return this;
  }
  in(c: string, vs: readonly unknown[]) {
    this.preds.push((r) => vs.includes(r[c]));
    return this;
  }
  is(c: string, v: unknown) {
    this.preds.push((r) => (v === null ? r[c] == null : r[c] === v));
    return this;
  }
  not(c: string, op: string, v: unknown) {
    if (op === "is" && v === null) this.preds.push((r) => r[c] != null);
    return this;
  }
  gte(c: string, v: unknown) {
    this.preds.push((r) => r[c] != null && String(r[c]) >= String(v));
    return this;
  }
  lte(c: string, v: unknown) {
    this.preds.push((r) => r[c] != null && String(r[c]) <= String(v));
    return this;
  }
  gt(c: string, v: unknown) {
    this.preds.push((r) => r[c] != null && String(r[c]) > String(v));
    return this;
  }
  lt(c: string, v: unknown) {
    this.preds.push((r) => r[c] != null && String(r[c]) < String(v));
    return this;
  }
  ilike(c: string, v: string) {
    const re = new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");
    this.preds.push((r) => re.test(String(r[c] ?? "")));
    return this;
  }
  or(expr: string) {
    this.preds.push(parseOr(expr));
    return this;
  }
  order(col: string, o?: { ascending?: boolean }) {
    this.orders.push({ col, asc: o?.ascending ?? true });
    return this;
  }
  range(a: number, b: number) {
    this.slice = [a, b];
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }

  private run(): { data: unknown; error: { message: string } | null; count?: number | null } {
    const rows = this.db.tables[this.table];
    if (!rows) return { data: null, error: { message: `Could not find the table 'public.${this.table}' in the schema cache` } };
    if (this.op === "insert") {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const stamped = list.map((r) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }));
      rows.push(...stamped);
      this.db.writes.push({ table: this.table, op: "insert", rows: list });
      return { data: this.mode === "many" ? stamped : stamped[0] ?? null, error: null };
    }
    if (this.op === "upsert") {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const clean = list.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)));
      const out: Row[] = [];
      for (const r of clean) {
        const hit = rows.find((x) => this.conflict.every((c) => x[c] === r[c]));
        if (hit) {
          Object.assign(hit, r);
          out.push(hit);
        } else {
          const stamped = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r };
          rows.push(stamped);
          out.push(stamped);
        }
      }
      this.db.writes.push({ table: this.table, op: "upsert", rows: clean });
      return { data: this.mode === "many" ? out.map((r) => ({ ...r })) : out[0] ? { ...out[0] } : null, error: null };
    }
    let out = rows.filter((r) => this.preds.every((p) => p(r)));
    if (this.op === "update") {
      for (const r of out) Object.assign(r, this.payload as Row);
      this.db.writes.push({ table: this.table, op: "update", rows: this.payload });
    } else {
      this.db.reads.push(this.table);
    }
    if (this.head) return { data: null, error: null, count: out.length };
    for (const o of [...this.orders].reverse()) out = [...out].sort((a, b) => (o.asc ? cmp(a[o.col], b[o.col]) : -cmp(a[o.col], b[o.col])));
    if (this.slice) out = out.slice(this.slice[0], this.slice[1] + 1);
    if (this.lim != null) out = out.slice(0, this.lim);
    if (this.mode === "maybe") return { data: out[0] ? { ...out[0] } : null, error: null };
    if (this.mode === "single") return out[0] ? { data: { ...out[0] }, error: null } : { data: null, error: { message: "no rows" } };
    return { data: out.map((r) => ({ ...r })), error: null };
  }

  then<A, B>(ok?: ((v: { data: unknown; error: { message: string } | null; count?: number | null }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return Promise.resolve(this.run()).then(ok, bad);
  }
}

export function fakeDb(tables: Record<string, Row[]>): FakeDb & Pick<SupabaseClient, "from"> {
  const state = { tables, writes: [] as FakeDb["writes"], reads: [] as string[] };
  return {
    from: ((t: string) => new FakeQuery(state, t)) as unknown as Pick<SupabaseClient, "from">["from"],
    get writes() {
      return state.writes;
    },
    get reads() {
      return state.reads;
    },
  };
}
