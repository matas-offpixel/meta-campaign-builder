/**
 * Unit tests for lib/meta/ig-actor-validator.ts
 *
 * Mocks global.fetch — no real Meta API calls. Covers:
 *   - Authorised actor id → returned as-is
 *   - Unauthorised actor id (not in list) → null  [b57a98e protection]
 *   - Network / API failure → null (graceful, does not throw)
 *   - Caching: fetch called at most once per validator instance
 *   - Empty igActorId → null immediately (no fetch)
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { createIgActorValidator } from "../ig-actor-validator.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIgAccountsResponse(ids: string[]): Response {
  return new Response(
    JSON.stringify({ data: ids.map((id) => ({ id })) }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function makeErrorResponse(status: number): Response {
  return new Response(JSON.stringify({ error: "meta_error" }), { status });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createIgActorValidator", () => {
  beforeEach(() => {
    // Reset fetch mock before each test
    mock.restoreAll();
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("returns igActorId when it is in the authorised list", async () => {
    mock.method(global, "fetch", async () =>
      makeIgAccountsResponse(["1750802446345627", "9999000000000001"]),
    );

    const validator = createIgActorValidator("ACT_123", "tok_abc");
    const result = await validator.validate("1750802446345627");
    assert.equal(result, "1750802446345627");
  });

  it("returns null when igActorId is NOT in the authorised list (b57a98e protection)", async () => {
    // Empty list → unauthorised
    mock.method(global, "fetch", async () => makeIgAccountsResponse([]));

    const validator = createIgActorValidator("ACT_456", "tok_xyz");
    const result = await validator.validate("UNAUTHORIZED_IG_ID");
    assert.equal(
      result,
      null,
      "must return null for unauthorised actor — sending it to Meta causes code=100 (b57a98e regression)",
    );
  });

  it("returns null when Meta returns a non-200 status (graceful degradation)", async () => {
    mock.method(global, "fetch", async () => makeErrorResponse(403));

    const validator = createIgActorValidator("ACT_789", "tok_bad");
    const result = await validator.validate("ANY_ID");
    assert.equal(result, null);
  });

  it("returns null when fetch throws a network error (graceful degradation)", async () => {
    mock.method(global, "fetch", async () => {
      throw new Error("ECONNREFUSED");
    });

    const validator = createIgActorValidator("ACT_000", "tok_net");
    const result = await validator.validate("ANY_ID");
    assert.equal(result, null);
  });

  it("fetches /instagram_accounts only ONCE across multiple validate() calls (per-launch cache)", async () => {
    let fetchCount = 0;
    mock.method(global, "fetch", async () => {
      fetchCount++;
      return makeIgAccountsResponse(["IG_ACTOR_A", "IG_ACTOR_B"]);
    });

    const validator = createIgActorValidator("ACT_CACHE", "tok_cache");
    await validator.validate("IG_ACTOR_A");
    await validator.validate("IG_ACTOR_B");
    await validator.validate("IG_ACTOR_A"); // repeated — must still hit cache

    assert.equal(fetchCount, 1, "should fetch /instagram_accounts exactly once regardless of how many validate() calls are made");
  });

  it("returns null immediately for empty igActorId without fetching", async () => {
    let fetchCount = 0;
    mock.method(global, "fetch", async () => {
      fetchCount++;
      return makeIgAccountsResponse(["SOMETHING"]);
    });

    const validator = createIgActorValidator("ACT_EMPTY", "tok_empty");
    const result = await validator.validate("");
    assert.equal(result, null);
    assert.equal(fetchCount, 0, "should not fetch when igActorId is empty string");
  });
});
