import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decryptPii } from "../encrypt.ts";
import { storeSignup, type StoreSignupInput } from "../signup-store.ts";
import type { SignupSubmission } from "../types.ts";
import { makeFakeSignupDb } from "./_fake-signup-db.ts";

const KEY = "test-token-key-123";

function makeSubmission(overrides: Partial<SignupSubmission> = {}): SignupSubmission {
  return {
    email: "amelia@example.com",
    phone_e164: null,
    phone_country_code: null,
    ig_handle: "amelia",
    tt_handle: null,
    consent_wa_opt_in: false,
    utm: { utm_source: "instagram" },
    referrer_url: null,
    source: "paid_meta",
    capi_event_id: null,
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<StoreSignupInput> = {},
): StoreSignupInput {
  return {
    eventId: "event-1",
    clientId: "client-1",
    submission: makeSubmission(),
    emailHash: "hash-email-1",
    phoneHash: null,
    ipHash: "hash-ip-1",
    userAgent: "test-agent",
    geo: { country: "GB", region: "ENG", city: "London" },
    tokenKey: KEY,
    now: new Date("2026-07-04T12:00:00Z"),
    ...overrides,
  };
}

describe("storeSignup — canonical path", () => {
  it("inserts a canonical row with encrypted PII + paired hashes", async () => {
    const db = makeFakeSignupDb();
    const outcome = await storeSignup(db, makeInput());
    assert.equal(outcome.deduplicated, false);

    const row = db.rows[0];
    assert.equal(row.event_id, "event-1");
    assert.equal(row.client_id, "client-1");
    assert.equal(row.email_hash, "hash-email-1");
    assert.notEqual(row.email_encrypted, "amelia@example.com"); // never plaintext
    assert.equal(row.phone_encrypted, null);
    assert.equal(row.phone_hash, null);
    assert.equal(row.consent_gdpr_at, "2026-07-04T12:00:00.000Z");
    assert.equal(row.consent_wa_opt_in_at, null);
    // PR 6: geo stored plaintext; names/city no longer exist on the row.
    assert.equal(row.geo_country, "GB");
    assert.equal(row.geo_region, "ENG");
    assert.equal(row.geo_city, "London");
    assert.ok(!("first_name" in row));
    assert.ok(!("last_name" in row));
    assert.ok(!("city" in row));

    // Round trip through the (stubbed) decrypt proves the blob is the
    // encrypted email, not garbage.
    const decrypted = await decryptPii(db, row.email_encrypted as string, KEY);
    assert.equal(decrypted, "amelia@example.com");
  });

  it("stamps consent_wa_opt_in_at when opted in with a phone", async () => {
    const db = makeFakeSignupDb();
    await storeSignup(
      db,
      makeInput({
        submission: makeSubmission({
          email: null,
          phone_e164: "+447911123456",
          phone_country_code: "GB",
          consent_wa_opt_in: true,
        }),
        emailHash: null,
        phoneHash: "hash-phone-1",
      }),
    );
    const row = db.rows[0];
    assert.equal(row.consent_wa_opt_in_at, "2026-07-04T12:00:00.000Z");
    assert.equal(row.phone_hash, "hash-phone-1");
    const decrypted = await decryptPii(db, row.phone_encrypted as string, KEY);
    assert.equal(decrypted, "+447911123456");
  });
});

describe("storeSignup — dedupe", () => {
  it("same email + same event → returns canonical id, deduplicated=true, repeat row has NO PII", async () => {
    const db = makeFakeSignupDb();
    const first = await storeSignup(db, makeInput());
    const second = await storeSignup(
      db,
      makeInput({ submission: makeSubmission({ utm: { utm_source: "tiktok" }, source: "paid_tiktok" }) }),
    );

    assert.equal(second.deduplicated, true);
    assert.equal(second.signupId, first.signupId);
    assert.equal(db.rows.length, 2);

    const repeat = db.rows[1];
    assert.equal(repeat.deduplicated_signup_id, first.signupId);
    assert.equal(repeat.email_encrypted ?? null, null); // attribution-only
    assert.equal(repeat.email_hash ?? null, null);
    assert.equal(repeat.source, "paid_tiktok"); // repeat attribution retained
  });

  it("same email but DIFFERENT event → two canonical rows (dedupe is per event)", async () => {
    const db = makeFakeSignupDb();
    const first = await storeSignup(db, makeInput());
    const second = await storeSignup(db, makeInput({ eventId: "event-2" }));
    assert.equal(second.deduplicated, false);
    assert.notEqual(second.signupId, first.signupId);
  });

  it("dedupes by phone hash when email absent", async () => {
    const db = makeFakeSignupDb();
    const input = makeInput({
      submission: makeSubmission({ email: null, phone_e164: "+447911123456" }),
      emailHash: null,
      phoneHash: "hash-phone-1",
    });
    const first = await storeSignup(db, input);
    const second = await storeSignup(db, input);
    assert.equal(second.deduplicated, true);
    assert.equal(second.signupId, first.signupId);
  });

  it("concurrent-duplicate race: 23505 from the unique index resolves to the dedupe path", async () => {
    const db = makeFakeSignupDb();
    // The pre-insert SELECT misses (empty table), but a concurrent writer
    // lands the canonical row before our INSERT — the fake's armed race
    // makes the partial unique index reject ours with 23505.
    db.injectRaceOnNextInsert();
    const outcome = await storeSignup(db, makeInput());
    assert.equal(outcome.deduplicated, true);
    // The returned id is the concurrent writer's canonical row, and our
    // attempt was recorded as an attribution-only repeat row.
    const canonical = db.rows.find((r) => r.deduplicated_signup_id == null);
    const repeat = db.rows.find((r) => r.deduplicated_signup_id != null);
    assert.ok(canonical && repeat);
    assert.equal(outcome.signupId, canonical.id);
    assert.equal(repeat.deduplicated_signup_id, canonical.id);
    assert.equal(repeat.email_encrypted ?? null, null);
  });
});
