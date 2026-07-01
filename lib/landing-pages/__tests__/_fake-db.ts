import type {
  LandingPagesDb,
  SelectFilterBuilder,
} from "../context.ts";

/**
 * In-memory LandingPagesDb fake for node:test. Mimics the two behaviours
 * the resolution chain relies on:
 *
 *   - `.eq()` filters compose with AND semantics
 *   - `.select(columns)` projects ONLY the requested columns — so the
 *     isolation test genuinely proves that unselected columns (e.g.
 *     meta_capi_token_encrypted) cannot leak into the returned context.
 */

type Row = Record<string, unknown>;

export function makeFakeDb(tables: Record<string, Row[]>): LandingPagesDb {
  return {
    from(table: string) {
      return {
        select(columns: string): SelectFilterBuilder {
          const wanted = columns.split(",").map((c) => c.trim());
          const filters: Array<[string, unknown]> = [];

          const builder: SelectFilterBuilder = {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return builder;
            },
            then(onFulfilled, onRejected) {
              const rows = (tables[table] ?? [])
                .filter((row) =>
                  filters.every(([column, value]) => row[column] === value),
                )
                .map((row) => {
                  const projected: Row = {};
                  for (const column of wanted) {
                    projected[column] = row[column] ?? null;
                  }
                  return projected;
                });
              return Promise.resolve({ data: rows, error: null }).then(
                onFulfilled,
                onRejected,
              );
            },
          };
          return builder;
        },
      };
    },
  };
}

/** A db whose every query fails — for the error-propagation test. */
export function makeFailingDb(message: string): LandingPagesDb {
  return {
    from() {
      return {
        select(): SelectFilterBuilder {
          const builder: SelectFilterBuilder = {
            eq() {
              return builder;
            },
            then(onFulfilled, onRejected) {
              return Promise.resolve({
                data: null,
                error: { message },
              }).then(onFulfilled, onRejected);
            },
          };
          return builder;
        },
      };
    },
  };
}
