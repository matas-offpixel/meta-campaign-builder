/**
 * Unit tests for `lib/attribution/hashing.ts`.
 *
 * Three load-bearing rules:
 *   1. The trim+lowercase normalisation is byte-identical across
 *      consumers — Meta CAPI's email-hash convention.
 *   2. Empty / whitespace-only inputs return `null`, NOT the hash
 *      of "".
 *   3. `constantTimeEqualHex` doesn't leak length information on
 *      mismatched lengths.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  hashEmail,
  hashExternalId,
  hashIp,
  sha256Hex,
  constantTimeEqualHex,
} from "../hashing.ts";

const sha256 = (s: string) =>
  createHash("sha256").update(s, "utf8").digest("hex");

describe("hashEmail", () => {
  it("returns null for nullish + whitespace-only inputs", () => {
    assert.equal(hashEmail(null), null);
    assert.equal(hashEmail(undefined), null);
    assert.equal(hashEmail(""), null);
    assert.equal(hashEmail("   "), null);
    assert.equal(hashEmail("\t\n"), null);
  });

  it("matches Meta's CAPI normalisation (trim + lowercase) before hashing", () => {
    const expected = sha256("bob@example.com");
    assert.equal(hashEmail("Bob@Example.com"), expected);
    assert.equal(hashEmail("  bob@example.com  "), expected);
    assert.equal(hashEmail("BOB@EXAMPLE.COM"), expected);
  });

  it("is deterministic across calls", () => {
    assert.equal(hashEmail("a@b.com"), hashEmail("a@b.com"));
  });
});

describe("hashExternalId", () => {
  it("normalises identically to hashEmail", () => {
    const expected = sha256("user-123");
    assert.equal(hashExternalId("USER-123"), expected);
    assert.equal(hashExternalId("  user-123 "), expected);
  });

  it("returns null for empties", () => {
    assert.equal(hashExternalId(""), null);
    assert.equal(hashExternalId(null), null);
  });
});

describe("hashIp", () => {
  it("hashes lowercased trimmed IPs", () => {
    const expected = sha256("203.0.113.7");
    assert.equal(hashIp(" 203.0.113.7 "), expected);
    assert.equal(hashIp("203.0.113.7"), expected);
  });

  it("preserves IPv6 brackets / colons after lowercase", () => {
    const expected = sha256("[2001:db8::1]");
    assert.equal(hashIp("[2001:DB8::1]"), expected);
  });

  it("returns null for empties", () => {
    assert.equal(hashIp(""), null);
    assert.equal(hashIp(null), null);
  });
});

describe("sha256Hex", () => {
  it("produces the standard sha256 hex digest", () => {
    // Known vector: empty string sha256.
    const empty =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    assert.equal(sha256Hex(""), empty);
  });
});

describe("constantTimeEqualHex", () => {
  it("returns true on identical strings", () => {
    const h = sha256("hello");
    assert.equal(constantTimeEqualHex(h, h), true);
  });

  it("returns false on differing same-length strings", () => {
    const a = sha256("hello");
    const b = sha256("world");
    assert.equal(constantTimeEqualHex(a, b), false);
  });

  it("returns false on length mismatch (no throw)", () => {
    assert.doesNotThrow(() => constantTimeEqualHex("abcd", "abc"));
    assert.equal(constantTimeEqualHex("abcd", "abc"), false);
  });

  it("handles empty inputs", () => {
    assert.equal(constantTimeEqualHex("", ""), true);
    assert.equal(constantTimeEqualHex("", "a"), false);
  });
});
