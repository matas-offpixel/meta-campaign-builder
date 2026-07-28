import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * `lib/audiences/seed-remediation.ts` is `server-only` and imports through `@/`,
 * so it cannot be executed under the strip-types test runner. These are source
 * assertions on the constraints that would be expensive to get wrong — each one
 * corresponds to a real hazard that has already bitten this codebase once.
 */
/**
 * Comments stripped: these assertions are about what the CODE does. Prose
 * explaining why a token or task is deliberately absent must not read as its
 * presence — the first run of this file failed on its own doc comment.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const SOURCE = code("lib/audiences/seed-remediation.ts");
const DB_SOURCE = code("lib/db/business-managers.ts");

describe("seed remediation constraints", () => {
  it("grants ADVERTISE and nothing stronger", () => {
    assert.match(SOURCE, /PAGE_TASK_ADVERTISE/);
    assert.doesNotMatch(SOURCE, /FULL_CONTROL/);
    // Verified live: ADVERTISE alone clears subcode 1713140, so escalating would
    // hand out owner-level rights on a client's page for no benefit.
  });

  it("routes the task set through the #727 validator before calling Meta", () => {
    assert.match(SOURCE, /validatePageTasks/);
  });

  it("never falls back to the system token", () => {
    // The BM tool acts as the operator's own identity or not at all; a system-user
    // token would grant access on behalf of someone who never authorised it.
    assert.match(SOURCE, /getBusinessManagerToken/);
    assert.doesNotMatch(SOURCE, /META_ACCESS_TOKEN/);
  });

  it("resolves a business-scoped user id rather than the plain FB user id", () => {
    // Meta rejects the personal user id on assigned_users (PR #710), and the live
    // probe confirmed the scoped identity is even NAMED differently.
    assert.match(SOURCE, /resolveBusinessScopedUserId|resolveScopedUser/);
  });

  it("refuses to act through a Business Manager whose token has expired", () => {
    assert.match(SOURCE, /token_expired/);
  });

  it("does not write user_tasks from a grant response", () => {
    // user_tasks records what META reports. Writing the requested tasks there
    // would fabricate evidence, and Meta expands grants anyway (PR #726).
    assert.doesNotMatch(SOURCE, /user_tasks:/);
    assert.match(SOURCE, /recordPageGrantRequest/);
  });

  it("looks IG seeds up by ig_user_id but grants against ig_asset_id", () => {
    // The audience rule carries Instagram USER ids while the grant edge is keyed
    // by the business ASSET id. Confusing the two id spaces is exactly the class
    // of bug PR #725 exists to prevent, so the lookup keeps them separate.
    const fn = DB_SOURCE.slice(DB_SOURCE.indexOf("export async function findAudienceSeedLocations"));
    assert.match(fn, /\.in\("ig_user_id", sourceIds\)/);
    assert.match(fn, /grantAssetId: r\.ig_asset_id/);
    assert.match(fn, /sourceId: r\.ig_user_id/);
  });

  it("only reports pages with positive evidence of no operator role", () => {
    const fn = DB_SOURCE.slice(DB_SOURCE.indexOf("export async function getPagesWithoutOperatorRole"));
    // A row saying true anywhere wins: user_has_access comes from /me/accounts,
    // which is global, so a role seen through any business is a role.
    assert.match(fn, /withRole/);
    assert.match(fn, /!r\.user_has_access && !withRole\.has/);
  });
});

describe("audience write path wiring", () => {
  const WRITE = code("lib/meta/audience-write.ts");

  it("runs the recovery ladder instead of failing straight out", () => {
    assert.match(WRITE, /createWithEventSourceRecovery/);
    assert.match(WRITE, /createAudienceWithSeedRecovery/);
  });

  it("routes every recovery attempt through one create call, so one idempotency key covers them all", () => {
    // The key caches only on success, so reuse lets a failed attempt re-run while
    // making a double-create impossible if the first attempt did land. A second
    // create call site inside this function would be how that guarantee breaks.
    const start = WRITE.indexOf("async function createAudienceWithSeedRecovery");
    const after = WRITE.indexOf("\nasync function ", start + 1);
    const body = WRITE.slice(start, after === -1 ? undefined : after);
    assert.equal(body.match(/createOneMetaAudience\(/g)?.length, 1);
    assert.match(body, /idempotencyKey: args\.idempotencyKey/);
  });

  it("records the recovery note on the audience row so the operator sees it", () => {
    assert.match(WRITE, /recoveryNote/);
    assert.match(WRITE, /\[warning, recoveryNote\]/);
  });
});
