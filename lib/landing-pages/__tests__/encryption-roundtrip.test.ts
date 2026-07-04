import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decryptPii, encryptPii } from "../encrypt.ts";
import type { RpcDb } from "../encrypt.ts";
import { makeFakeSignupDb } from "./_fake-signup-db.ts";

/**
 * Encryption round-trip.
 *
 * Two layers:
 *  1. ALWAYS: the app-side wrapper logic against the in-memory fake —
 *     wrong-key rejection, empty-blob detection, error propagation.
 *  2. OPT-IN LIVE (LANDING_PAGES_ROUNDTRIP_TEST=1 + Supabase env): drives
 *     the REAL landing_page_encrypt/decrypt SQL functions against the
 *     database, post-migration-134. Off by default because the migration
 *     is applied manually post-merge (repo convention) — CI must not
 *     depend on prod state. Note the migration's verification block ALSO
 *     performs this exact round trip at apply time, so a green apply is
 *     itself a live round-trip proof.
 */

const KEY = "roundtrip-key-123";

describe("encryption round trip (wrapper logic, always runs)", () => {
  it("encrypt → decrypt returns the original; blob is not plaintext", async () => {
    const db = makeFakeSignupDb();
    const blob = await encryptPii(db, "fan@example.com", KEY);
    assert.ok(!blob.includes("fan@example.com") || blob !== "fan@example.com");
    assert.equal(await decryptPii(db, blob, KEY), "fan@example.com");
  });

  it("decrypting with the wrong key fails loudly", async () => {
    const db = makeFakeSignupDb();
    const blob = await encryptPii(db, "fan@example.com", KEY);
    await assert.rejects(
      () => decryptPii(db, blob, "wrong-key-456789"),
      /decrypt failed/,
    );
  });

  it("propagates rpc errors instead of returning garbage", async () => {
    const failing: RpcDb = {
      rpc: () =>
        Promise.resolve({ data: null, error: { message: "boom" } }),
    };
    await assert.rejects(() => encryptPii(failing, "x", KEY), /encrypt failed: boom/);
  });
});

const liveEnabled =
  process.env.LANDING_PAGES_ROUNDTRIP_TEST === "1" &&
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

describe("encryption round trip (LIVE — opt-in)", { skip: !liveEnabled }, () => {
  it("landing_page_encrypt/decrypt round-trips through the real database", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    );
    const db: RpcDb = {
      rpc: (fn, args) => client.rpc(fn, args),
    };
    const blob = await encryptPii(db, "live-probe@example.com", KEY);
    assert.match(blob, /^\\x/); // PostgREST bytea wire form
    assert.equal(await decryptPii(db, blob, KEY), "live-probe@example.com");
  });
});
