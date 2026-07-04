import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fireCompleteRegistrationCapi } from "../capi-fire.ts";
import {
  buildCompleteRegistrationCommand,
  buildPixelInitCommands,
} from "../pixel-events.ts";
import {
  processSignup,
  type SignupHandlerDeps,
  type SignupHandlerEnv,
} from "../signup-handler.ts";
import type { LandingPageContext } from "../types.ts";
import { buildLandingPageView } from "../view.ts";
import { makeFakeCapiDb, type FakeCapiClientRow } from "./_fake-capi-db.ts";

/**
 * CROSS-TENANT PIXEL + CAPI ISOLATION — the PR-3 counterpart of PR 1's
 * data-isolation and PR 2's theme-isolation tests, and the reason this PR
 * exists in this shape: client A's fans landing in client B's retargeting
 * pool is a privacy bug and a Meta ToS violation.
 *
 * Method: two tenants with maximally distinguishable secrets, then
 * BYTE-DIFF everything that leaves the system for tenant A (pixel
 * commands, view model, the full CAPI fetch call: URL + body) against
 * every secret of tenant B — zero occurrences allowed, and vice versa.
 * Both submissions run SEQUENTIALLY through the same module instances,
 * same db handle and same fireCompleteRegistrationCapi import, so module-level caches,
 * memoised tokens or singleton HTTP state would show up as a leak.
 */

const TENANT_A = {
  clientId: "client-aaaa",
  pixel: "111111111111111",
  token: "capi-token-AAAA-secret",
  testCode: "TEST_CODE_AAAA",
};

const TENANT_B = {
  clientId: "client-bbbb",
  pixel: "999999999999999",
  token: "capi-token-BBBB-secret",
  testCode: "TEST_CODE_BBBB",
};

const TOKEN_KEY = "test-token-key-123";

function secretsOf(t: typeof TENANT_A): string[] {
  return [t.pixel, t.token, t.testCode];
}

function makeContext(
  name: "a" | "b",
  tenant: typeof TENANT_A,
): LandingPageContext {
  return {
    client: {
      id: tenant.clientId,
      name: `Client ${name.toUpperCase()}`,
      slug: `client-${name}`,
    },
    event: {
      id: `event-${name}`,
      name: `Event ${name.toUpperCase()}`,
      slug: `event-${name}`,
      event_date: "2026-08-01",
      venue_name: null,
      venue_city: null,
      ticket_url: null,
    },
    pageEvent: {
      id: `pe-${name}`,
      event_id: `event-${name}`,
      provider: "internal",
      evntree_url: null,
      theme_overrides: {},
      content: {},
      status: "live",
      created_at: "",
      updated_at: "",
    },
    landingPage: {
      id: `lp-${name}`,
      client_id: tenant.clientId,
      theme: {},
      meta_pixel_id: tenant.pixel,
      default_provider: "internal",
    },
    template: null,
  };
}

function capiRows(): FakeCapiClientRow[] {
  return [
    {
      client_id: TENANT_A.clientId,
      capi_token_encrypted: `enc:${TOKEN_KEY}:${TENANT_A.token}`,
      meta_test_event_code: TENANT_A.testCode,
    },
    {
      client_id: TENANT_B.clientId,
      capi_token_encrypted: `enc:${TOKEN_KEY}:${TENANT_B.token}`,
      meta_test_event_code: TENANT_B.testCode,
    },
  ];
}

const env: SignupHandlerEnv = {
  tokenKey: TOKEN_KEY,
  hashSalt: "test-salt-123456",
  turnstileSecret: undefined,
  turnstileRequired: false,
};

interface CapturedCall {
  url: string;
  body: string;
}

