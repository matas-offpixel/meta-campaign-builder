/**
 * lib/meta/__tests__/business-scoped-user-id.test.ts
 *
 * Regression guard for the 2026-07-09 BM grant bug: grants against LWE's
 * Business Manager failed with Meta subcode 1752100 "User is not
 * business-scoped" even after PR #709 fixed the request body shape.
 * `getMetaUserId` (`GET /me?fields=id`) returns a Facebook-level user id;
 * Meta's `POST /{page_id}/assigned_users` edge requires a BUSINESS-SCOPED
 * user id — a distinct alias per Business Manager.
 *
 * Tests the two PURE matching helpers `resolveBusinessScopedUserId`
 * (`lib/meta/business-manager.ts`) delegates to. Imported directly (not via
 * `business-manager.ts`, which imports `client.ts`'s TypeScript-parameter-
 * property `MetaApiError` class — unsupported in Node's
 * `--experimental-strip-types` test mode).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  pickBusinessScopedUserIdByName,
  pickBusinessScopedUserIdFromMe,
} from "../business-scoped-user-id.ts";

const LWE_BIZ_ID = "741799859254067"; // from the live test report
const OTHER_BIZ_ID = "9999999999999";

describe("pickBusinessScopedUserIdFromMe — Option B (GET /me business_users)", () => {
  it("returns the id scoped to the requested business", () => {
    const associations = [
      { id: "10111111111111111", business: { id: OTHER_BIZ_ID } },
      { id: "10222222222222222", business: { id: LWE_BIZ_ID } },
    ];
    assert.equal(pickBusinessScopedUserIdFromMe(associations, LWE_BIZ_ID), "10222222222222222");
  });

  it("returns undefined when no association matches the business id", () => {
    const associations = [{ id: "10111111111111111", business: { id: OTHER_BIZ_ID } }];
    assert.equal(pickBusinessScopedUserIdFromMe(associations, LWE_BIZ_ID), undefined);
  });

  it("returns undefined for a matching business with no id (never returns a falsy id)", () => {
    const associations = [{ id: undefined, business: { id: LWE_BIZ_ID } }];
    assert.equal(pickBusinessScopedUserIdFromMe(associations, LWE_BIZ_ID), undefined);
  });

  it("returns undefined when business_users is missing/empty", () => {
    assert.equal(pickBusinessScopedUserIdFromMe(undefined, LWE_BIZ_ID), undefined);
    assert.equal(pickBusinessScopedUserIdFromMe([], LWE_BIZ_ID), undefined);
  });
});

describe("pickBusinessScopedUserIdByName — Option A fallback (GET /{bizId}/business_users)", () => {
  it("returns the id of the member whose name matches", () => {
    const members = [
      { id: "20111111111111111", name: "Someone Else" },
      { id: "20222222222222222", name: "Matas Petrikas" },
    ];
    assert.equal(
      pickBusinessScopedUserIdByName(members, "Matas Petrikas"),
      "20222222222222222",
    );
  });

  it("returns undefined when no member's name matches", () => {
    const members = [{ id: "20111111111111111", name: "Someone Else" }];
    assert.equal(pickBusinessScopedUserIdByName(members, "Matas Petrikas"), undefined);
  });

  it("never guesses — returns undefined when meName is missing/blank", () => {
    const members = [{ id: "20111111111111111", name: "Matas Petrikas" }];
    assert.equal(pickBusinessScopedUserIdByName(members, undefined), undefined);
    assert.equal(pickBusinessScopedUserIdByName(members, ""), undefined);
  });

  it("skips a name match with no id", () => {
    const members = [{ id: undefined, name: "Matas Petrikas" }];
    assert.equal(pickBusinessScopedUserIdByName(members, "Matas Petrikas"), undefined);
  });
});
