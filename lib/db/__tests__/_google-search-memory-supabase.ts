/**
 * Tiny in-memory Supabase shim used by the Phase 3.5 save-fix tests.
 * Supports only the chain shapes that `saveGoogleSearchPlanTree` (in
 * `lib/db/google-search-plans.ts`) uses. NOT a full Supabase mock —
 * adding tables / chains beyond what's used here will silently noop.
 *
 * Recorded operations live on `store.ops` so tests can assert that
 * the diff-aware save:
 *   - never writes `pushed_resource_name` in an update payload
 *   - never writes `status` / `pushed_at` on the plan update
 *   - deletes only the rows it should
 *   - inserts only the rows it should
 *
 * Tables modelled (subset of migration 096): google_search_plans,
 * google_search_campaigns, google_search_ad_groups,
 * google_search_keywords, google_search_rsas,
 * google_search_negatives.
 *
 * Fake UUIDs use the prefix `db-` and a counter so test assertions can
 * tell tmp-…  → db-… apart without depending on real UUID format.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface RecordedOp {
  table: string;
  op: "update" | "insert" | "delete" | "select";
  payload?: unknown;
  filter?: { col: string; val: unknown; mode: "eq" | "in" };
}

interface Row extends Record<string, unknown> {
  id: string;
}

export class MemorySupabase {
  readonly tables = new Map<string, Row[]>();
  readonly ops: RecordedOp[] = [];
  private seq = 1;

  constructor(initial: Record<string, Row[]> = {}) {
    for (const [name, rows] of Object.entries(initial)) {
      this.tables.set(name, rows.map((r) => ({ ...r })));
    }
  }

  /** Used by tests to assert state after save. */
  rows<T extends Row = Row>(table: string): T[] {
    return (this.tables.get(table) ?? []) as T[];
  }

  row<T extends Row = Row>(table: string, id: string): T | undefined {
    return this.rows<T>(table).find((r) => r.id === id);
  }

  private nextId(): string {
    return `db-${this.seq++}`;
  }

  from(table: string): TableBuilder {
    return new TableBuilder(this, table);
  }

  /** Cast helper: hands back the shim under the Supabase type. */
  asSupabase(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }

  // ── internal mutators ─────────────────────────────────────────────

  _select(
    table: string,
    filter?: RecordedOp["filter"],
  ): Row[] {
    this.ops.push({ table, op: "select", filter });
    const rows = this.tables.get(table) ?? [];
    if (!filter) return rows;
    if (filter.mode === "eq") {
      return rows.filter((r) => r[filter.col] === filter.val);
    }
    const set = new Set(filter.val as unknown[]);
    return rows.filter((r) => set.has(r[filter.col]));
  }

  _update(
    table: string,
    payload: Record<string, unknown>,
    filter: RecordedOp["filter"],
  ): { error: null | { message: string } } {
    this.ops.push({ table, op: "update", payload, filter });
    if (!filter) return { error: { message: "update requires a filter" } };
    const rows = this.tables.get(table) ?? [];
    const targets =
      filter.mode === "eq"
        ? rows.filter((r) => r[filter.col] === filter.val)
        : rows.filter((r) => (filter.val as unknown[]).includes(r[filter.col]));
    for (const row of targets) {
      Object.assign(row, payload);
    }
    return { error: null };
  }

  _insert(
    table: string,
    payload: Record<string, unknown> | Array<Record<string, unknown>>,
  ): { rows: Row[]; error: null | { message: string } } {
    this.ops.push({ table, op: "insert", payload });
    const inserted: Row[] = [];
    const rowsIn: Array<Record<string, unknown>> = Array.isArray(payload) ? payload : [payload];
    for (const r of rowsIn) {
      const row: Row = { id: this.nextId(), ...r } as Row;
      inserted.push(row);
      const bucket = this.tables.get(table) ?? [];
      bucket.push(row);
      this.tables.set(table, bucket);
    }
    return { rows: inserted, error: null };
  }

  _delete(
    table: string,
    filter: RecordedOp["filter"],
  ): { error: null | { message: string } } {
    this.ops.push({ table, op: "delete", filter });
    if (!filter) return { error: { message: "delete requires a filter" } };
    const rows = this.tables.get(table) ?? [];
    const keep =
      filter.mode === "eq"
        ? rows.filter((r) => r[filter.col] !== filter.val)
        : rows.filter((r) => !(filter.val as unknown[]).includes(r[filter.col]));

    // Cascade — mirrors the schema FKs (ON DELETE CASCADE).
    const removed = rows.filter((r) => !keep.includes(r));
    this.tables.set(table, keep);
    this.cascadeDelete(table, removed);
    return { error: null };
  }

  private cascadeDelete(table: string, removed: Row[]): void {
    if (removed.length === 0) return;
    const ids = removed.map((r) => r.id);
    if (table === "google_search_campaigns") {
      this._delete("google_search_ad_groups", { col: "campaign_id", val: ids, mode: "in" });
      this._delete("google_search_negatives", { col: "campaign_id", val: ids, mode: "in" });
    } else if (table === "google_search_ad_groups") {
      this._delete("google_search_keywords", { col: "ad_group_id", val: ids, mode: "in" });
      this._delete("google_search_rsas", { col: "ad_group_id", val: ids, mode: "in" });
    } else if (table === "google_search_plans") {
      this._delete("google_search_campaigns", { col: "plan_id", val: ids, mode: "in" });
      this._delete("google_search_negatives", { col: "plan_id", val: ids, mode: "in" });
      this._delete("google_search_sitelinks", { col: "plan_id", val: ids, mode: "in" });
    }
  }
}

