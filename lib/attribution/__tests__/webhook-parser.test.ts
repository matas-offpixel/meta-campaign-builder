/**
 * Unit tests for `lib/attribution/webhook-parser.ts`.
 *
 * The route handler at `app/api/webhooks/ticketing/[provider]/route.ts`
 * delegates the load-bearing logic to this module, so the prompt's
 * pinned cases (signature validation, payload parsing, missing
 * fields, hashed-PII roundtrip) all run here.
 *
 * Idempotency is tested at the DB level via the unique constraint
 * on `(provider, external_order_id)` — not exercisable from a pure
 * test, but the parser is invoked twice with the same input and we
 * verify it produces the same output (a necessary precondition for
 * the upsert path to be a no-op).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  parseFourthefansPayload,
  verifyFourthefansSignature,
} from "../webhook-parser.ts";

const SECRET = "shhh";

function signed(body: string, header = "x-fourthefans-signature") {
  const sig = createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
  return { [header]: sig };
}

describe("verifyFourthefansSignature", () => {
  it("accepts a valid signature on the primary header", () => {
    const body = '{"hello":"world"}';
    const result = verifyFourthefansSignature(
      body,
      SECRET,
      signed(body, "x-fourthefans-signature"),
    );
    assert.deepEqual(result, { ok: true });
  });

  it("accepts the fallback x-webhook-signature header", () => {
    const body = '{"hello":"world"}';
    const result = verifyFourthefansSignature(
      body,
      SECRET,
      signed(body, "x-webhook-signature"),
    );
    assert.deepEqual(result, { ok: true });
  });

  it("tolerates a `sha256=` prefix on the supplied signature", () => {
    const body = '{"hello":"world"}';
    const sig = createHmac("sha256", SECRET)
      .update(body, "utf8")
      .digest("hex");
    const result = verifyFourthefansSignature(body, SECRET, {
      "x-fourthefans-signature": `sha256=${sig}`,
    });
    assert.deepEqual(result, { ok: true });
  });

  it("returns missing_header when no signature is present", () => {
    const result = verifyFourthefansSignature("body", SECRET, {});
    assert.deepEqual(result, { ok: false, reason: "missing_header" });
  });

  it("returns signature_mismatch on bad signature", () => {
    const result = verifyFourthefansSignature("body", SECRET, {
      "x-fourthefans-signature": "deadbeef",
    });
    assert.deepEqual(result, { ok: false, reason: "signature_mismatch" });
  });

  it("returns signature_mismatch when the secret used differs", () => {
    const body = '{"hello":"world"}';
    const wrongSecret = "different";
    const sig = createHmac("sha256", wrongSecret)
      .update(body, "utf8")
      .digest("hex");
    const result = verifyFourthefansSignature(body, SECRET, {
      "x-fourthefans-signature": sig,
    });
    assert.deepEqual(result, { ok: false, reason: "signature_mismatch" });
  });
});

describe("parseFourthefansPayload", () => {
  it("rejects missing required fields with the offenders enumerated", () => {
    const result = parseFourthefansPayload({ order_id: "o-1" });
    assert.equal(result.ok, false);
    if (result.ok) return; // type-narrow
    assert.equal(result.reason, "missing_required_field");
    assert.deepEqual(
      result.missing!.sort(),
      ["event_id", "purchased_at"].sort(),
    );
  });

  it("rejects an unparseable purchased_at as purchased_at_invalid", () => {
    const result = parseFourthefansPayload({
      order_id: "o-1",
      event_id: "ev-1",
      purchased_at: "not-a-date",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "purchased_at_invalid");
  });

  it("hashes email + external_id + IP and never returns the raw values", () => {
    const result = parseFourthefansPayload({
      order_id: "o-2",
      event_id: "ev-1",
      purchased_at: "2026-05-15T12:00:00Z",
      email: "Bob@Example.com",
      external_id: "USER-42",
      ip: "203.0.113.7",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.match(result.payload.emailHash!, /^[a-f0-9]{64}$/);
    assert.match(result.payload.externalIdHash!, /^[a-f0-9]{64}$/);
    assert.match(result.payload.ipHash!, /^[a-f0-9]{64}$/);
    // The shape is server-safe — it has no `email` / `ip` keys.
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.payload, "email"),
      false,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.payload, "ip"),
      false,
    );
  });

  it("normalises money via `amount` to integer minor units", () => {
    const result = parseFourthefansPayload({
      order_id: "o-3",
      event_id: "ev-1",
      purchased_at: "2026-05-15T12:00:00Z",
      amount: 24.5,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.amountMinor, 2450);
  });

  it("prefers explicit amount_minor over amount when both supplied", () => {
    const result = parseFourthefansPayload({
      order_id: "o-3",
      event_id: "ev-1",
      purchased_at: "2026-05-15T12:00:00Z",
      amount: 24.5, // would map to 2450
      amount_minor: 9999,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.amountMinor, 9999);
  });

  it("defaults missing currency to GBP", () => {
    const result = parseFourthefansPayload({
      order_id: "o-3",
      event_id: "ev-1",
      purchased_at: "2026-05-15T12:00:00Z",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.currency, "GBP");
  });

  it("clamps a negative ticket count to 0", () => {
    const result = parseFourthefansPayload({
      order_id: "o-3",
      event_id: "ev-1",
      purchased_at: "2026-05-15T12:00:00Z",
      tickets: -2,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.ticketCount, 0);
  });

  it("uses ticket_count when tickets isn't supplied", () => {
    const result = parseFourthefansPayload({
      order_id: "o-3",
      event_id: "ev-1",
      purchased_at: "2026-05-15T12:00:00Z",
      ticket_count: 4,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.ticketCount, 4);
  });

  it("idempotency proxy: same input → identical output", () => {
    const input = {
      order_id: "o-replay",
      event_id: "ev-1",
      purchased_at: "2026-05-15T12:00:00Z",
      email: "alice@example.com",
      tickets: 2,
      amount: 30,
    };
    const a = parseFourthefansPayload(input);
    const b = parseFourthefansPayload(input);
    assert.deepEqual(a, b);
  });

  it("accepts both _fbc / fbc + _fbp / fbp aliases", () => {
    const result = parseFourthefansPayload({
      order_id: "o-3",
      event_id: "ev-1",
      purchased_at: "2026-05-15T12:00:00Z",
      _fbc: "fb.1.123.456",
      fbp: "fb.1.789",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.fbc, "fb.1.123.456");
    assert.equal(result.payload.fbp, "fb.1.789");
  });
});
