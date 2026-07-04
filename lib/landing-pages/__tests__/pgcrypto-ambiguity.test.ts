import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  decryptPii,
  emulatePgcryptoResolution,
  encryptPii,
  LANDING_PAGE_CRYPTO_SEARCH_PATH,
} from "../encrypt.ts";
import { makeFakeSignupDb } from "./_fake-signup-db.ts";

/**
 * PGCRYPTO SCHEMA AMBIGUITY — pgcrypto has lived in BOTH `public`
 * (current prod, ops fix 2026-07-01 night) and `extensions` (migration 131
 * placement, Supabase convention) within one week. Migration 134 must work
 * under EITHER placement. Two enforcement layers, both tested here:
 *
 *  1. Semantics: functions declared with search_path = public, extensions
 *     resolve pgp_sym_* wherever pgcrypto is installed. Exercised for both
 *     placements via the resolution emulator (one run per schema).
 *  2. Source assertions on 134_event_signups.sql: the declared search_path
 *     covers both schemas, no pgp_sym_* call is single-schema-qualified in
 *     the function bodies, and the verification block probes BOTH
 *     qualified names.
 *
 * Live proof happens at apply time: the migration's verification block
 * probes public.pgp_sym_encrypt and extensions.pgp_sym_encrypt and raises
 * unless at least one works, then round-trips through the new helpers.
 */

const migrationSource = readFileSync(
  join(process.cwd(), "supabase", "migrations", "134_event_signups.sql"),
  "utf8",
);

describe("pgcrypto schema ambiguity — resolution semantics", () => {
  for (const installedSchema of ["public", "extensions"] as const) {
    it(`resolves pgp_sym_* with pgcrypto installed in "${installedSchema}"`, () => {
      assert.equal(
        emulatePgcryptoResolution(installedSchema, LANDING_PAGE_CRYPTO_SEARCH_PATH),
        true,
        `search_path ${LANDING_PAGE_CRYPTO_SEARCH_PATH.join(", ")} must cover ${installedSchema}`,
      );
    });

    it(`app-side encrypt/decrypt round trip succeeds under "${installedSchema}" placement`, async () => {
      // The RPC contract is schema-agnostic by design — the fake stands in
      // for the SQL function whose search_path covers this placement.
      const db = makeFakeSignupDb();
      const blob = await encryptPii(db, "fan@example.com", "test-token-key-123");
      assert.notEqual(blob, "fan@example.com");
      assert.equal(
        await decryptPii(db, blob, "test-token-key-123"),
        "fan@example.com",
      );
    });
  }

  it("a single-schema search_path would break the OTHER placement (why both are required)", () => {
    assert.equal(emulatePgcryptoResolution("public", ["extensions"]), false);
    assert.equal(emulatePgcryptoResolution("extensions", ["public"]), false);
  });
});

describe("pgcrypto schema ambiguity — migration 134 source assertions", () => {
  it("crypto functions declare search_path = public, extensions", () => {
    const declarations = migrationSource.match(
      /set search_path = public, extensions/g,
    );
    assert.ok(
      declarations && declarations.length >= 2,
      "both landing_page_encrypt and landing_page_decrypt must set search_path = public, extensions",
    );
  });

  it("no schema-qualified pgp_sym_* call inside the function bodies", () => {
    const bodies = migrationSource
      .split(/create or replace function landing_page_/)
      .slice(1)
      .map((chunk) => chunk.split("$$;")[0]);
    assert.equal(bodies.length >= 2, true);
    for (const body of bodies) {
      assert.ok(
        !/(public|extensions)\.pgp_sym_/.test(body),
        "function bodies must call pgp_sym_* UNQUALIFIED (search_path handles the schema)",
      );
      assert.ok(/pgp_sym_(en|de)crypt/.test(body));
    }
  });

  it("verification block probes BOTH public. and extensions. qualified names", () => {
    assert.ok(migrationSource.includes("public.pgp_sym_encrypt('probe'"));
    assert.ok(migrationSource.includes("extensions.pgp_sym_encrypt('probe'"));
    assert.ok(
      migrationSource.includes("not callable in public OR extensions"),
      "must raise loudly when neither schema has pgcrypto",
    );
  });
});