// ─── Chain builders ──────────────────────────────────────────────────

class TableBuilder {
  private store: MemorySupabase;
  private table: string;

  constructor(store: MemorySupabase, table: string) {
    this.store = store;
    this.table = table;
  }

  select(_cols: string): SelectBuilder {
    return new SelectBuilder(this.store, this.table);
  }

  insert(payload: Record<string, unknown> | Array<Record<string, unknown>>): InsertBuilder {
    return new InsertBuilder(this.store, this.table, payload);
  }

  update(payload: Record<string, unknown>): UpdateBuilder {
    return new UpdateBuilder(this.store, this.table, payload);
  }

  delete(): DeleteBuilder {
    return new DeleteBuilder(this.store, this.table);
  }
}

type Resolved<T> = Promise<T>;

class SelectBuilder implements PromiseLike<{ data: Row[]; error: null }> {
  private store: MemorySupabase;
  private table: string;
  private filter: RecordedOp["filter"] | undefined = undefined;

  constructor(store: MemorySupabase, table: string) {
    this.store = store;
    this.table = table;
  }

  eq(col: string, val: unknown): this {
    this.filter = { col, val, mode: "eq" };
    return this;
  }

  in(col: string, val: unknown[]): this {
    this.filter = { col, val, mode: "in" };
    return this;
  }

  order(_col: string, _opts?: unknown): this {
    return this;
  }

  limit(_n: number): this {
    return this;
  }

  maybeSingle(): Promise<{ data: Row | null; error: null }> {
    const rows = this.store._select(this.table, this.filter);
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }

  single(): Promise<{ data: Row | null; error: null }> {
    return this.maybeSingle();
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const rows = this.store._select(this.table, this.filter);
    return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected);
  }
}

class InsertBuilder implements PromiseLike<{ data: null; error: null }> {
  private store: MemorySupabase;
  private table: string;
  private payload: Record<string, unknown> | Array<Record<string, unknown>>;

  constructor(
    store: MemorySupabase,
    table: string,
    payload: Record<string, unknown> | Array<Record<string, unknown>>,
  ) {
    this.store = store;
    this.table = table;
    this.payload = payload;
  }

  select(_cols: string): InsertSelectBuilder {
    return new InsertSelectBuilder(this.store, this.table, this.payload);
  }

  then<TResult1 = { data: null; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Resolved<TResult1 | TResult2> {
    const { error } = this.store._insert(this.table, this.payload);
    return Promise.resolve({ data: null, error }).then(
      onfulfilled as never,
      onrejected as never,
    );
  }
}

class InsertSelectBuilder implements PromiseLike<{ data: Row[]; error: null }> {
  private store: MemorySupabase;
  private table: string;
  private payload: Record<string, unknown> | Array<Record<string, unknown>>;

  constructor(
    store: MemorySupabase,
    table: string,
    payload: Record<string, unknown> | Array<Record<string, unknown>>,
  ) {
    this.store = store;
    this.table = table;
    this.payload = payload;
  }

  single(): Promise<{ data: Row | null; error: { message: string } | null }> {
    const { rows, error } = this.store._insert(this.table, this.payload);
    return Promise.resolve({ data: rows[0] ?? null, error });
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Resolved<TResult1 | TResult2> {
    const { rows, error } = this.store._insert(this.table, this.payload);
    return Promise.resolve({ data: rows, error }).then(
      onfulfilled as never,
      onrejected as never,
    );
  }
}

class UpdateBuilder implements PromiseLike<{ data: null; error: null }> {
  private store: MemorySupabase;
  private table: string;
  private payload: Record<string, unknown>;
  private filter: RecordedOp["filter"] | undefined = undefined;

  constructor(store: MemorySupabase, table: string, payload: Record<string, unknown>) {
    this.store = store;
    this.table = table;
    this.payload = payload;
  }

  eq(col: string, val: unknown): this {
    this.filter = { col, val, mode: "eq" };
    return this;
  }

  in(col: string, val: unknown[]): this {
    this.filter = { col, val, mode: "in" };
    return this;
  }

  then<TResult1 = { data: null; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Resolved<TResult1 | TResult2> {
    const { error } = this.store._update(this.table, this.payload, this.filter);
    return Promise.resolve({ data: null, error }).then(
      onfulfilled as never,
      onrejected as never,
    );
  }
}

class DeleteBuilder implements PromiseLike<{ data: null; error: null }> {
  private store: MemorySupabase;
  private table: string;
  private filter: RecordedOp["filter"] | undefined = undefined;

  constructor(store: MemorySupabase, table: string) {
    this.store = store;
    this.table = table;
  }

  eq(col: string, val: unknown): this {
    this.filter = { col, val, mode: "eq" };
    return this;
  }

  in(col: string, val: unknown[]): this {
    this.filter = { col, val, mode: "in" };
    return this;
  }

  then<TResult1 = { data: null; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Resolved<TResult1 | TResult2> {
    const { error } = this.store._delete(this.table, this.filter);
    return Promise.resolve({ data: null, error }).then(
      onfulfilled as never,
      onrejected as never,
    );
  }
}
