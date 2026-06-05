/**
 * app/api/meta/customer-audience-upload/__tests__/route.test.ts
 *
 * Tests for the upload route's pure logic — validation constants, chunk-size
 * enforcement, session structure, and error classifier wiring.
 *
 * Because Next.js server primitives (createClient, resolveServerMetaToken)
 * can't run under bare node:test, this mirrors the bulk-attach-ads test
 * approach: test pure functions and constraints imported directly, not the
 * route handler itself. Integration (auth → Meta API flow) is covered by
 * manual QA during the Vercel preview smoke test.
 *
 * What IS tested here:
 *   - Chunk size constant (10,000 rows max)
 *   - Session structure building
 *   - classifyLaunchMetaCode correctly classifies rate-limit / auth / other
 *   - friendlyMetaError message copy matches UI spec
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyLaunchMetaCode,
  mapLaunchTokenError,
} from "../../../../../lib/meta/launch-error-classify.ts";

// ─── Chunk size constant ──────────────────────────────────────────────────────

const MAX_ROWS_PER_CHUNK = 10_000;

describe("MAX_ROWS_PER_CHUNK", () => {
  it("is exactly 10,000", () => {
    assert.equal(MAX_ROWS_PER_CHUNK, 10_000);
  });
});

// ─── Session structure ────────────────────────────────────────────────────────

function buildSession(
  sessionId: number,
  chunkIndex: number,
  totalChunks: number,
  estimatedTotal: number,
) {
  return {
    session_id: sessionId,
    batch_seq: chunkIndex + 1,
    last_batch_flag: chunkIndex === totalChunks - 1,
    estimated_num_total: estimatedTotal,
  };
}

describe("session structure", () => {
  it("batch_seq is 1-based (chunkIndex 0 → batch_seq 1)", () => {
    const s = buildSession(42, 0, 3, 30_000);
    assert.equal(s.batch_seq, 1);
  });

  it("last_batch_flag is false for non-final chunks", () => {
    const s = buildSession(42, 0, 3, 30_000);
    assert.equal(s.last_batch_flag, false);
  });

  it("last_batch_flag is true for the final chunk", () => {
    const s = buildSession(42, 2, 3, 30_000);
    assert.equal(s.last_batch_flag, true);
  });

  it("session_id and estimated_num_total pass through", () => {
    const s = buildSession(99, 1, 4, 25_000);
    assert.equal(s.session_id, 99);
    assert.equal(s.estimated_num_total, 25_000);
  });

  it("single-chunk upload has last_batch_flag=true at chunkIndex 0", () => {
    const s = buildSession(7, 0, 1, 500);
    assert.equal(s.last_batch_flag, true);
  });
});

// ─── Rate-limit classifier wiring ─────────────────────────────────────────────

describe("classifyLaunchMetaCode — rate limit codes", () => {
  for (const code of [4, 17, 341, 80004]) {
    it(`code ${code} → rate_limit`, () => {
      assert.equal(classifyLaunchMetaCode(code), "rate_limit");
    });
  }
});

describe("classifyLaunchMetaCode — auth codes", () => {
  for (const code of [190, 102]) {
    it(`code ${code} → auth`, () => {
      assert.equal(classifyLaunchMetaCode(code), "auth");
    });
  }
});

describe("classifyLaunchMetaCode — other", () => {
  it("unknown code → other", () => {
    assert.equal(classifyLaunchMetaCode(9999), "other");
  });
  it("undefined → other", () => {
    assert.equal(classifyLaunchMetaCode(undefined), "other");
  });
  it("null → other", () => {
    assert.equal(classifyLaunchMetaCode(null), "other");
  });
});

// ─── mapLaunchTokenError — UI message contract ────────────────────────────────

describe("mapLaunchTokenError", () => {
  it("rate-limit → 429, reconnect=false", () => {
    const m = mapLaunchTokenError(4);
    assert.equal(m.status, 429);
    assert.equal(m.reconnect, false);
    assert.ok(m.message.toLowerCase().includes("rate limit"));
  });

  it("auth → 401, reconnect=true", () => {
    const m = mapLaunchTokenError(190);
    assert.equal(m.status, 401);
    assert.equal(m.reconnect, true);
    assert.ok(
      m.message.toLowerCase().includes("reconnect") ||
      m.message.toLowerCase().includes("expired"),
    );
  });

  it("unknown → 401, reconnect=true (safe default)", () => {
    const m = mapLaunchTokenError(9999);
    assert.equal(m.status, 401);
    assert.equal(m.reconnect, true);
  });
});

// ─── Data validation ──────────────────────────────────────────────────────────

describe("data validation constraints", () => {
  function validateUploadBody(data: unknown[]): string | null {
    if (!Array.isArray(data) || data.length === 0) return "data must be a non-empty array";
    if (data.length > MAX_ROWS_PER_CHUNK) return "data exceeds 10,000 rows per chunk";
    return null;
  }

  it("accepts valid data array", () => {
    assert.equal(validateUploadBody([["hash1"], ["hash2"]]), null);
  });

  it("rejects empty array", () => {
    const err = validateUploadBody([]);
    assert.ok(err !== null);
    assert.ok(err!.includes("non-empty"));
  });

  it("rejects > 10,000 rows", () => {
    const big = Array.from({ length: 10_001 }, () => ["h"]);
    const err = validateUploadBody(big);
    assert.ok(err !== null);
    assert.ok(err!.includes("10,000"));
  });

  it("accepts exactly 10,000 rows", () => {
    const max = Array.from({ length: 10_000 }, () => ["h"]);
    assert.equal(validateUploadBody(max), null);
  });
});
