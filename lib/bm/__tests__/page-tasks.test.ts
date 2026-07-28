/**
 * lib/bm/__tests__/page-tasks.test.ts
 *
 * Guards for validated page task-set grants (migration 149).
 *
 * This PR was scoped to grant a page task called `AUDIENCE_MANAGE` to fix the
 * wizard's audience builder (subcode 1713140). A live capture against Graph
 * v23.0 proved that task does not exist. So the first job of this suite is to
 * make that impossible to re-assume: the accepted enum is checked against the
 * verbatim rejection fixture, and `AUDIENCE_MANAGE` is pinned as invalid.
 *
 * Beyond that, three properties each independently reintroduce a real failure
 * mode if they regress:
 *
 *   1. a grant posts a SUPERSET of the page's existing tasks — `assigned_users`
 *      SETS the task list, so posting the new task alone strips ADVERTISE and
 *      stops live ad delivery
 *   2. v1's ADVERTISER payload is byte-for-byte unchanged by the refactor that
 *      introduced the task-set primitive
 *   3. "Meta accepted the POST" is never reported as success on its own; only
 *      read-back confirmation counts, and confirmation is a superset test
 *      because Meta expands grants (PR #726: one ADVERTISE read back as five)
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildAdditiveTaskGrant,
  derivePageAccessState,
  grantSatisfiedForPage,
  isPagePermittedTask,
  PAGE_PERMITTED_TASKS,
  PAGE_TASK_ADVERTISE,
  PAGE_TASKS_NEVER_GRANTED,
  validatePageTasks,
} from "../page-tasks.ts";
import {
  buildGrantUserPagePermissionRequest,
  buildGrantUserPageTasksRequest,
} from "../../meta/business-manager-grant-request.ts";
import {
  describeTaskGrantResult,
  isTaskGrantSuccess,
  type TaskGrantOutcome,
} from "../types.ts";

const BIZ_ID = "741799859254067"; // LWE Business Manager
const PAGE_ID = "104449828309272";
const TARGET_USER_ID = "1572520317622050"; // business-scoped id, LWE

function outcome(patch: Partial<TaskGrantOutcome> = {}): TaskGrantOutcome {
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

// ─── The enum, against the live capture ──────────────────────────────────────

describe("PAGE_PERMITTED_TASKS matches the live Graph v23.0 rejection", () => {
  /**
   * Meta gates `GET /{pageId}/assigned_users` behind `pages_manage_metadata`,
   * which this token does not hold, so the only way to read the accepted set is
   * to POST an invalid task and parse the enum out of the error. Parsing the
   * fixture rather than restating the list means the constant cannot drift from
   * the capture it claims to come from.
   */
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/page_assigned_users_enum_probe.json", import.meta.url), "utf8"),
  ) as { error: { message: string; code: number } };

  const capturedEnum = (fixture.error.message.match(/expected : '\[([^\]]+)\]'/)?.[1] ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  it("parsed the enum out of the fixture at all", () => {
    assert.equal(fixture.error.code, 100);
    assert.ok(capturedEnum.length > 0, "enum could not be parsed from the captured message");
  });

  it("is exactly the set Meta enumerated", () => {
    assert.deepEqual([...PAGE_PERMITTED_TASKS], capturedEnum);
  });

  it("does NOT contain AUDIENCE_MANAGE — the task this PR was scoped around", () => {
    // Had the original scope shipped, every grant would have failed with code
    // 100 part-way through a bulk run across ~50 BMs, and the audience-builder
    // failure it was meant to fix would have remained.
    assert.ok(!capturedEnum.includes("AUDIENCE_MANAGE"));
    assert.equal(isPagePermittedTask("AUDIENCE_MANAGE"), false);
  });

  it("does not accept the legacy page-role vocabulary", () => {
    // Pages use the same unified business-asset names PR #726 found on IG
    // assets: CONTENT not CREATE_CONTENT, FULL_CONTROL not MANAGE.
    for (const legacy of ["MANAGE", "CREATE_CONTENT", "MODERATE", "MESSAGING"]) {
      assert.equal(isPagePermittedTask(legacy), false, `${legacy} should not be permitted`);
    }
  });
});

// ─── Fail-fast validation ────────────────────────────────────────────────────