/** One shared harness for both tenants — deliberately NOT per-tenant. */
function makeHarness() {
  const db = makeFakeCapiDb(capiRows());
  const calls: CapturedCall[] = [];
  const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    return Promise.resolve(
      new Response(
        JSON.stringify({ events_received: 1, fbtrace_id: "trace-1" }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;

  const contexts: Record<string, LandingPageContext> = {
    "client-a": makeContext("a", TENANT_A),
    "client-b": makeContext("b", TENANT_B),
  };

  const deps: SignupHandlerDeps = {
    db,
    resolveContext: async (clientSlug) => contexts[clientSlug] ?? null,
    checkRateLimit: () => ({ allowed: true, retryAfterMs: 0 }),
    buildRateLimitKey: (xff, c, e) => `s:${xff ?? "anon"}:${c}/${e}`,
    verifyCaptcha: async () => ({ ok: true }),
    fireCapi: (args) =>
      fireCompleteRegistrationCapi(db, args, { fetchImpl, sleep: async () => {} }),
    env,
    now: () => new Date("2026-07-04T12:00:00Z"),
  };
  return { deps, calls };
}

function makeInput(
  tenant: "a" | "b",
  email: string,
  capiEventId: string | null = null,
) {
  return {
    clientSlug: `client-${tenant}`,
    eventSlug: `event-${tenant}`,
    body: {
      first_name: "Fan",
      last_name: "Person",
      email,
      consent_gdpr: true,
      ...(capiEventId ? { capi_event_id: capiEventId } : {}),
    },
    xForwardedFor: "203.0.113.7",
    userAgent: "node-test",
    pageUrl: `https://app.example.com/l/client-${tenant}/event-${tenant}`,
  };
}

describe("cross-tenant CAPI isolation — byte-diff", () => {
  it("A then B through the SAME harness: each call carries ONLY its own tenant's pixel, token and test code", async () => {
    const { deps, calls } = makeHarness();

    const resultA = await processSignup(deps, makeInput("a", "fan-a@example.com", "evt-aaaa-1234-cr"));
    const resultB = await processSignup(deps, makeInput("b", "fan-b@example.com", "evt-bbbb-1234-cr"));
    assert.equal(resultA.json.ok && resultB.json.ok, true);
    assert.equal(calls.length, 2, "exactly one CAPI call per signup");

    const [callA, callB] = calls;
    const flatA = callA.url + callA.body;
    const flatB = callB.url + callB.body;

    // Positive: the right material is present…
    assert.ok(callA.url.includes(`/${TENANT_A.pixel}/events`));
    assert.ok(callA.url.includes(`access_token=${encodeURIComponent(TENANT_A.token)}`));
    assert.ok(callA.body.includes(`"test_event_code":"${TENANT_A.testCode}"`));
    assert.ok(callB.url.includes(`/${TENANT_B.pixel}/events`));
    assert.ok(callB.url.includes(`access_token=${encodeURIComponent(TENANT_B.token)}`));
    assert.ok(callB.body.includes(`"test_event_code":"${TENANT_B.testCode}"`));

    // …and the byte-diff: ZERO bytes of the other tenant anywhere.
    for (const secret of secretsOf(TENANT_B)) {
      assert.ok(
        !flatA.includes(secret),
        `tenant B secret "${secret}" leaked into tenant A's CAPI call`,
      );
    }
    for (const secret of secretsOf(TENANT_A)) {
      assert.ok(
        !flatB.includes(secret),
        `tenant A secret "${secret}" leaked into tenant B's CAPI call (module-level cache / singleton suspect)`,
      );
    }

    // Event ids belong to their own submission (dedup pairs stay tenant-local).
    assert.ok(callA.body.includes("evt-aaaa-1234-cr"));
    assert.ok(!callB.body.includes("evt-aaaa-1234-cr"));
  });

  it("B-first ordering leaks nothing either (order-dependence guard)", async () => {
    const { deps, calls } = makeHarness();
    await processSignup(deps, makeInput("b", "fan-b2@example.com"));
    await processSignup(deps, makeInput("a", "fan-a2@example.com"));
    const flatSecond = calls[1].url + calls[1].body;
    for (const secret of secretsOf(TENANT_B)) {
      assert.ok(!flatSecond.includes(secret), `B secret "${secret}" persisted into the A call that followed`);
    }
  });

  it("client-side: pixel commands and view models byte-diff clean across tenants", () => {
    const viewA = buildLandingPageView(makeContext("a", TENANT_A));
    const viewB = buildLandingPageView(makeContext("b", TENANT_B));
    const commandsA = JSON.stringify([
      ...buildPixelInitCommands(viewA.metaPixelId!, "eva-pv"),
      buildCompleteRegistrationCommand(viewA.metaPixelId!, "eva-cr"),
    ]);
    assert.ok(commandsA.includes(TENANT_A.pixel));
    for (const secret of secretsOf(TENANT_B)) {
      assert.ok(!commandsA.includes(secret), `B secret in A's pixel commands`);
    }
    // Tokens and test codes must never reach ANY client-side surface.
    for (const secret of [TENANT_A.token, TENANT_A.testCode, TENANT_B.token, TENANT_B.testCode]) {
      assert.ok(!JSON.stringify(viewA).includes(secret));
      assert.ok(!JSON.stringify(viewB).includes(secret));
    }
  });
});

describe("CAPI handler flows", () => {
  it("no fireCapi dep (PR-2 contract) → response has NO capi field", async () => {
    const { deps } = makeHarness();
    delete deps.fireCapi;
    const result = await processSignup(deps, makeInput("a", "flow-1@example.com"));
    assert.equal(result.json.ok, true);
    if (result.json.ok) assert.ok(!("capi" in result.json));
  });

  it("deduplicated repeat signup → capi skipped, NO fetch fired", async () => {
    const { deps, calls } = makeHarness();
    await processSignup(deps, makeInput("a", "repeat@example.com"));
    const second = await processSignup(deps, makeInput("a", "repeat@example.com"));
    assert.equal(second.json.ok, true);
    if (second.json.ok) {
      assert.equal(second.json.deduplicated, true);
      assert.equal(second.json.capi?.skipped, "deduplicated");
    }
    assert.equal(calls.length, 1, "repeat signup must not re-fire CompleteRegistration");
  });

  it("pixel unset → skipped not_configured, token never even looked up", async () => {
    const { deps, calls } = makeHarness();
    const bare = makeContext("a", TENANT_A);
    bare.landingPage = null;
    deps.resolveContext = async () => bare;
    const result = await processSignup(deps, makeInput("a", "nopixel@example.com"));
    assert.equal(result.json.ok, true);
    if (result.json.ok) assert.equal(result.json.capi?.skipped, "not_configured");
    assert.equal(calls.length, 0);
  });

  it("pixel set but CAPI token missing → skipped not_configured, signup still 200", async () => {
    const db = makeFakeCapiDb([
      { client_id: TENANT_A.clientId, capi_token_encrypted: null, meta_test_event_code: null },
    ]);
    const outcome = await fireCompleteRegistrationCapi(db, {
      clientId: TENANT_A.clientId,
      pixelId: TENANT_A.pixel,
      submission: {
        first_name: "F", last_name: "P", email: "x@example.com", phone_e164: null,
        phone_country_code: null, city: null, ig_handle: null, tt_handle: null,
        consent_wa_opt_in: false, utm: {}, referrer_url: null, source: null,
        capi_event_id: null,
      },
      eventId: "evt-x-cr-123",
      eventTime: 1_751_630_000,
      eventSourceUrl: "https://app.example.com/l/a/b",
      clientIp: null,
      userAgent: null,
      tokenKey: TOKEN_KEY,
    });
    assert.deepEqual(outcome, { ok: false, skipped: "not_configured" });
  });

  it("wrong token key → decrypt fails → not_configured (never a wrong-tenant token)", async () => {
    const db = makeFakeCapiDb(capiRows());
    const outcome = await fireCompleteRegistrationCapi(db, {
      clientId: TENANT_A.clientId,
      pixelId: TENANT_A.pixel,
      submission: {
        first_name: "F", last_name: "P", email: "x@example.com", phone_e164: null,
        phone_country_code: null, city: null, ig_handle: null, tt_handle: null,
        consent_wa_opt_in: false, utm: {}, referrer_url: null, source: null,
        capi_event_id: null,
      },
      eventId: "evt-x-cr-456",
      eventTime: 1_751_630_000,
      eventSourceUrl: "https://app.example.com/l/a/b",
      clientIp: null,
      userAgent: null,
      tokenKey: "a-different-key-entirely",
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.skipped, "not_configured");
  });

  it("body capi_event_id is used verbatim; missing/invalid falls back to a signup-derived id", async () => {
    const { deps, calls } = makeHarness();
    await processSignup(deps, makeInput("a", "eid-1@example.com", "client-made-id-42"));
    assert.ok(calls[0].body.includes('"event_id":"client-made-id-42"'));

    const withoutId = await processSignup(deps, makeInput("a", "eid-2@example.com"));
    assert.equal(withoutId.json.ok, true);
    if (withoutId.json.ok) {
      assert.ok(
        calls[1].body.includes(`"event_id":"${withoutId.json.signup_id}-cr"`),
        "fallback id must be deterministic per signup so accidental re-POSTs still dedup",
      );
    }
  });

  it("CAPI failure never blocks the signup: Meta down 3× → signup 200 with capi.ok=false", async () => {
    const db = makeFakeCapiDb(capiRows());
    const deps: SignupHandlerDeps = {
      db,
      resolveContext: async () => makeContext("a", TENANT_A),
      checkRateLimit: () => ({ allowed: true, retryAfterMs: 0 }),
      buildRateLimitKey: () => "k",
      verifyCaptcha: async () => ({ ok: true }),
      fireCapi: (args) =>
        fireCompleteRegistrationCapi(db, args, {
          fetchImpl: (() =>
            Promise.resolve(
              new Response(JSON.stringify({ error: { message: "down" } }), { status: 500 }),
            )) as typeof fetch,
          sleep: async () => {},
        }),
      env,
      now: () => new Date("2026-07-04T12:00:00Z"),
    };
    const result = await processSignup(deps, makeInput("a", "metadown@example.com"));
    assert.equal(result.status, 200);
    assert.equal(result.json.ok, true);
    if (result.json.ok) {
      assert.equal(result.json.capi?.ok, false);
      assert.match(result.json.capi?.error ?? "", /http_500/);
    }
  });

  it("test_event_code: unset on the tenant row → absent from the payload", async () => {
    const db = makeFakeCapiDb([
      {
        client_id: TENANT_A.clientId,
        capi_token_encrypted: `enc:${TOKEN_KEY}:${TENANT_A.token}`,
        meta_test_event_code: null,
      },
    ]);
    const calls: CapturedCall[] = [];
    await fireCompleteRegistrationCapi(
      db,
      {
        clientId: TENANT_A.clientId,
        pixelId: TENANT_A.pixel,
        submission: {
          first_name: "F", last_name: "P", email: "tec@example.com", phone_e164: null,
          phone_country_code: null, city: null, ig_handle: null, tt_handle: null,
          consent_wa_opt_in: false, utm: {}, referrer_url: null, source: null,
          capi_event_id: null,
        },
        eventId: "evt-tec-cr-1",
        eventTime: 1_751_630_000,
        eventSourceUrl: "https://app.example.com/l/a/b",
        clientIp: null,
        userAgent: null,
        tokenKey: TOKEN_KEY,
      },
      {
        fetchImpl: ((url: string | URL | Request, init?: RequestInit) => {
          calls.push({ url: String(url), body: String(init?.body ?? "") });
          return Promise.resolve(new Response(JSON.stringify({ events_received: 1 }), { status: 200 }));
        }) as typeof fetch,
        sleep: async () => {},
      },
    );
    assert.equal(calls.length, 1);
    assert.ok(!calls[0].body.includes("test_event_code"));
  });
});
