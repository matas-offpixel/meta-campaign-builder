/**
 * lib/bm/__tests__/page-audience-access.test.ts
 *
 * Regression guards for page AUDIENCE access (migration 148).
 *
 * The bug being fixed is a SILENT one: a page granted ADVERTISE looks completely
 * healthy in the dashboard, advertises fine, and is still refused as an audience
 * seed (subcode 1713140). So these tests pin three things that each independently
 * re-introduce it if they regress:
 *
 *   1. the audience grant posts the AUDIENCE task, not ADVERTISE (the brief's
 *      required byte-diff assertion)
 *   2. it posts a SUPERSET of what the page already had, so an audience grant can
 *      never revoke advertising — `assigned_users` SETS the task list rather than
 *      appending to it
 *   3. "granted" is never treated as success on its own; only read-back
 *      confirmation counts
 *
 * Task strings are pinned against a live Graph API v23.0 capture rather than the
 * docs — the same discipline that caught three wrong assumptions in PR #726.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAudienceGrantTasks,
  derivePageAccessFlags,
  PAGE_TASK_ADVERTISE,
  PAGE_TASK_AUDIENCE,
} from "../page-tasks.ts";
import {
  buildGrantUserPagePermissionRequest,
  buildGrantUserPageTasksRequest,
} from "../../meta/business-manager-grant-request.ts";
import {
  describeAudienceGrantResult,
  isAudienceGrantSuccess,
  type AudienceGrantOutcome,
} from "../types.ts";

const BIZ_ID = "741799859254067"; // LWE Business Manager
const PAGE_ID = "104449828309272";
const TARGET_USER_ID = "1572520317622050"; // business-scoped id, LWE

function outcome(patch: Partial<AudienceGrantOutcome> = {}): AudienceGrantOutcome {
  return {
    attempted: 0,
    granted: 0,
    confirmed: 0,
    failed: 0,
    batches: 0,
    failures: [],
    ...patch,
  };
}

// ─── Grant payload ───────────────────────────────────────────────────────────

describe("audience grant payload", () => {
  it("byte-diffs POST /{pageId}/assigned_users with the audience task, NOT ADVERTISE", () => {
    const req = buildGrantUserPageTasksRequest(
      PAGE_ID,
      BIZ_ID,
      TARGET_USER_ID,
      buildAudienceGrantTasks([]),
    );
    assert.equal(req.path, `/${PAGE_ID}/assigned_users`);
    assert.deepEqual(req.body, {
      business: BIZ_ID,
      user: TARGET_USER_ID,
      tasks: ["AUDIENCE_MANAGE"],
    });
    // The specific mix-up the brief called out: reusing v1's role builder here.
    assert.notDeepEqual(req.body.tasks, ["ADVERTISE"]);
  });

  it("keeps the business id in the BODY, not the path", () => {
    // Regression note from PR #708/#712: the edge accepts the path without a
    // business segment and then rejects the call with code 100 unless the body
    // carries `business`.
    const req = buildGrantUserPageTasksRequest(PAGE_ID, BIZ_ID, TARGET_USER_ID, [
      PAGE_TASK_AUDIENCE,
    ]);
    assert.ok(!req.path.includes(BIZ_ID));
    assert.equal(req.body.business, BIZ_ID);
  });

  it("does not change v1's ADVERTISER payload", () => {
    // buildGrantUserPagePermissionRequest was refactored to delegate to the new
    // task-set primitive; every live launch depends on it still being identical.
    const req = buildGrantUserPagePermissionRequest(
      PAGE_ID,
      BIZ_ID,
      TARGET_USER_ID,
      "ADVERTISER",
    );
    assert.equal(req.path, `/${PAGE_ID}/assigned_users`);
    assert.deepEqual(req.body, {
      business: BIZ_ID,
      user: TARGET_USER_ID,
      tasks: ["ADVERTISE"],
    });
  });
});

describe("buildAudienceGrantTasks — additive, never destructive", () => {
  it("grants audience only, when the page has no prior tasks", () => {
    assert.deepEqual(buildAudienceGrantTasks([]), [PAGE_TASK_AUDIENCE]);
  });

  it("PRESERVES ADVERTISE so an audience grant cannot break live ad delivery", () => {
    // The whole reason this is a union: assigned_users SETS the task list, so
    // posting [AUDIENCE_MANAGE] alone on an advertising page would remove
    // ADVERTISE and stop its ads.
    assert.deepEqual(buildAudienceGrantTasks([PAGE_TASK_ADVERTISE]), [
      "ADVERTISE",
      "AUDIENCE_MANAGE",
    ]);
  });

  it("preserves every other task the operator holds", () => {
    assert.deepEqual(buildAudienceGrantTasks(["ADVERTISE", "ANALYZE", "MODERATE"]), [
      "ADVERTISE",
      "ANALYZE",
      "MODERATE",
      "AUDIENCE_MANAGE",
    ]);
  });

  it("is idempotent — no duplicate audience task on re-grant", () => {
    assert.deepEqual(buildAudienceGrantTasks(["ADVERTISE", PAGE_TASK_AUDIENCE]), [
      "ADVERTISE",
      "AUDIENCE_MANAGE",
    ]);
  });

  it("does not mutate the caller's array", () => {
    const existing = [PAGE_TASK_ADVERTISE];
    buildAudienceGrantTasks(existing);
    assert.deepEqual(existing, [PAGE_TASK_ADVERTISE]);
  });
});

// ─── Flag derivation ─────────────────────────────────────────────────────────

describe("derivePageAccessFlags", () => {
  it("treats an absent page as no access at all", () => {
    assert.deepEqual(derivePageAccessFlags(undefined), {
      userHasAccess: false,
      userHasAudienceAccess: false,
      userTasks: [],
    });
  });

  it("THE BUG: ADVERTISE alone is access but NOT audience access", () => {
    assert.deepEqual(derivePageAccessFlags(["ADVERTISE"]), {
      userHasAccess: true,
      userHasAudienceAccess: false,
      userTasks: ["ADVERTISE"],
    });
  });

  it("flags audience access when the task is present", () => {
    const tasks = ["ADVERTISE", "ANALYZE", "AUDIENCE_MANAGE"];
    assert.deepEqual(derivePageAccessFlags(tasks), {
      userHasAccess: true,
      userHasAudienceAccess: true,
      userTasks: tasks,
    });
  });

  it("keeps user_has_access as mere presence, preserving migration-145 behaviour", () => {
    // Tightening this to require ADVERTISE would re-flag every page where the
    // operator holds only a read-ish role, across ~50 BMs.
    assert.equal(derivePageAccessFlags(["ANALYZE"]).userHasAccess, true);
    assert.equal(derivePageAccessFlags([]).userHasAccess, true);
  });
});

// ─── Success reporting ───────────────────────────────────────────────────────

describe("isAudienceGrantSuccess — confirmation, not acceptance", () => {
  it("is true only when every attempt was confirmed by read-back", () => {
    assert.equal(
      isAudienceGrantSuccess(outcome({ attempted: 3, granted: 3, confirmed: 3 })),
      true,
    );
  });

  it("is FALSE when Meta accepted the grants but never reported the task", () => {
    // This exact shape — 200 OK, task absent — is the original silent failure.
    assert.equal(
      isAudienceGrantSuccess(outcome({ attempted: 3, granted: 3, confirmed: 0 })),
      false,
    );
  });

  it("is false when verification could not run", () => {
    assert.equal(
      isAudienceGrantSuccess(
        outcome({ attempted: 2, granted: 2, confirmed: 0, readBackFailed: true }),
      ),
      false,
    );
  });

  it("is false when rate-limited or token-expired even with zero failures", () => {
    assert.equal(
      isAudienceGrantSuccess(outcome({ attempted: 1, granted: 1, confirmed: 1, rateLimited: true })),
      false,
    );
    assert.equal(
      isAudienceGrantSuccess(
        outcome({ attempted: 1, granted: 1, confirmed: 1, tokenExpired: true }),
      ),
      false,
    );
  });
});

describe("describeAudienceGrantResult", () => {
  it("reports confirmed counts on success", () => {
    assert.equal(
      describeAudienceGrantResult(outcome({ attempted: 12, granted: 12, confirmed: 12 })),
      "Audience access confirmed on 12/12 page(s).",
    );
  });

  it("says nothing-to-do when there was no target", () => {
    assert.match(describeAudienceGrantResult(outcome()), /already has audience access/);
  });

  it("tells the operator to rescan when grants were accepted but unconfirmed", () => {
    const text = describeAudienceGrantResult(
      outcome({ attempted: 4, granted: 4, confirmed: 1 }),
    );
    assert.match(text, /confirmed 1/);
    assert.match(text, /Sync now/);
  });

  it("surfaces the retry window when halted by a rate limit", () => {
    const text = describeAudienceGrantResult(
      outcome({
        attempted: 30,
        granted: 28,
        confirmed: 28,
        totalTargeted: 100,
        rateLimited: true,
        retryAfterMinutes: 20,
      }),
    );
    assert.match(text, /28 of 100/);
    assert.match(text, /~20 minutes/);
  });

  it("warns that unverified grants must not be relied on as seeds", () => {
    const text = describeAudienceGrantResult(
      outcome({ attempted: 5, granted: 5, confirmed: 0, readBackFailed: true }),
    );
    assert.match(text, /could not verify/);
  });

  it("prefers the reconnect message when the token expired", () => {
    assert.match(
      describeAudienceGrantResult(outcome({ attempted: 1, tokenExpired: true })),
      /reconnect/i,
    );
  });
});
