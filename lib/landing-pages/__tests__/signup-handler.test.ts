import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  processSignup,
  verifyRecaptcha,
  type SignupHandlerDeps,
  type SignupHandlerEnv,
} from "../signup-handler.ts";
import type { LandingPageContext } from "../types.ts";
import { makeFakeSignupDb } from "./_fake-signup-db.ts";

/**
 * Full accept/reject matrix for the signup pipeline — this drives the SAME
 * processSignup the route adapter calls, so every branch the API can take
 * is covered without an HTTP harness.
 */

function makeContext(provider: "internal" | "evntree" = "internal"): LandingPageContext {
  return {
    client: { id: "client-1", name: "GMC", slug: "gmc" },
    event: {
      id: "event-1",
      name: "Jackies Mallorca",
      slug: "jackies",
      event_date: "2026-08-01",
      venue_name: null,
      venue_city: null,
      ticket_url: null,
    },
    pageEvent: {
      id: "pe-1",
      event_id: "event-1",
      provider,
      evntree_url: provider === "evntree" ? "https://evntr.ee/x" : null,
      theme_overrides: {},
      content: {},
      status: "live",
      created_at: "",
      updated_at: "",
    },
    landingPage: null,
    template: null,
  };
}

const validBody = {
  first_name: "Amelia",
  last_name: "Stone",
  email: "amelia@example.com",
  phone: "",
  consent_gdpr: true,
};

const baseEnv: SignupHandlerEnv = {
  tokenKey: "test-token-key-123",
  hashSalt: "test-salt-123456",
  recaptchaSecret: undefined,
  recaptchaRequired: false,
};

function makeDeps(overrides: Partial<SignupHandlerDeps> = {}): SignupHandlerDeps {
  return {
    db: makeFakeSignupDb(),
    resolveContext: async () => makeContext(),
    checkRateLimit: () => ({ allowed: true, retryAfterMs: 0 }),
    buildRateLimitKey: (xff, c, e) => `s:${xff ?? "anon"}:${c}/${e}`,
    verifyCaptcha: async () => ({ ok: true }),
    env: baseEnv,
    now: () => new Date("2026-07-04T12:00:00Z"),
    ...overrides,
  };
}

function makeInput(body: unknown = validBody) {
  return {
    clientSlug: "gmc",
    eventSlug: "jackies",
    body,
    xForwardedFor: "203.0.113.7",
    userAgent: "node-test",
  };
}

describe("processSignup — accept", () => {
  it("valid submission → 200 { ok, signup_id, deduplicated: false }", async () => {
    const result = await processSignup(makeDeps(), makeInput());
    assert.equal(result.status, 200);
    assert.equal(result.json.ok, true);
    if (result.json.ok) {
      assert.ok(result.json.signup_id);
      assert.equal(result.json.deduplicated, false);
    }
  });

  it("repeat submission → 200 with deduplicated: true and the SAME signup id", async () => {
    const db = makeFakeSignupDb();
    const deps = makeDeps({ db });
    const first = await processSignup(deps, makeInput());
    const second = await processSignup(deps, makeInput());
    assert.equal(second.status, 200);
    assert.equal(second.json.ok && second.json.deduplicated, true);
    if (first.json.ok && second.json.ok) {
      assert.equal(second.json.signup_id, first.json.signup_id);
    }
  });

  it("hashes the caller IP — raw IP never reaches the stored row", async () => {
    const db = makeFakeSignupDb();
    await processSignup(makeDeps({ db }), makeInput());
    const row = db.rows[0];
    assert.ok(row.ip_hash);
    assert.ok(!String(row.ip_hash).includes("203.0.113.7"));
    assert.ok(!JSON.stringify(row).includes("203.0.113.7"));
  });
});