describe("validatePageTasks", () => {
  it("REJECTS AUDIENCE_MANAGE before a single Graph call is spent", () => {
    const result = validatePageTasks(["AUDIENCE_MANAGE"]);
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /Not a Meta page task: AUDIENCE_MANAGE/);
  });

  it("names the accepted set in the error, so the fix is obvious from the message", () => {
    const { error } = validatePageTasks(["NOPE"]);
    assert.match(error ?? "", /ADVERTISE/);
    assert.match(error ?? "", /v23\.0/);
  });

  it("rejects an empty request", () => {
    assert.equal(validatePageTasks([]).ok, false);
  });

  it("refuses owner-level tasks even though Meta accepts them", () => {
    // /business-managers promises "enough to run ads, no owner-level actions".
    for (const task of PAGE_TASKS_NEVER_GRANTED) {
      const result = validatePageTasks([task]);
      assert.equal(result.ok, false, `${task} should be refused`);
      assert.match(result.error ?? "", /owner-level/);
    }
  });

  it("accepts the tasks this tool is for", () => {
    assert.equal(validatePageTasks(["ADVERTISE"]).ok, true);
    assert.equal(validatePageTasks(["ADVERTISE", "ANALYZE"]).ok, true);
  });

  it("rejects a mixed set — one bad task fails the whole request", () => {
    assert.equal(validatePageTasks(["ADVERTISE", "AUDIENCE_MANAGE"]).ok, false);
  });
});

// ─── Grant payload ───────────────────────────────────────────────────────────

describe("task-set grant payload", () => {
  it("posts the requested tasks to /{pageId}/assigned_users", () => {
    const req = buildGrantUserPageTasksRequest(PAGE_ID, BIZ_ID, TARGET_USER_ID, [
      "ADVERTISE",
      "ANALYZE",
    ]);
    assert.equal(req.path, `/${PAGE_ID}/assigned_users`);
    assert.deepEqual(req.body, {
      business: BIZ_ID,
      user: TARGET_USER_ID,
      tasks: ["ADVERTISE", "ANALYZE"],
    });
  });

  it("keeps the business id in the BODY, not the path", () => {
    // Regression note from PR #708/#712: the edge accepts the path without a
    // business segment and then rejects the call with code 100 unless the body
    // carries `business`.
    const req = buildGrantUserPageTasksRequest(PAGE_ID, BIZ_ID, TARGET_USER_ID, ["ANALYZE"]);
    assert.ok(!req.path.includes(BIZ_ID));
    assert.equal(req.body.business, BIZ_ID);
  });

  it("does not change v1's ADVERTISER payload", () => {
    // buildGrantUserPagePermissionRequest was refactored to delegate to the new
    // task-set primitive; every live launch depends on it staying identical.
    const req = buildGrantUserPagePermissionRequest(PAGE_ID, BIZ_ID, TARGET_USER_ID, "ADVERTISER");
    assert.equal(req.path, `/${PAGE_ID}/assigned_users`);
    assert.deepEqual(req.body, {
      business: BIZ_ID,
      user: TARGET_USER_ID,
      tasks: ["ADVERTISE"],
    });
  });
});

describe("buildAdditiveTaskGrant — additive, never destructive", () => {
  it("posts just the new tasks when the page has none", () => {
    assert.deepEqual(buildAdditiveTaskGrant([], ["ANALYZE"]), ["ANALYZE"]);
  });

  it("PRESERVES ADVERTISE so a new grant cannot break live ad delivery", () => {
    // The reason this is a union: assigned_users SETS the task list, so posting
    // [ANALYZE] alone on an advertising page would remove ADVERTISE.
    assert.deepEqual(buildAdditiveTaskGrant([PAGE_TASK_ADVERTISE], ["ANALYZE"]), [
      "ADVERTISE",
      "ANALYZE",
    ]);
  });

  it("preserves every other task the operator already holds", () => {
    assert.deepEqual(
      buildAdditiveTaskGrant(["ADVERTISE", "CONTENT", "MESSAGES"], ["ANALYZE"]),
      ["ADVERTISE", "CONTENT", "MESSAGES", "ANALYZE"],
    );
  });

  it("is idempotent — re-granting held tasks produces no duplicates", () => {
    assert.deepEqual(buildAdditiveTaskGrant(["ADVERTISE", "ANALYZE"], ["ANALYZE"]), [
      "ADVERTISE",
      "ANALYZE",
    ]);
  });

  it("does not mutate the caller's array", () => {
    const existing = [PAGE_TASK_ADVERTISE];
    buildAdditiveTaskGrant(existing, ["ANALYZE"]);
    assert.deepEqual(existing, [PAGE_TASK_ADVERTISE]);
  });
});

