/**
 * lib/landing-pages/encrypt.ts
 *
 * App-side wrapper around the `landing_page_encrypt` / `landing_page_decrypt`
 * SQL functions (migration 134). Key = LANDING_PAGES_TOKEN_KEY, passed per
 * call, never stored — same posture as the D2C credential RPCs but a
 * DIFFERENT key (blast-radius isolation; see the design doc's key-strategy
 * section).
 *
 * PGCRYPTO SCHEMA AMBIGUITY: pgcrypto has lived in BOTH `public` and
 * `extensions` on prod within a single week (2026-07-01). Resilience lives
 * in the SQL layer — both functions declare
 * `set search_path = public, extensions`, so unqualified pgp_sym_* resolves
 * wherever the extension is TODAY, and keeps working if it moves again. The
 * TS layer therefore needs no schema probe for correctness;
 * `emulatePgcryptoResolution` below encodes the resolution rule so the
 * invariant is unit-testable (see pgcrypto-ambiguity.test.ts), and the
 * migration's verification block probes both schemas live at apply time.
 */

export interface RpcDb {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Encrypt a PII value. Returns the bytea blob in PostgREST wire form (hex
 * string `\x…`) — opaque to callers; inserting it into a bytea column
 * round-trips losslessly.
 */
export async function encryptPii(
  db: RpcDb,
  plaintext: string,
  key: string,
): Promise<string> {
  const { data, error } = await db.rpc("landing_page_encrypt", {
    p_plaintext: plaintext,
    p_key: key,
  });
  if (error) {
    throw new Error(`[landing-pages] encrypt failed: ${error.message}`);
  }
  if (typeof data !== "string" || data.length === 0) {
    throw new Error("[landing-pages] encrypt returned an empty blob");
  }
  return data;
}

export async function decryptPii(
  db: RpcDb,
  blob: string,
  key: string,
): Promise<string> {
  const { data, error } = await db.rpc("landing_page_decrypt", {
    p_blob: blob,
    p_key: key,
  });
  if (error) {
    throw new Error(`[landing-pages] decrypt failed: ${error.message}`);
  }
  if (typeof data !== "string") {
    throw new Error("[landing-pages] decrypt returned a non-string value");
  }
  return data;
}

/**
 * Pure model of Postgres function-name resolution for the pgcrypto
 * ambiguity invariant: a caller whose search_path lists BOTH schemas
 * resolves pgp_sym_* regardless of which schema pgcrypto is installed in.
 * Mirrors the `search_path = public, extensions` declaration in migration
 * 134 — if someone edits the migration to a single schema, the paired
 * source-assertion test fails; this function keeps the semantics honest.
 */
export function emulatePgcryptoResolution(
  installedSchema: "public" | "extensions",
  searchPath: readonly string[],
): boolean {
  return searchPath.includes(installedSchema);
}

/** The search_path migration 134's crypto functions declare. */
export const LANDING_PAGE_CRYPTO_SEARCH_PATH: readonly string[] = [
  "public",
  "extensions",
];