describe("processSignup — reject matrix", () => {
  it("429 when rate limited", async () => {
    const deps = makeDeps({
      checkRateLimit: () => ({ allowed: false, retryAfterMs: 60000 }),
    });
    const result = await processSignup(deps, makeInput());
    assert.equal(result.status, 429);
  });

  it("400 on empty / non-object payload", async () => {
    for (const body of [null, [], "hi", 42]) {
      const result = await processSignup(makeDeps(), makeInput(body));
      assert.equal(result.status, 400);
    }
  });

  it("400 on missing consent, with field_errors", async () => {
    const result = await processSignup(
      makeDeps(),
      makeInput({ ...validBody, consent_gdpr: false }),
    );
    assert.equal(result.status, 400);
    if (!result.json.ok) assert.ok(result.json.field_errors?.consent_gdpr);
  });

  it("400 on invalid email", async () => {
    const result = await processSignup(
      makeDeps(),
      makeInput({ ...validBody, email: "nope" }),
    );
    assert.equal(result.status, 400);
  });

  it("400 on invalid phone", async () => {
    const result = await processSignup(
      makeDeps(),
      makeInput({ ...validBody, email: "", phone: "123", phone_country: "GB" }),
    );
    assert.equal(result.status, 400);
  });

  it("400 when neither email nor phone provided", async () => {
    const result = await processSignup(
      makeDeps(),
      makeInput({ ...validBody, email: "", phone: "" }),
    );
    assert.equal(result.status, 400);
  });

  it("403 when captcha verification fails", async () => {
    const deps = makeDeps({
      verifyCaptcha: async () => ({ ok: false, reason: "captcha_rejected" }),
    });
    const result = await processSignup(deps, makeInput());
    assert.equal(result.status, 403);
  });

  it("404 on unknown slug chain", async () => {
    const deps = makeDeps({ resolveContext: async () => null });
    const result = await processSignup(deps, makeInput());
    assert.equal(result.status, 404);
  });

  it("409 when provider is evntree — the rollback gate covers the API too", async () => {
    const deps = makeDeps({ resolveContext: async () => makeContext("evntree") });
    const result = await processSignup(deps, makeInput());
    assert.equal(result.status, 409);
  });

  it("500 (loud, no PII written) when LANDING_PAGES_TOKEN_KEY or HASH_SALT missing", async () => {
    for (const env of [
      { ...baseEnv, tokenKey: undefined },
      { ...baseEnv, hashSalt: undefined },
    ]) {
      const db = makeFakeSignupDb();
      const result = await processSignup(makeDeps({ db, env }), makeInput());
      assert.equal(result.status, 500);
      assert.equal(db.rows.length, 0);
    }
  });
});

describe("verifyRecaptcha", () => {
  const withSecret: SignupHandlerEnv = {
    ...baseEnv,
    recaptchaSecret: "secret-abc",
  };

  it("keys unset + not required → skip (dev mode)", async () => {
    const result = await verifyRecaptcha("tok", baseEnv);
    assert.equal(result.ok, true);
  });

  it("keys unset + LANDING_PAGES_RECAPTCHA_REQUIRED=1 → hard failure", async () => {
    const result = await verifyRecaptcha("tok", {
      ...baseEnv,
      recaptchaRequired: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "recaptcha_required_but_unconfigured");
  });

  it("secret set + missing token → failure", async () => {
    const result = await verifyRecaptcha(null, withSecret);
    assert.equal(result.ok, false);
  });

  it("google success/score paths", async () => {
    const fetchOk = (async () => ({
      json: async () => ({ success: true, score: 0.9 }),
    })) as unknown as typeof fetch;
    assert.equal((await verifyRecaptcha("tok", withSecret, fetchOk)).ok, true);

    const fetchLow = (async () => ({
      json: async () => ({ success: true, score: 0.1 }),
    })) as unknown as typeof fetch;
    assert.equal((await verifyRecaptcha("tok", withSecret, fetchLow)).ok, false);

    const fetchReject = (async () => ({
      json: async () => ({ success: false }),
    })) as unknown as typeof fetch;
    assert.equal((await verifyRecaptcha("tok", withSecret, fetchReject)).ok, false);
  });

  it("google unreachable → fail OPEN (fan beats bot paranoia), loudly", async () => {
    const fetchBoom = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    assert.equal((await verifyRecaptcha("tok", withSecret, fetchBoom)).ok, true);
  });
});
