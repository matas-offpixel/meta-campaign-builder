import type {
  SignupDb,
  SignupInsertBuilder,
  SignupSelectBuilder,
} from "../signup-store.ts";

/**
 * In-memory SignupDb fake for node:test. Emulates the pieces of Postgres
 * the signup write path relies on so the store's REAL logic is exercised:
 *
 *   - `.eq()` / `.is(column, null)` filters (AND semantics)
 *   - `.insert().select("id")` with id assignment
 *   - the PARTIAL UNIQUE indexes: inserting a second canonical row (same
 *     event + same email_hash/phone_hash, deduplicated_signup_id null)
 *     fails with code 23505, exactly like prod
 *   - `rpc("landing_page_encrypt")` — reversible stub so round-trip logic
 *     is assertable without pgcrypto ("enc:{key}:{plaintext}")
 */

type Row = Record<string, unknown>;

export interface FakeSignupDb extends SignupDb {
  rows: Row[];
  /** When set, the next canonical insert fails 23505 exactly once (race). */
  injectRaceOnNextInsert(): void;
}

let idCounter = 0;

export function makeFakeSignupDb(seed: Row[] = []): FakeSignupDb {
  const rows: Row[] = [...seed];
  let raceArmed = false;

  const db: FakeSignupDb = {
    rows,
    injectRaceOnNextInsert() {
      raceArmed = true;
    },
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "landing_page_encrypt") {
        const key = args.p_key as string;
        const plaintext = args.p_plaintext as string;
        if (!key || key.length < 8) {
          return Promise.resolve({
            data: null,
            error: { message: "LANDING_PAGES_TOKEN_KEY must be set and at least 8 characters" },
          });
        }
        return Promise.resolve({ data: `enc:${key}:${plaintext}`, error: null });
      }
      if (fn === "landing_page_decrypt") {
        const key = args.p_key as string;
        const blob = String(args.p_blob ?? "");
        const prefix = `enc:${key}:`;
        if (!blob.startsWith(prefix)) {
          return Promise.resolve({
            data: null,
            error: { message: "Wrong key or corrupt data" },
          });
        }
        return Promise.resolve({ data: blob.slice(prefix.length), error: null });
      }
      return Promise.resolve({
        data: null,
        error: { message: `unknown rpc ${fn}` },
      });
    },
    from(table: string) {
      if (table !== "event_signups") {
        throw new Error(`fake db only models event_signups, got ${table}`);
      }
      return {
        select(columns: string): SignupSelectBuilder {
          const wanted = columns.split(",").map((c) => c.trim());
          const eqFilters: Array<[string, unknown]> = [];
          const isNullFilters: string[] = [];
          const builder: SignupSelectBuilder = {
            eq(column, value) {
              eqFilters.push([column, value]);
              return builder;
            },
            is(column, _value) {
              isNullFilters.push(column);
              return builder;
            },
            then(onFulfilled, onRejected) {
              const matched = rows
                .filter(
                  (row) =>
                    eqFilters.every(([c, v]) => row[c] === v) &&
                    isNullFilters.every((c) => row[c] == null),
                )
                .map((row) => {
                  const projected: Row = {};
                  for (const column of wanted) projected[column] = row[column] ?? null;
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
        insert(row: Row) {
          return {
            select(_columns: string): SignupInsertBuilder {
              return {
                then(onFulfilled, onRejected) {
                  const isCanonical = row.deduplicated_signup_id == null;
                  const duplicate =
                    isCanonical &&
                    rows.some(
                      (existing) =>
                        existing.deduplicated_signup_id == null &&
                        existing.event_id === row.event_id &&
                        ((row.email_hash != null &&
                          existing.email_hash === row.email_hash) ||
                          (row.phone_hash != null &&
                            existing.phone_hash === row.phone_hash)),
                    );
                  if (raceArmed && isCanonical) {
                    // Simulate a concurrent writer winning the race: the
                    // canonical row appears between our SELECT and INSERT,
                    // and the partial unique index rejects ours.
                    raceArmed = false;
                    rows.push({
                      id: `raced-canonical-${++idCounter}`,
                      event_id: row.event_id,
                      email_hash: row.email_hash ?? null,
                      phone_hash: row.phone_hash ?? null,
                      deduplicated_signup_id: null,
                    });
                    return Promise.resolve({
                      data: null,
                      error: {
                        message:
                          'duplicate key value violates unique constraint "event_signups_event_email_uidx"',
                        code: "23505",
                      },
                    }).then(onFulfilled, onRejected);
                  }
                  if (duplicate && isCanonical) {
                    return Promise.resolve({
                      data: null,
                      error: {
                        message:
                          'duplicate key value violates unique constraint "event_signups_event_email_uidx"',
                        code: "23505",
                      },
                    }).then(onFulfilled, onRejected);
                  }
                  const id = `signup-${++idCounter}`;
                  rows.push({ ...row, id });
                  return Promise.resolve({
                    data: [{ id }],
                    error: null,
                  }).then(onFulfilled, onRejected);
                },
              };
            },
          };
        },
      };
    },
  };
  return db;
}
