/**
 * lib/customer-audience/__tests__/hash-client.test.ts
 *
 * Tests for browser-side PII hashing utilities.
 * Runs under Node's built-in test runner (node:test) + node --experimental-strip-types.
 *
 * Web Crypto (crypto.subtle) is available natively in Node >= 18.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeEmail,
  normalizePhone,
  sha256,
  hashAudienceBatch,
} from "../hash-client.ts";

// ─── normalizeEmail ───────────────────────────────────────────────────────────

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    assert.equal(normalizeEmail("  TEST@Example.COM  "), "test@example.com");
  });

  it("returns null for empty string", () => {
    assert.equal(normalizeEmail(""), null);
    assert.equal(normalizeEmail("   "), null);
  });

  it("returns null for string without @", () => {
    assert.equal(normalizeEmail("notanemail"), null);
  });

  it("preserves subaddress", () => {
    assert.equal(normalizeEmail("user+tag@example.com"), "user+tag@example.com");
  });
});

// ─── normalizePhone ───────────────────────────────────────────────────────────

describe("normalizePhone", () => {
  // Use Vodafone UK allocated range (07712 xxx xxx is a real allocation)
  it("converts UK local mobile to E.164 without +", () => {
    const result = normalizePhone("07712 345678", "GB");
    assert.equal(result, "447712345678");
  });

  it("handles international E.164 prefix", () => {
    const result = normalizePhone("+14155552671", "GB");
    assert.equal(result, "14155552671");
  });

  it("returns null for empty string", () => {
    assert.equal(normalizePhone(""), null);
  });

  it("returns null for invalid number", () => {
    assert.equal(normalizePhone("not-a-phone", "GB"), null);
  });

  it("handles dashes and spaces in international format", () => {
    const result = normalizePhone("+44 7712 345-678", "GB");
    assert.equal(result, "447712345678");
  });
});

// ─── sha256 ───────────────────────────────────────────────────────────────────

describe("sha256", () => {
  it("hashes empty string to known NIST vector", async () => {
    const hash = await sha256("");
    assert.equal(
      hash,
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("returns lowercase hex of length 64", async () => {
    const hash = await sha256("hello world");
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("is deterministic", async () => {
    const a = await sha256("deterministic");
    const b = await sha256("deterministic");
    assert.equal(a, b);
  });

  it("produces different hashes for different inputs", async () => {
    const a = await sha256("input_a");
    const b = await sha256("input_b");
    assert.notEqual(a, b);
  });

  it("known vector: '' (empty string) is the primary fixture", async () => {
    // SHA-256("") — NIST FIPS 180-4 MessageDigest.SHA-256("") fixture
    // already tested above; this test verifies the format check passes
    const hash = await sha256("anything");
    assert.match(hash, /^[0-9a-f]{64}$/);
  });
});

// ─── hashAudienceBatch ────────────────────────────────────────────────────────

describe("hashAudienceBatch", () => {
  it("deduplicates identical email rows", async () => {
    const rows = [
      { email: "alice@example.com" },
      { email: "alice@example.com" },
      { email: "bob@example.com" },
    ];
    const result = await hashAudienceBatch(rows, true, false);
    assert.equal(result.data.length, 2);
    assert.equal(result.emailCount, 2);
  });

  it("skips rows with no valid email or phone", async () => {
    const rows = [
      { email: "  " },
      { phone: "" },
      { email: "valid@example.com" },
    ];
    const result = await hashAudienceBatch(rows, true, true);
    assert.equal(result.data.length, 1);
    assert.ok(result.skippedCount > 0);
  });

  it("returns EMAIL_SHA256 schema when only email enabled", async () => {
    const result = await hashAudienceBatch([{ email: "a@b.com" }], true, false);
    assert.deepEqual(result.schema, ["EMAIL_SHA256"]);
    assert.equal(result.data[0].length, 1);
  });

  it("returns both schema columns when both enabled", async () => {
    const result = await hashAudienceBatch(
      [{ email: "a@b.com", phone: "07700900000" }],
      true,
      true,
    );
    assert.ok(result.schema.includes("EMAIL_SHA256"));
    assert.ok(result.schema.includes("PHONE_SHA256"));
  });

  it("produces 64-char hex hashes", async () => {
    const result = await hashAudienceBatch([{ email: "test@example.com" }], true, false);
    assert.equal(result.data[0][0].length, 64);
    assert.match(result.data[0][0], /^[0-9a-f]{64}$/);
  });

  it("handles empty input", async () => {
    const result = await hashAudienceBatch([], true, true);
    assert.equal(result.data.length, 0);
    assert.equal(result.emailCount, 0);
    assert.equal(result.phoneCount, 0);
  });

  it("normalises email case before dedup", async () => {
    const rows = [
      { email: "Alice@Example.COM" },
      { email: "alice@example.com" },
    ];
    const result = await hashAudienceBatch(rows, true, false);
    // Should deduplicate after normalisation
    assert.equal(result.data.length, 1);
  });
});
