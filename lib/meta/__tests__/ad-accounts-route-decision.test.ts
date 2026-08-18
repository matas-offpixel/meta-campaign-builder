/**
 * Unit tests for decideAdAccountsRouteResponse — the /api/meta/ad-accounts
 * stale-cache fallback decision (follow-up to PR #784).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideAdAccountsRouteResponse } from "../ad-accounts-route-decision.ts";
import { classifyEnrichError } from "../fetch-ad-accounts.ts";
import type { MetaAdAccount } from "../../types.ts";

function acct(id: string): MetaAdAccount {
  return {
    id,
    name: `Account ${id}`,
    account_id: id.replace(/^act_/, ""),
    currency: "GBP",
    account_status: 1,
    timezone_name: "Europe/London",
  };
}

const isRateLimited = (err: unknown) => classifyEnrichError(err).rateLimited;

describe("decideAdAccountsRouteResponse", () => {
  it("fresh success → upsert cache", () => {
    const live = [acct("act_1"), acct("act_2")];
    const decision = decideAdAccountsRouteResponse({
      liveAccounts: live,
      liveError: null,
      cached: null,
      isRateLimited,
    });
    assert.equal(decision.kind, "fresh");
    if (decision.kind !== "fresh") return;
    assert.equal(decision.shouldUpsertCache, true);
    assert.equal(decision.accounts.length, 2);
  });

  it("fresh success still upserts even when a cache already exists", () => {
    const live = [acct("act_fresh")];
    const decision = decideAdAccountsRouteResponse({
      liveAccounts: live,
      liveError: null,
      cached: {
        accounts: [acct("act_old")],
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      isRateLimited,
    });
    assert.equal(decision.kind, "fresh");
    if (decision.kind !== "fresh") return;
    assert.equal(decision.shouldUpsertCache, true);
    assert.equal(decision.accounts[0]!.id, "act_fresh");
  });

  it("rate-limited failure + cache → stale list", () => {
    const cachedAccounts = [acct("act_cached_a"), acct("act_cached_b")];
    const decision = decideAdAccountsRouteResponse({
      liveAccounts: null,
      liveError: {
        name: "MetaApiError",
        message: "There have been too many calls to this ad-account",
        code: 17,
      },
      cached: {
        accounts: cachedAccounts,
        updatedAt: "2026-08-18T12:00:00.000Z",
      },
      isRateLimited,
    });
    assert.equal(decision.kind, "stale");
    if (decision.kind !== "stale") return;
    assert.equal(decision.shouldUpsertCache, false);
    assert.equal(decision.staleAsOf, "2026-08-18T12:00:00.000Z");
    assert.deepEqual(
      decision.accounts.map((a) => a.id),
      ["act_cached_a", "act_cached_b"],
    );
  });

  it("rate-limited failure + no cache → error passthrough", () => {
    const err = {
      name: "MetaApiError",
      message: "There have been too many calls to this ad-account",
      code: 17,
    };
    const decision = decideAdAccountsRouteResponse({
      liveAccounts: null,
      liveError: err,
      cached: null,
      isRateLimited,
    });
    assert.equal(decision.kind, "error");
    if (decision.kind !== "error") return;
    assert.equal(decision.shouldUpsertCache, false);
    assert.equal(decision.err, err);
  });

  it("non-rate-limit failure + cache → error passthrough (do not serve stale)", () => {
    const err = {
      name: "MetaApiError",
      message: "Invalid OAuth token",
      code: 190,
    };
    const decision = decideAdAccountsRouteResponse({
      liveAccounts: null,
      liveError: err,
      cached: {
        accounts: [acct("act_cached")],
        updatedAt: "2026-08-18T12:00:00.000Z",
      },
      isRateLimited,
    });
    assert.equal(decision.kind, "error");
    if (decision.kind !== "error") return;
    assert.equal(decision.err, err);
  });
});
