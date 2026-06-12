/**
 * Unit tests for lib/meta/ig-actor-validator.ts
 *
 * Mocks global.fetch — no real Meta API calls. Covers:
 *   - BM-asset match        → igId returned
 *   - BM-asset empty + page-level match → igId returned (page-level fallback)
 *   - BM-asset empty + page-level empty → null (b57a98e protection)
 *   - BM-asset empty + no page token    → null (graceful, no page-level fetch)
 *   - BM API error          → falls through to page-level
 *   - Page API error        → null (graceful, does not throw)
 *   - Network failure       → null (graceful, does not throw)
 *   - Caching: BM fetch at most once per validator instance
 *   - Caching: page-level fetch at most once per unique pageId
 *   - Empty igActorId       → null immediately (no fetch)
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

const BM_URL_FRAGMENT = "/instagram_accounts";
const PAGE_ID = "202868440480679";
const IG_ID = "17841407313865620";
const PAGE_TOKEN = "page_tok_abc";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createIgActorValidator", () => {
  beforeEach(() => {
    mock.restoreAll();
  });

  afterEach(() => {
    mock.restoreAll();
  });

  // ── BM-asset path ──────────────────────────────────────────────────────────

  it("returns igActorId when it is in the BM-asset authorised list", async () => {
    mock.method(global, "fetch", async () =>
      makeIgAccountsResponse(["1750802446345627", "9999000000000001"]),
    );

    const validator = createIgActorValidator("ACT_123", "tok_abc");
    const result = await validator.validate("1750802446345627");
    assert.equal(result, "1750802446345627");
  });

  it("returns null when igActorId is NOT in BM list and no pageId provided", async () => {
    mock.method(global, "fetch", async () => makeIgAccountsResponse([]));

    const validator = createIgActorValidator("ACT_456", "tok_xyz");
    const result = await validator.validate("UNAUTHORIZED_IG_ID");
    assert.equal(
      result,
      null,
      "must return null — no page fallback available and id not in BM list",
    );
  });

  // ── Page-level fallback ────────────────────────────────────────────────────

  it("returns igActorId via page-level fallback when BM list is empty (4thefans scenario)", async () => {
    // BM list: empty. Page list: has the IG id. This is the PR #567 root-cause fix.
    let callIdx = 0;
    mock.method(global, "fetch", async (url: string) => {
      callIdx++;
      if (url.includes(`/act_`)) {
        // BM-asset endpoint — 4thefans has IG linked to Page but not BM
        return makeIgAccountsResponse([]);
      }
      // Page-level endpoint
      return makeIgAccountsResponse([IG_ID]);
    });

    const validator = createIgActorValidator("act_10151014958791885", "tok_launch");
    const result = await validator.validate(IG_ID, { pageId: PAGE_ID, pageToken: PAGE_TOKEN });
    assert.equal(result, IG_ID, "page-level fallback must return the IG id");
    assert.equal(callIdx, 2, "should call BM endpoint then page endpoint");
  });

  it("returns null when BM list is empty AND page-level list is also empty (b57a98e protection)", async () => {
    mock.method(global, "fetch", async () => makeIgAccountsResponse([]));

    const validator = createIgActorValidator("ACT_789", "tok_xyz");
    const result = await validator.validate("UNAUTHORIZED_IG_ID", {
      pageId: PAGE_ID,
      pageToken: PAGE_TOKEN,
    });
    assert.equal(
      result,
      null,
      "must return null — genuinely unauthorised actor (b57a98e protection)",
    );
  });

  it("returns null when BM list is empty and pageToken is null (no page-level attempt)", async () => {
    let pageEndpointCalled = false;
    mock.method(global, "fetch", async (url: string) => {
      if (!url.includes("/act_")) pageEndpointCalled = true;
      return makeIgAccountsResponse([]);
    });

    const validator = createIgActorValidator("ACT_000", "tok_no_page");
    const result = await validator.validate(IG_ID, { pageId: PAGE_ID, pageToken: null });
    assert.equal(result, null);
    assert.equal(pageEndpointCalled, false, "should NOT call page endpoint when pageToken is null");
  });

  it("returns null when BM list is empty and no opts provided (backward compat)", async () => {
    mock.method(global, "fetch", async () => makeIgAccountsResponse([]));

    const validator = createIgActorValidator("ACT_001", "tok_compat");
    const result = await validator.validate(IG_ID);
    assert.equal(result, null);
  });

  // ── BM error → page-level fallback ────────────────────────────────────────

  it("falls through to page-level when BM API returns non-200", async () => {
    let callIdx = 0;
    mock.method(global, "fetch", async (url: string) => {
      callIdx++;
      if (url.includes("/act_")) return makeErrorResponse(403);
      return makeIgAccountsResponse([IG_ID]);
    });

    const validator = createIgActorValidator("ACT_ERR", "tok_err");
    const result = await validator.validate(IG_ID, { pageId: PAGE_ID, pageToken: PAGE_TOKEN });
    assert.equal(result, IG_ID, "page-level fallback must succeed when BM API errors");
  });

  it("returns null when BM errors AND page-level API also returns non-200", async () => {
    mock.method(global, "fetch", async () => makeErrorResponse(429));

    const validator = createIgActorValidator("ACT_ERR2", "tok_err2");
    const result = await validator.validate(IG_ID, { pageId: PAGE_ID, pageToken: PAGE_TOKEN });
    assert.equal(result, null);
  });

  it("returns null when fetch throws network error (graceful degradation)", async () => {
    mock.method(global, "fetch", async () => {
      throw new Error("ECONNREFUSED");
    });

    const validator = createIgActorValidator("ACT_NET", "tok_net");
    const result = await validator.validate("ANY_ID", { pageId: PAGE_ID, pageToken: PAGE_TOKEN });
    assert.equal(result, null);
  });

  // ── Caching ────────────────────────────────────────────────────────────────

  it("fetches BM /instagram_accounts only ONCE across multiple validate() calls", async () => {
    let fetchCount = 0;
    mock.method(global, "fetch", async () => {
      fetchCount++;
      return makeIgAccountsResponse(["IG_ACTOR_A", "IG_ACTOR_B"]);
    });

    const validator = createIgActorValidator("ACT_CACHE", "tok_cache");
    await validator.validate("IG_ACTOR_A");
    await validator.validate("IG_ACTOR_B");
    await validator.validate("IG_ACTOR_A"); // repeated — must still hit cache

    assert.equal(fetchCount, 1, "BM /instagram_accounts should be fetched exactly once");
  });

  it("fetches page-level /instagram_accounts only ONCE per pageId", async () => {
    let fetchCount = 0;
    mock.method(global, "fetch", async (url: string) => {
      fetchCount++;
      if (url.includes("/act_")) return makeIgAccountsResponse([]); // BM empty
      return makeIgAccountsResponse([IG_ID, "OTHER_IG"]);
    });

    const validator = createIgActorValidator("ACT_PAGE_CACHE", "tok_cache");
    // Two different IG ids on the same page — page endpoint fetched once only.
    await validator.validate(IG_ID, { pageId: PAGE_ID, pageToken: PAGE_TOKEN });
    await validator.validate("OTHER_IG", { pageId: PAGE_ID, pageToken: PAGE_TOKEN });

    // 1 BM fetch + 1 page fetch = 2 total
    assert.equal(fetchCount, 2, "BM fetched once and page-level fetched once (shared cache)");
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

  it("accepts operator override via page-level list even when BM list is empty", async () => {
    mock.method(global, "fetch", async (url: string) => {
      if (url.includes("/act_")) return makeIgAccountsResponse([]);
      return makeIgAccountsResponse([IG_ID]);
    });

    const validator = createIgActorValidator("ACT_OVERRIDE", "tok_override");
    const result = await validator.validate(IG_ID, {
      pageId: PAGE_ID,
      pageToken: PAGE_TOKEN,
      operatorOverrideId: IG_ID,
    });
    assert.equal(result, IG_ID);
  });
});
