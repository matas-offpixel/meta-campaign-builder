/**
 * lib/meta/__tests__/business-manager-grant-url.test.ts
 *
 * Regression guard for the 2026-07-09 BM grant bug: `grantUserPagePermission`
 * originally posted to `/{bizId}/pages/{pageId}/user_permissions` with a
 * `role` field. That three-segment path is not a real Graph API edge (Meta
 * deprecated the old `{business-id}/userpermissions` scheme in v2.11), so
 * every live grant against LWE's Business Manager failed with "Unknown path
 * components".
 *
 * The correct edge is `POST /{pageId}/assigned_users` with `user` + a
 * `tasks` array — no business id in the path. This test byte-diffs the
 * built path + JSON body so this exact mistake can't silently recur.
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
const TARGET_USER_ID = "10222222222222222";

describe("buildGrantUserPagePermissionRequest — grant URL regression guard", () => {
  it("builds POST /{pageId}/assigned_users, NOT /{bizId}/pages/{pageId}/user_permissions", () => {
    const req = buildGrantUserPagePermissionRequest(PAGE_ID, TARGET_USER_ID, "ADVERTISER");

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

    // Byte-diff the body: `user` + `tasks` array, no `role` field.
    assert.deepEqual(req.body, { user: TARGET_USER_ID, tasks: ["ADVERTISE"] });
    assert.equal(
      (req.body as Record<string, unknown>).role,
      undefined,
      "must not send a 'role' field — Meta ignores it; it wants 'tasks'",
    );
  });

  it("maps every BMPageRole to its Meta task", () => {
    const cases: Array<["ADVERTISER" | "ANALYST" | "EDITOR" | "ADMIN", string[]]> = [
      ["ADVERTISER", ["ADVERTISE"]],
      ["ANALYST", ["ANALYZE"]],
      ["EDITOR", ["CREATE_CONTENT"]],
      ["ADMIN", ["MANAGE"]],
    ];

    for (const [role, tasks] of cases) {
      const req = buildGrantUserPagePermissionRequest(PAGE_ID, TARGET_USER_ID, role);
      assert.deepEqual(req.body.tasks, tasks, `role ${role} should map to tasks ${tasks}`);
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
