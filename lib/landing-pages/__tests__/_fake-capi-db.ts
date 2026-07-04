import type { SignupSelectBuilder } from "../signup-store.ts";
import { makeFakeSignupDb, type FakeSignupDb } from "./_fake-signup-db.ts";

/**
 * Extends the PR-2 fake SignupDb with the PR-3 CAPI surface:
 *
 *   - `client_landing_pages` selects (meta_test_event_code lookup)
 *   - `rpc("get_landing_page_capi_token")` — mirrors migration 135's
 *     accessor: returns the decrypted token when the stored blob matches
 *     the caller's key ("enc:{key}:{plaintext}", same reversible stub as
 *     the encrypt fake), null when no row/blob, error on short keys.
 *
 * Tokens are keyed strictly by client_id — the fake enforces the same
 * lookup shape prod does, so a wrong-client-id bug in the send path shows
 * up as a missing token, not silent success.
 */

export interface FakeCapiClientRow {
  client_id: string;
  /** Stored in the reversible stub form `enc:{key}:{plaintext}` or null. */
  capi_token_encrypted: string | null;
  meta_test_event_code: string | null;
}

export function makeFakeCapiDb(
  capiRows: FakeCapiClientRow[],
  seed: Record<string, unknown>[] = [],
): FakeSignupDb {
  const inner = makeFakeSignupDb(seed);

  return {
    ...inner,
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "get_landing_page_capi_token") {
        const key = args.p_key as string;
        if (!key || key.length < 8) {
          return Promise.resolve({
            data: null,
            error: {
              message:
                "LANDING_PAGES_TOKEN_KEY must be set and at least 8 characters",
            },
          });
        }
        const row = capiRows.find((r) => r.client_id === args.p_client_id);
        if (!row || row.capi_token_encrypted == null) {
          return Promise.resolve({ data: null, error: null });
        }
        const prefix = `enc:${key}:`;
        if (!row.capi_token_encrypted.startsWith(prefix)) {
          return Promise.resolve({
            data: null,
            error: { message: "Wrong key or corrupt data" },
          });
        }
        return Promise.resolve({
          data: row.capi_token_encrypted.slice(prefix.length),
          error: null,
        });
      }
      return inner.rpc(fn, args);
    },
    from(table: string) {
      if (table === "client_landing_pages") {
        return {
          select(columns: string): SignupSelectBuilder {
            const wanted = columns.split(",").map((c) => c.trim());
            const eqFilters: Array<[string, unknown]> = [];
            const builder: SignupSelectBuilder = {
              eq(column, value) {
                eqFilters.push([column, value]);
                return builder;
              },
              is() {
                return builder;
              },
              then(onFulfilled, onRejected) {
                const matched = capiRows
                  .filter((row) =>
                    eqFilters.every(
                      ([c, v]) =>
                        (row as unknown as Record<string, unknown>)[c] === v,
                    ),
                  )
                  .map((row) => {
                    const projected: Record<string, unknown> = {};
                    for (const column of wanted) {
                      projected[column] =
                        (row as unknown as Record<string, unknown>)[column] ??
                        null;
                    }
                    return projected;
                  });
                return Promise.resolve({ data: matched, error: null }).then(
                  onFulfilled,
                  onRejected,
                );
              },
            };
            return builder;
          },
          insert() {
            throw new Error("fake capi db: client_landing_pages is read-only");
          },
        };
      }
      return inner.from(table);
    },
  };
}
