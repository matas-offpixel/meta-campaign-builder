/**
 * Unit tests for `lib/attribution/matcher.ts`.
 *
 * Pinned cases from the prompt + a few edges:
 *   1. email_hash match (highest confidence)
 *   2. external_id match (when no email hit)
 *   3. fbc_cookie match (when no email + no external_id)
 *   4. unmatched (no signal hits)
 *   5. multiple clicks with same email — latest pre-purchase wins
 *   6. purchase before any click — unmatched
 *   7. case-insensitive email — covered by hashing layer; here we
 *      verify the matcher operates purely on already-hashed values
 *      and doesn't leak case sensitivity through the comparison
 *   8. priority ordering — email beats external_id beats fbc even
 *      when all three match different touchpoints
 *   9. nullish signals on the purchase side don't crash
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  matchPurchase,
  MATCH_CONFIDENCE,
  type MatchPurchaseInput,
  type MatchTouchpointInput,
} from "../matcher.ts";

function p(over: Partial<MatchPurchaseInput>): MatchPurchaseInput {
  return {
    purchaseEventId: "pe-1",
    purchasedAt: "2026-05-15T12:00:00Z",
    emailHash: null,
    externalIdHash: null,
    fbc: null,
    ...over,
  };
}

function t(over: Partial<MatchTouchpointInput>): MatchTouchpointInput {
  return {
    touchpointId: "tp-1",
    clickedAt: "2026-05-15T11:00:00Z",
    emailHash: null,
    externalIdHash: null,
    fbc: null,
    ...over,
  };
}

describe("matchPurchase", () => {
  it("matches on email_hash with confidence 0.95", () => {
    const result = matchPurchase(
      p({ emailHash: "EMAIL_HASH_BOB" }),
      [t({ touchpointId: "tp-bob", emailHash: "EMAIL_HASH_BOB" })],
    );
    assert.equal(result.strategy, "email_hash");
    assert.equal(result.touchpointId, "tp-bob");
    assert.equal(result.confidence, MATCH_CONFIDENCE.email_hash);
  });

  it("falls back to external_id when email doesn't match", () => {
    const result = matchPurchase(
      p({ emailHash: "EMAIL_X", externalIdHash: "EXT_Y" }),
      [
        // Email differs.
        t({ touchpointId: "tp-1", emailHash: "EMAIL_OTHER" }),
        // External_id matches.
        t({ touchpointId: "tp-2", externalIdHash: "EXT_Y" }),
      ],
    );
    assert.equal(result.strategy, "external_id");
    assert.equal(result.touchpointId, "tp-2");
    assert.equal(result.confidence, MATCH_CONFIDENCE.external_id);
  });

  it("falls back to fbc_cookie when email + external_id miss", () => {
    const result = matchPurchase(
      p({ fbc: "fb.1.123.456" }),
      [
        t({ touchpointId: "tp-1", emailHash: "OTHER" }),
        t({ touchpointId: "tp-2", fbc: "fb.1.123.456" }),
      ],
    );
    assert.equal(result.strategy, "fbc_cookie");
    assert.equal(result.touchpointId, "tp-2");
    assert.equal(result.confidence, MATCH_CONFIDENCE.fbc_cookie);
  });

  it("returns unmatched when no signal aligns", () => {
    const result = matchPurchase(
      p({ emailHash: "X", externalIdHash: "Y", fbc: "Z" }),
      [
        t({ emailHash: "OTHER_X" }),
        t({ externalIdHash: "OTHER_Y" }),
        t({ fbc: "OTHER_Z" }),
      ],
    );
    assert.equal(result.strategy, "unmatched");
    assert.equal(result.touchpointId, null);
    assert.equal(result.confidence, 0);
  });

  it("returns unmatched on an empty touchpoint set", () => {
    const result = matchPurchase(p({ emailHash: "X" }), []);
    assert.equal(result.strategy, "unmatched");
    assert.equal(result.touchpointId, null);
  });

  it("picks the latest pre-purchase click when multiple emails match", () => {
    const result = matchPurchase(
      p({
        emailHash: "EMAIL_BOB",
        purchasedAt: "2026-05-15T15:00:00Z",
      }),
      [
        t({
          touchpointId: "tp-old",
          emailHash: "EMAIL_BOB",
          clickedAt: "2026-05-10T08:00:00Z",
        }),
        t({
          touchpointId: "tp-mid",
          emailHash: "EMAIL_BOB",
          clickedAt: "2026-05-14T10:00:00Z",
        }),
        t({
          touchpointId: "tp-new",
          emailHash: "EMAIL_BOB",
          clickedAt: "2026-05-15T09:00:00Z",
        }),
      ],
    );
    assert.equal(result.touchpointId, "tp-new");
  });

  it("ignores touchpoints clicked AFTER the purchase (no time travel)", () => {
    const result = matchPurchase(
      p({
        emailHash: "EMAIL_BOB",
        purchasedAt: "2026-05-15T12:00:00Z",
      }),
      [
        // After purchase — must be ignored.
        t({
          touchpointId: "tp-after",
          emailHash: "EMAIL_BOB",
          clickedAt: "2026-05-15T13:00:00Z",
        }),
        // Before purchase — eligible.
        t({
          touchpointId: "tp-before",
          emailHash: "EMAIL_BOB",
          clickedAt: "2026-05-15T11:00:00Z",
        }),
      ],
    );
    assert.equal(result.touchpointId, "tp-before");
  });

  it("returns unmatched when the only candidate clicked AFTER the purchase", () => {
    const result = matchPurchase(
      p({
        emailHash: "EMAIL_BOB",
        purchasedAt: "2026-05-15T12:00:00Z",
      }),
      [
        t({
          touchpointId: "tp-after",
          emailHash: "EMAIL_BOB",
          clickedAt: "2026-05-15T13:00:00Z",
        }),
      ],
    );
    assert.equal(result.strategy, "unmatched");
  });

  it("operates on hashed values verbatim (no case folding leakage)", () => {
    // The matcher must compare hashes as opaque strings; passing
    // 'Email_Hash_Bob' vs 'email_hash_bob' should NOT collapse.
    // The hashing layer is responsible for normalisation; if the
    // matcher silently lowercased we'd hide bugs in the caller.
    const result = matchPurchase(
      p({ emailHash: "Email_Hash_Bob" }),
      [t({ touchpointId: "tp-1", emailHash: "email_hash_bob" })],
    );
    assert.equal(result.strategy, "unmatched");
  });

  it("prefers email_hash over external_id over fbc when several match", () => {
    const result = matchPurchase(
      p({
        emailHash: "E",
        externalIdHash: "X",
        fbc: "F",
      }),
      [
        t({ touchpointId: "tp-fbc", fbc: "F" }),
        t({ touchpointId: "tp-ext", externalIdHash: "X" }),
        t({ touchpointId: "tp-email", emailHash: "E" }),
      ],
    );
    assert.equal(result.strategy, "email_hash");
    assert.equal(result.touchpointId, "tp-email");
  });

  it("doesn't crash on a purchase with all signals null", () => {
    const result = matchPurchase(
      p({}),
      [t({ touchpointId: "tp-1", emailHash: "E" })],
    );
    assert.equal(result.strategy, "unmatched");
    assert.equal(result.touchpointId, null);
  });

  it("is deterministic with respect to ties (input order)", () => {
    // Two clicks at the same instant — the matcher is documented to
    // return the input-order winner. Pin it so accidental sort
    // changes break the test.
    const sameTime = "2026-05-15T11:00:00Z";
    const result = matchPurchase(
      p({
        emailHash: "E",
        purchasedAt: "2026-05-15T12:00:00Z",
      }),
      [
        t({ touchpointId: "tp-a", emailHash: "E", clickedAt: sameTime }),
        t({ touchpointId: "tp-b", emailHash: "E", clickedAt: sameTime }),
      ],
    );
    assert.equal(result.touchpointId, "tp-a");
  });
});
