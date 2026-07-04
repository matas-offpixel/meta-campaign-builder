import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hashEmail, hashPhone } from "../hash.ts";
import {
  buildCapiEventPayload,
  CAPI_API_VERSION,
  hashForCapi,
  normalizePhoneForCapi,
  sendCapiEvent,
  type CapiEventInput,
} from "../meta-capi.ts";

/**
 * Server-side CAPI unit layer: Meta hash format (byte-for-byte fixtures),
 * payload shape, and the retry/timeout/fail-open state machine with an
 * injected fetch + sleep (no real timers, no network).
 */

// ── Meta hash format ─────────────────────────────────────────────────────────

describe("hashForCapi — Meta's unsalted sha256 spec", () => {
  it("matches the known-good fixture byte-for-byte (lowercase+trim, hex)", () => {
    // sha256("fan@example.com") — independently computed.
    const expected =
      "90fb42525afe02cbd2224ed6b3ae00fa178bb556ea86996415a257667bd87b60";
    assert.equal(hashForCapi("fan@example.com"), expected);
    assert.equal(hashForCapi("  FAN@Example.COM  "), expected);
  });

  it("phone: E.164 → digits only, then the known-good sha256", () => {
    assert.equal(normalizePhoneForCapi("+447400123456"), "447400123456");
    // sha256("447400123456") — independently computed.
    assert.equal(
      hashForCapi(normalizePhoneForCapi("+447400123456")),
      "d2db976dff17e6a44bd3a25a2ba91efc63ccb18de90db7a560e7cf93544934bd",
    );
  });

  it("empty/nullish inputs yield null, never sha256('')", () => {
    assert.equal(hashForCapi(null), null);
    assert.equal(hashForCapi("   "), null);
    assert.equal(normalizePhoneForCapi(""), null);
  });

  it("NEVER interchangeable with the salted dedupe hashes (hash.ts)", () => {
    const email = "fan@example.com";
    const phone = "+447400123456";
    for (const salt of ["salt-number-one", "salt-number-two"]) {
      assert.notEqual(
        hashForCapi(email),
        hashEmail(email, salt),
        "CAPI hash collided with the salted dedupe hash — the families must stay distinct",
      );
      assert.notEqual(
        hashForCapi(normalizePhoneForCapi(phone)),
        hashPhone(phone, salt),
      );
    }
  });
});

// ── Payload builder ──────────────────────────────────────────────────────────

const baseInput: CapiEventInput = {
  eventId: "base-uuid-1234-lead",
  eventTime: 1_751_630_000,
  eventSourceUrl: "https://app.example.com/l/gmc/jackies",
  email: "fan@example.com",
  phoneE164: "+447400123456",
  clientIp: "203.0.113.7",
  clientUserAgent: "node-test-ua",
  source: "paid_meta",
};

describe("buildCapiEventPayload", () => {
  it("builds the Meta /events shape with hashed user_data", () => {
    const payload = buildCapiEventPayload(baseInput, null);
    assert.equal(payload.data.length, 1);
    const event = payload.data[0] as Record<string, unknown>;
    assert.equal(event.event_name, "Lead");
    assert.equal(event.event_time, baseInput.eventTime);
    assert.equal(event.event_id, baseInput.eventId);
    assert.equal(event.event_source_url, baseInput.eventSourceUrl);
    assert.equal(event.action_source, "website");
    const userData = event.user_data as Record<string, unknown>;
    assert.deepEqual(userData.em, [hashForCapi("fan@example.com")]);
    assert.deepEqual(userData.ph, [hashForCapi("447400123456")]);
    assert.equal(userData.client_ip_address, "203.0.113.7");
    assert.equal(userData.client_user_agent, "node-test-ua");
    assert.deepEqual(event.custom_data, { source: "paid_meta", value: null });
  });

  it("no raw PII anywhere in the serialized payload", () => {
    const serialized = JSON.stringify(buildCapiEventPayload(baseInput, null));
    assert.ok(!serialized.includes("fan@example.com"), "raw email leaked");
    assert.ok(!serialized.includes("+447400123456"), "raw phone leaked");
    assert.ok(!serialized.includes('"447400123456"'), "normalised phone leaked unhashed");
  });

  it("test_event_code appears when set, is ABSENT (not null) when unset", () => {
    const withCode = buildCapiEventPayload(baseInput, "TEST12345");
    assert.equal(withCode.test_event_code, "TEST12345");
    const without = buildCapiEventPayload(baseInput, null);
    assert.ok(!("test_event_code" in without));
  });

  it("email-only and phone-only submissions drop the missing field entirely", () => {
    const emailOnly = buildCapiEventPayload(
      { ...baseInput, phoneE164: null },
      null,
    );
    const userData = (emailOnly.data[0] as Record<string, unknown>)
      .user_data as Record<string, unknown>;
    assert.ok("em" in userData);
    assert.ok(!("ph" in userData));
  });
});

// ── Send: retry / timeout / fail-open ────────────────────────────────────────