// ─── Observed-state derivation ───────────────────────────────────────────────

describe("derivePageAccessState", () => {
  it("treats an absent page as no access at all", () => {
    assert.deepEqual(derivePageAccessState(undefined), {
      userHasAccess: false,
      userTasks: [],
    });
  });

  it("stores the task list verbatim as evidence", () => {
    const tasks = ["ADVERTISE", "ANALYZE", "CONTENT"];
    assert.deepEqual(derivePageAccessState(tasks), { userHasAccess: true, userTasks: tasks });
  });

  it("keeps user_has_access as mere presence, preserving migration-145 behaviour", () => {
    // Tightening this to require ADVERTISE would re-flag every page where the
    // operator holds only a read-ish role, across ~50 BMs.
    assert.equal(derivePageAccessState(["ANALYZE"]).userHasAccess, true);
    assert.equal(derivePageAccessState([]).userHasAccess, true);
  });
});

describe("grantSatisfiedForPage — superset, never equality", () => {
  it("is satisfied when Meta EXPANDED the grant beyond what was asked", () => {
    // PR #726 observed exactly this on an IG asset: one requested ADVERTISE
    // read back as five tasks. Equality would report a false failure.
    assert.equal(
      grantSatisfiedForPage(["ADVERTISE"], ["ADVERTISE", "ANALYZE", "CONTENT", "MESSAGES"]),
      true,
    );
  });

  it("is not satisfied when any requested task is absent", () => {
    assert.equal(grantSatisfiedForPage(["ADVERTISE", "ANALYZE"], ["ADVERTISE"]), false);
  });

  it("is not satisfied when Meta reports nothing", () => {
    assert.equal(grantSatisfiedForPage(["ADVERTISE"], []), false);
  });
});

// ─── Success reporting ───────────────────────────────────────────────────────

describe("isTaskGrantSuccess — confirmation, not acceptance", () => {
  it("is true only when every attempt was confirmed by read-back", () => {
    assert.equal(isTaskGrantSuccess(outcome({ attempted: 3, granted: 3, confirmed: 3 })), true);
  });

  it("is FALSE when Meta accepted the grants but never reported the tasks", () => {
    // This exact shape — 200 OK, capability absent — is the silent failure.
    assert.equal(isTaskGrantSuccess(outcome({ attempted: 3, granted: 3, confirmed: 0 })), false);
  });

  it("is false when verification could not run", () => {
    assert.equal(
      isTaskGrantSuccess(outcome({ attempted: 2, granted: 2, confirmed: 0, readBackFailed: true })),
      false,
    );
  });

  it("is false when rate-limited or token-expired even with zero failures", () => {
    assert.equal(
      isTaskGrantSuccess(outcome({ attempted: 1, granted: 1, confirmed: 1, rateLimited: true })),
      false,
    );
    assert.equal(
      isTaskGrantSuccess(outcome({ attempted: 1, granted: 1, confirmed: 1, tokenExpired: true })),
      false,
    );
  });
});

describe("describeTaskGrantResult", () => {
  it("names the requested tasks and the confirmed count on success", () => {
    assert.equal(
      describeTaskGrantResult(
        outcome({ attempted: 12, granted: 12, confirmed: 12, requestedTasks: ["ANALYZE"] }),
      ),
      "ANALYZE confirmed on 12/12 page(s).",
    );
  });

  it("says nothing-to-do when there was no target", () => {
    assert.match(describeTaskGrantResult(outcome({ requestedTasks: ["ANALYZE"] })), /already holds/);
  });

  it("tells the operator to rescan when grants were accepted but unconfirmed", () => {
    const text = describeTaskGrantResult(outcome({ attempted: 4, granted: 4, confirmed: 1 }));
    assert.match(text, /confirmed 1/);
    assert.match(text, /Sync now/);
  });

  it("surfaces the retry window when halted by a rate limit", () => {
    const text = describeTaskGrantResult(
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

  it("warns that unverified grants must not be relied on", () => {
    const text = describeTaskGrantResult(
      outcome({ attempted: 5, granted: 5, confirmed: 0, readBackFailed: true }),
    );
    assert.match(text, /could not verify/);
  });

  it("prefers the reconnect message when the token expired", () => {
    assert.match(describeTaskGrantResult(outcome({ attempted: 1, tokenExpired: true })), /reconnect/i);
  });
});
