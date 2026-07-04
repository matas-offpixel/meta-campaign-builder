import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  processSignup,
  TURNSTILE_SITEVERIFY_URL,
  verifyTurnstile,
  type SignupHandlerDeps,
  type SignupHandlerEnv,
} from "../signup-handler.ts";
import type { LandingPageContext } from "../types.ts";
import { makeFakeSignupDb } from "./_fake-signup-db.ts";
import { PAGE_EVENT_PRESENTATION_DEFAULTS } from "./_fixtures.ts";

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
      capacity: null,
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
      ...PAGE_EVENT_PRESENTATION_DEFAULTS,
    },
    landingPage: null,
    template: null,
  };
}

const validBody = {
  email: "amelia@example.com",
  phone: "",
  consent_gdpr: true,
};

const baseEnv: SignupHandlerEnv = {
  tokenKey: "test-token-key-123",
  hashSalt: "test-salt-123456",
  turnstileSecret: undefined,
  turnstileRequired: false,
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
    geo: { country: "GB", region: "ENG", city: "London" },
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

  it("PR 6: legacy first_name/last_name/city in the body are IGNORED — accepted, never stored", async () => {
    const db = makeFakeSignupDb();
    const result = await processSignup(
      makeDeps({ db }),
      makeInput({
        ...validBody,
        first_name: "Amelia",
        last_name: "Stone",
        city: "London",
      }),
    );
    assert.equal(result.status, 200, "stale cached bundles must not 400");
    const row = db.rows[0];
    assert.ok(!("first_name" in row), "first_name must not be written");
    assert.ok(!("last_name" in row), "last_name must not be written");
    assert.ok(!("city" in row), "city must not be written");
    assert.ok(!JSON.stringify(row).includes("Amelia"));
    assert.ok(!JSON.stringify(row).includes("Stone"));
  });

  it("PR 6: server-derived geo is captured onto the row (never from the body)", async () => {
    const db = makeFakeSignupDb();
    await processSignup(makeDeps({ db }), makeInput());
    const row = db.rows[0];
    assert.equal(row.geo_country, "GB");
    assert.equal(row.geo_region, "ENG");
    assert.equal(row.geo_city, "London");
  });

  it("PR 6: missing geo input degrades to nulls (no crash, no undefined)", async () => {
    const db = makeFakeSignupDb();
    const input = makeInput();
    // Simulate a runtime without Vercel geo headers.
    const withoutGeo = { ...input };
    delete (withoutGeo as { geo?: unknown }).geo;
    const result = await processSignup(makeDeps({ db }), withoutGeo);
    assert.equal(result.status, 200);
    assert.equal(db.rows[0].geo_country, null);
    assert.equal(db.rows[0].geo_region, null);
    assert.equal(db.rows[0].geo_city, null);
  });

  it("PR 6: social handle is @-stripped + lowercased on the stored row", async () => {
    const db = makeFakeSignupDb();
    await processSignup(
      makeDeps({ db }),
      makeInput({ ...validBody, ig_handle: "@GMC.Fan_01" }),
    );
    assert.equal(db.rows[0].ig_handle, "gmc.fan_01");
    assert.equal(db.rows[0].tt_handle, null);
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

  it("PR 6: 400 when BOTH ig_handle and tt_handle are set (social mutex)", async () => {
    const result = await processSignup(
      makeDeps(),
      makeInput({ ...validBody, ig_handle: "one", tt_handle: "two" }),
    );
    assert.equal(result.status, 400);
    if (!result.json.ok) assert.ok(result.json.field_errors?.social);
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

describe("verifyTurnstile", () => {
  const withSecret: SignupHandlerEnv = {
    ...baseEnv,
    turnstileSecret: "secret-abc",
  };

  it("keys unset + not required → skip (dev mode)", async () => {
    const result = await verifyTurnstile("tok", baseEnv);
    assert.equal(result.ok, true);
  });

  it("keys unset + LANDING_PAGES_TURNSTILE_REQUIRED=1 → hard failure", async () => {
    const result = await verifyTurnstile("tok", {
      ...baseEnv,
      turnstileRequired: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "turnstile_required_but_unconfigured");
  });

  it("secret set + missing token → failure", async () => {
    const result = await verifyTurnstile(null, withSecret);
    assert.equal(result.ok, false);
  });

  it("posts secret+response to Cloudflare's siteverify endpoint", async () => {
    let calledUrl = "";
    let calledBody = "";
    const fetchSpy = (async (url: unknown, init: { body?: unknown }) => {
      calledUrl = String(url);
      calledBody = String(init?.body ?? "");
      return { json: async () => ({ success: true }) };
    }) as unknown as typeof fetch;

    const result = await verifyTurnstile("tok-123", withSecret, fetchSpy);
    assert.equal(result.ok, true);
    assert.equal(
      calledUrl,
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    assert.equal(calledUrl, TURNSTILE_SITEVERIFY_URL);
    const params = new URLSearchParams(calledBody);
    assert.equal(params.get("secret"), "secret-abc");
    assert.equal(params.get("response"), "tok-123");
  });

  it("cloudflare rejection → failure carrying error-codes (no score in Turnstile)", async () => {
    const fetchReject = (async () => ({
      json: async () => ({
        success: false,
        "error-codes": ["invalid-input-response", "timeout-or-duplicate"],
      }),
    })) as unknown as typeof fetch;
    const result = await verifyTurnstile("tok", withSecret, fetchReject);
    assert.equal(result.ok, false);
    assert.equal(
      result.reason,
      "captcha_rejected:invalid-input-response,timeout-or-duplicate",
    );

    const fetchRejectBare = (async () => ({
      json: async () => ({ success: false }),
    })) as unknown as typeof fetch;
    const bare = await verifyTurnstile("tok", withSecret, fetchRejectBare);
    assert.equal(bare.ok, false);
    assert.equal(bare.reason, "captcha_rejected:unknown");
  });

  it("cloudflare unreachable → fail OPEN (fan beats bot paranoia), loudly", async () => {
    const fetchBoom = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    assert.equal((await verifyTurnstile("tok", withSecret, fetchBoom)).ok, true);
  });
});