const CREDS = {
  pixelId: "111111111111111",
  accessToken: "token-client-a",
  testEventCode: null,
};

interface FetchCall {
  url: string;
  body: string;
}

function scriptedFetch(
  script: Array<{ status: number; body?: unknown } | "hang">,
  calls: FetchCall[],
): typeof fetch {
  let i = 0;
  return ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    const step = script[Math.min(i, script.length - 1)];
    i += 1;
    if (step === "hang") {
      // Never resolves on its own — only the caller's AbortSignal ends it,
      // which is exactly how a >2s Meta response behaves under the cap.
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }
    return Promise.resolve(
      new Response(JSON.stringify(step.body ?? { events_received: 1, fbtrace_id: "trace-ok" }), {
        status: step.status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
}

const instantSleep = async () => {};

describe("sendCapiEvent — retry / timeout / fail-open-loudly", () => {
  const payload = buildCapiEventPayload(baseInput, null);

  it("POSTs to the correct Meta endpoint with pixel id + token in the URL", async () => {
    const calls: FetchCall[] = [];
    const outcome = await sendCapiEvent(payload, CREDS, {
      fetchImpl: scriptedFetch([{ status: 200 }], calls),
      sleep: instantSleep,
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.fbtrace_id, "trace-ok");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      `https://graph.facebook.com/${CAPI_API_VERSION}/111111111111111/events?access_token=token-client-a`,
    );
  });

  it("500 → 500 → 200 = success on the third attempt, SAME event_id every time", async () => {
    const calls: FetchCall[] = [];
    const outcome = await sendCapiEvent(payload, CREDS, {
      fetchImpl: scriptedFetch(
        [{ status: 500, body: { error: { message: "boom" } } }, { status: 500, body: {} }, { status: 200 }],
        calls,
      ),
      sleep: instantSleep,
    });
    assert.equal(outcome.ok, true);
    assert.equal(calls.length, 3);
    for (const call of calls) {
      assert.ok(
        call.body.includes('"event_id":"base-uuid-1234-lead"'),
        "retries must reuse the SAME event_id — Meta dedups on it; a fresh id per attempt would create duplicate Leads",
      );
    }
  });

  it("500 → 500 → 500 = fail-open: {ok:false}, exactly 3 attempts, never throws", async () => {
    const calls: FetchCall[] = [];
    const outcome = await sendCapiEvent(payload, CREDS, {
      fetchImpl: scriptedFetch([{ status: 500, body: { error: { message: "down" } } }], calls),
      sleep: instantSleep,
    });
    assert.equal(outcome.ok, false);
    assert.match(outcome.error ?? "", /http_500/);
    assert.equal(calls.length, 3);
  });

  it("4xx (bad token) is PERMANENT: one attempt, no retry, fbtrace surfaced", async () => {
    const calls: FetchCall[] = [];
    const outcome = await sendCapiEvent(payload, CREDS, {
      fetchImpl: scriptedFetch(
        [{ status: 400, body: { error: { message: "Invalid OAuth access token", fbtrace_id: "trace-bad" } } }],
        calls,
      ),
      sleep: instantSleep,
    });
    assert.equal(outcome.ok, false);
    assert.equal(calls.length, 1, "4xx must not retry — it will not heal");
    assert.equal(outcome.fbtrace_id, "trace-bad");
    assert.match(outcome.error ?? "", /http_400/);
  });

  it("timeout (>2s hang) aborts the attempt and the retry succeeds", async () => {
    const calls: FetchCall[] = [];
    const outcome = await sendCapiEvent(payload, CREDS, {
      fetchImpl: scriptedFetch(["hang", { status: 200 }], calls),
      sleep: instantSleep,
    });
    assert.equal(outcome.ok, true);
    assert.equal(calls.length, 2);
  });

  it("total 6s deadline: stops retrying once the budget is spent", async () => {
    const calls: FetchCall[] = [];
    let clock = 0;
    const outcome = await sendCapiEvent(payload, CREDS, {
      fetchImpl: ((url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), body: String(init?.body ?? "") });
        clock += 5_000; // each attempt burns 5 simulated seconds
        return Promise.resolve(
          new Response(JSON.stringify({ error: { message: "slow 500" } }), { status: 500 }),
        );
      }) as typeof fetch,
      sleep: instantSleep,
      now: () => clock,
    });
    assert.equal(outcome.ok, false);
    assert.ok(calls.length < 3, `expected the deadline to cut retries short, got ${calls.length} attempts`);
    assert.match(outcome.error ?? "", /deadline/);
  });

  it("network error (fetch throws) is retried, then fails open", async () => {
    let attempts = 0;
    const outcome = await sendCapiEvent(payload, CREDS, {
      fetchImpl: (() => {
        attempts += 1;
        return Promise.reject(new Error("ECONNRESET"));
      }) as typeof fetch,
      sleep: instantSleep,
    });
    assert.equal(outcome.ok, false);
    assert.equal(attempts, 3);
    assert.match(outcome.error ?? "", /network_error/);
  });
});
