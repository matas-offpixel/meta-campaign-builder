/**
 * An in-memory Supabase stand-in for the refresh's P2 tests: tables of
 * plain rows, the filters the code uses (eq, neq, in, is, not is null,
 * gte, lte), order, range, maybeSingle / single, insert, upsert on a
 * conflict key, update and delete (each returning rows with .select()).
 * An `x!inner(col)` embed in a select attaches the parent row by its
 * `{x without the s}_id`-style key given in `embeds`; filters on
 * `x.col` read it. JSON-path aliases in a select are ignored: rows are
 * stored already flat.
 */

type Row = Record<string, unknown>;
type Filter = { col: string; op: "eq" | "neq" | "in" | "is" | "notis" | "gte" | "lte"; val: unknown };

export type MemoryDb = {
  db: never;
  tables: Record<string, Row[]>;
  /** Every write, in order: [table, op, payload]. */
  writes: [string, string, unknown][];
  /** Make the next matching call fail: (table, op) → error message. */
  failOn: (table: string, op: string, message: string) => void;
};

let ids = 0;

export function memoryDb(seed: Record<string, Row[]>, embeds: Record<string, { table: string; key: string }> = {}): MemoryDb {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }));
  const writes: [string, string, unknown][] = [];
  const failures: { table: string; op: string; message: string }[] = [];

  function from(table: string) {
    tables[table] ??= [];
    const state: { op: string; payload: unknown; filters: Filter[]; orders: [string, boolean][]; range: [number, number] | null; single: "maybe" | "one" | null; selected: boolean; conflict: string[] | null; limit: number | null; embed: string | null } = {
      op: "select",
      payload: null,
      filters: [],
      orders: [],
      range: null,
      single: null,
      selected: false,
      conflict: null,
      limit: null,
      embed: null,
    };
    const value = (row: Row, col: string): unknown => {
      if (col.includes(".")) {
        const [parent, field] = col.split(".") as [string, string];
        const joined = joinOf(row, parent);
        return joined ? joined[field] : undefined;
      }
      return row[col];
    };
    const joinOf = (row: Row, parent: string): Row | null => {
      const spec = embeds[parent];
      if (!spec) return null;
      return (tables[spec.table] ?? []).find((candidate) => candidate.id === row[spec.key]) ?? null;
    };
    const matches = (row: Row) =>
      state.filters.every((filter) => {
        const v = value(row, filter.col);
        switch (filter.op) {
          case "eq":
            return v === filter.val;
          case "neq":
            return v !== filter.val;
          case "in":
            return (filter.val as unknown[]).includes(v);
          case "is":
            return (v ?? null) === filter.val;
          case "notis":
            return (v ?? null) !== filter.val;
          case "gte":
            return String(v) >= String(filter.val);
          case "lte":
            return String(v) <= String(filter.val);
        }
        return true;
      });
    const shape = (row: Row): Row => (state.embed ? { ...row, [state.embed]: joinOf(row, state.embed) } : { ...row });
    const run = (): { data: unknown; error: { message: string; code?: string } | null } => {
      const failure = failures.findIndex((entry) => entry.table === table && entry.op === state.op);
      if (failure >= 0) {
        const [entry] = failures.splice(failure, 1);
        return { data: null, error: { message: entry!.message } };
      }
      const rows = tables[table]!;
      let out: Row[] = [];
      if (state.op === "select") {
        out = rows.filter(matches).map(shape);
      } else if (state.op === "insert") {
        const list = (Array.isArray(state.payload) ? state.payload : [state.payload]) as Row[];
        for (const item of list) {
          const row = { id: `m${++ids}`, ...item };
          rows.push(row);
          out.push({ ...row });
        }
        writes.push([table, "insert", state.payload]);
      } else if (state.op === "upsert") {
        const keys = state.conflict ?? ["id"];
        const items = Array.isArray(state.payload) ? (state.payload as Row[]) : [state.payload as Row];
        for (const item of items) {
          const have = rows.find((row) => keys.every((key) => row[key] === item[key]));
          if (have) {
            Object.assign(have, item);
            out.push({ ...have });
          } else {
            const row = { id: `m${++ids}`, ...item };
            rows.push(row);
            out.push({ ...row });
          }
          writes.push([table, "upsert", item]);
        }
      } else if (state.op === "update") {
        for (const row of rows.filter(matches)) {
          Object.assign(row, state.payload as Row);
          out.push({ ...row });
        }
        writes.push([table, "update", state.payload]);
      } else if (state.op === "delete") {
        const keep = rows.filter((row) => !matches(row));
        out = rows.filter(matches).map((row) => ({ ...row }));
        tables[table] = keep;
        writes.push([table, "delete", state.filters]);
      }
      for (const [col, ascending] of [...state.orders].reverse()) out.sort((a, b) => (String(a[col] ?? "") < String(b[col] ?? "") ? -1 : String(a[col] ?? "") > String(b[col] ?? "") ? 1 : 0) * (ascending ? 1 : -1));
      if (state.range) out = out.slice(state.range[0], state.range[1] + 1);
      if (state.limit != null) out = out.slice(0, state.limit);
      if (state.single === "maybe") return { data: out[0] ?? null, error: null };
      if (state.single === "one") return out[0] ? { data: out[0], error: null } : { data: null, error: { message: "no row", code: "PGRST116" } };
      if (state.op !== "select" && !state.selected) return { data: null, error: null };
      return { data: out, error: null };
    };
    const chain: Record<string, unknown> = {
      select(columns?: string) {
        if (state.op === "select") {
          const embed = /(\w+)!inner\(/.exec(columns ?? "");
          state.embed = embed ? embed[1]! : null;
        } else {
          state.selected = true;
        }
        return chain;
      },
      insert(payload: unknown) {
        state.op = "insert";
        state.payload = payload;
        return chain;
      },
      upsert(payload: unknown, opts?: { onConflict?: string }) {
        state.op = "upsert";
        state.payload = payload;
        state.conflict = opts?.onConflict ? opts.onConflict.split(",").map((key) => key.trim()) : null;
        return chain;
      },
      update(payload: unknown) {
        state.op = "update";
        state.payload = payload;
        return chain;
      },
      delete() {
        state.op = "delete";
        return chain;
      },
      eq(col: string, val: unknown) {
        state.filters.push({ col, op: "eq", val });
        return chain;
      },
      neq(col: string, val: unknown) {
        state.filters.push({ col, op: "neq", val });
        return chain;
      },
      in(col: string, val: unknown[]) {
        state.filters.push({ col, op: "in", val });
        return chain;
      },
      is(col: string, val: unknown) {
        state.filters.push({ col, op: "is", val });
        return chain;
      },
      not(col: string, _op: string, val: unknown) {
        state.filters.push({ col, op: "notis", val });
        return chain;
      },
      gte(col: string, val: unknown) {
        state.filters.push({ col, op: "gte", val });
        return chain;
      },
      lte(col: string, val: unknown) {
        state.filters.push({ col, op: "lte", val });
        return chain;
      },
      like() {
        return chain;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        state.orders.push([col, opts?.ascending !== false]);
        return chain;
      },
      range(a: number, b: number) {
        state.range = [a, b];
        return chain;
      },
      limit(n: number) {
        state.limit = n;
        return chain;
      },
      maybeSingle() {
        state.single = "maybe";
        return chain;
      },
      single() {
        state.single = "one";
        return chain;
      },
      then(ok: (value: unknown) => unknown, bad: (err: unknown) => unknown) {
        return Promise.resolve().then(run).then(ok, bad);
      },
    };
    return chain;
  }

  return {
    db: { from } as never,
    tables,
    writes,
    failOn: (table, op, message) => failures.push({ table, op, message }),
  };
}
