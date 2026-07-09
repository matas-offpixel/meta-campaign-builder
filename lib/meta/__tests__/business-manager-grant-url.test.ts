/**
 * lib/meta/__tests__/business-manager-grant-url.test.ts
 *
 * Regression guard for two BM grant bugs, in order:
 *
 * 1. (2026-07-09, PR #708) `grantUserPagePermission` originally posted to
 *    `/{bizId}/pages/{pageId}/user_permissions` with a `role` field. That
 *    three-segment path is not a real Graph API edge (Meta deprecated the
 *    old `{business-id}/userpermissions` scheme in v2.11) — every live
 *    grant against LWE's Business Manager failed with "Unknown path
 *    components". Fixed by moving to `POST /{pageId}/assigned_users`.
 * 2. (2026-07-09, PR #709) that edge REQUIRES a `business` field in the
 *    body alongside `user` + `tasks` — omitting it doesn't 404, it fails
 *    live with Meta code 100 "Invalid parameter". `business` must be a
 *    param the builder always includes, for every role.
 *
 * This test byte-diffs the built path + JSON body so neither mistake can
 * silently recur. It does NOT cover a third bug found after #709 — Meta
 * subcode 1752100 "User is not business-scoped" — because that's about
 * WHICH id gets passed in as `targetUserId` (a business-scoped id, resolved
 * by `resolveBusinessScopedUserId`), not the shape this builder produces.
 * `TARGET_USER_ID` below stands in for that resolved business-scoped id;
 * see `business-scoped-user-id.test.ts` for the resolution-logic coverage.
 *
 * Imports the PURE builder from `business-manager-grant-request.ts` (not
 * `business-manager.ts`, which imports `client.ts` and its TypeScript-
 * parameter-property `MetaApiError` class — unsupported in Node's
 * `--experimental-strip-types` test mode; same rationale as
 * `error-classify.ts`).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildGrantUserPagePermissionRequest } from "../business-manager-grant-request.ts";

const PAGE_ID = "202868440480679";
const BIZ_ID = "741799859254067"; // LWE Business Manager (from the live test report)
// Stands in for a resolved BUSINESS-SCOPED user id (resolveBusinessScopedUserId's
// output) — NOT the Facebook-level id getMetaUserId returns. This builder is
// id-source-agnostic; it just needs a string in the `user` slot.
const TARGET_USER_ID = "10222222222222222";

describe("buildGrantUserPagePermissionRequest — grant URL regression guard", () => {
  it("builds POST /{pageId}/assigned_users with business+user+tasks, NOT /{bizId}/pages/{pageId}/user_permissions", () => {
    const req = buildGrantUserPagePermissionRequest(PAGE_ID, BIZ_ID, TARGET_USER_ID, "ADVERTISER");

    // Byte-diff the path against the exact expected string. Deliberately
    // NOT a substring/regex check — a regression that reintroduces the old
    // "/pages/" + "/user_permissions" shape must fail this outright.
    assert.equal(req.path, `/${PAGE_ID}/assigned_users`);
    assert.ok(
      !req.path.includes("/user_permissions"),
      "must not hit the deprecated /user_permissions edge",
    );
    assert.ok(
      !req.path.includes("/pages/"),
      "must not nest pageId under a /pages/ segment — that edge does not exist",
    );

    // Byte-diff the body: `business` + `user` + `tasks` array, no `role` field.
    assert.deepEqual(req.body, {
      business: BIZ_ID,
      user: TARGET_USER_ID,
      tasks: ["ADVERTISE"],
    });
    assert.equal(
      (req.body as Record<string, unknown>).role,
      undefined,
      "must not send a 'role' field — Meta ignores it; it wants 'tasks'",
    );

    // Regression guard: `business` is a required param — code 100 "Invalid
    // parameter" if missing/blank. Assert it's present and non-empty rather
    // than just checking the field exists.
    assert.equal(req.body.business, BIZ_ID);
    assert.ok(req.body.business.length > 0, "business must never be missing/blank");
  });

  it("maps every BMPageRole to its Meta task, and always includes business", () => {
    const cases: Array<["ADVERTISER" | "ANALYST" | "EDITOR" | "ADMIN", string[]]> = [
      ["ADVERTISER", ["ADVERTISE"]],
      ["ANALYST", ["ANALYZE"]],
      ["EDITOR", ["CREATE_CONTENT"]],
      ["ADMIN", ["MANAGE"]],
    ];

    for (const [role, tasks] of cases) {
      const req = buildGrantUserPagePermissionRequest(PAGE_ID, BIZ_ID, TARGET_USER_ID, role);
      assert.deepEqual(req.body.tasks, tasks, `role ${role} should map to tasks ${tasks}`);
      // business must never be dropped, regardless of which role is granted.
      assert.equal(req.body.business, BIZ_ID, `role ${role} must still send business`);
    }
  });
});

// Note: an end-to-end test that mocks fetch through the real
// `grantUserPagePermission` (business-manager.ts) was intentionally omitted.
// That module imports `client.ts`, whose `MetaApiError` class uses a
// TypeScript parameter-property constructor — unsupported by Node's
// `--experimental-strip-types` test runner regardless of whether the import
// is static or dynamic. `business-manager.ts` itself calls
// `buildGrantUserPagePermissionRequest` verbatim before handing the result
// to `graphPostWithToken`, so the pure-builder coverage above is
// byte-equivalent to testing the real function's request shape.
