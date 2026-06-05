/**
 * RED regression test for the IG-actor-validator double `act_` prefix bug.
 *
 * Root cause (see docs/AUDIT_IG_VALIDATOR_POST_MERGE_2026-06-05.md):
 *   `createIgActorValidator` hand-rolls the Graph URL as `act_${adAccountId}`.
 *   But `adAccountId` is stored WITH the `act_` prefix everywhere in the launch
 *   routes (the same value is passed to createMetaCreative/createMetaAd, which
 *   use the idempotent `withActPrefix`). So the validator requests
 *   `/act_act_{id}/instagram_accounts` → Graph returns HTTP 400 → the validator
 *   treats the account as having zero authorised IG accounts → returns null →
 *   `instagram_actor_id` is omitted → Meta /ads rejects with code=100
 *   subcode=1772103.
 *
 * Proven against the live Graph API (account-independent):
 *   GET /act_932846012721428/instagram_accounts      → HTTP 200
 *   GET /act_act_932846012721428/instagram_accounts  → HTTP 400 (code=100, subcode=33)
 *
 * THIS TEST IS INTENTIONALLY RED on current main (the URL is double-prefixed)
 * and turns green once the validator uses `withActPrefix(adAccountId)`.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { createIgActorValidator } from "../ig-actor-validator.ts";

describe("ig-actor-validator does not double-prefix the ad account id (regression: 1772103)", () => {
  afterEach(() => mock.restoreAll());

  it("requests /act_{id}/instagram_accounts with a SINGLE act_ prefix when the id is already prefixed", async () => {
    let requestedUrl = "";
    mock.method(global, "fetch", async (input: string | URL | Request) => {
      requestedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify({ data: [{ id: "1318484633042193" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    // adAccountId as actually stored in drafts / env (already prefixed).
    const validator = createIgActorValidator("act_932846012721428", "tok_abc");
    await validator.validate("1318484633042193");

    assert.ok(
      requestedUrl.includes("/act_932846012721428/instagram_accounts"),
      `validator must call the single-prefixed path; got: ${requestedUrl}`,
    );
    assert.ok(
      !requestedUrl.includes("act_act_"),
      `validator must NOT double-prefix the ad account id (act_act_…); got: ${requestedUrl}`,
    );
  });

  it("returns the actor id when the (correctly-prefixed) endpoint lists it", async () => {
    mock.method(global, "fetch", async () =>
      new Response(JSON.stringify({ data: [{ id: "1318484633042193" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const validator = createIgActorValidator("act_932846012721428", "tok_abc");
    const result = await validator.validate("1318484633042193");

    // On current main the URL is act_act_… but the mock ignores the URL and
    // returns the list anyway, so this assertion passes today. The FIRST test
    // is the one that goes RED on main. This guards the happy path post-fix.
    assert.equal(result, "1318484633042193");
  });
});
