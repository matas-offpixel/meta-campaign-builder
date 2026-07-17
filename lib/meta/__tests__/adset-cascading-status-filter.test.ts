/**
 * Regression test for the 2026-07-15 live bug: "Add to existing ad set(s)" /
 * "attach_all_adsets" picked up ONLY ad sets that were paused at their OWN
 * level, silently dropping ad sets that are configured "ACTIVE" but whose
 * parent campaign happens to be paused (Meta reports those as
 * `effective_status: "CAMPAIGN_PAUSED"`, not `"ACTIVE"`).
 *
 * Tests the pure `effectiveStatusAllowListFor` helper directly (see its
 * doc comment for why it was extracted out of lib/meta/client.ts: that
 * module's `MetaApiError` class uses TS parameter properties, which are
 * unsupported by `node --experimental-strip-types` — the runner this repo's
 * `npm test` uses — so nothing in the test suite imports client.ts directly).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CASCADING_PAUSE_STATUSES,
  effectiveStatusAllowListFor,
} from "../adset-effective-status-filter.ts";

describe("effectiveStatusAllowListFor", () => {
  it('"relevant" includes ACTIVE + PAUSED + all three cascading statuses', () => {
    const statuses = effectiveStatusAllowListFor("relevant")!;
    for (const expected of ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "WITH_ISSUES"]) {
      assert.ok(statuses.includes(expected), `expected "relevant" to include ${expected}`);
    }
    assert.equal(statuses.length, 5);
  });

  it('"active" includes ACTIVE + all three cascading statuses, but NOT literal PAUSED', () => {
    const statuses = effectiveStatusAllowListFor("active")!;
    for (const expected of ["ACTIVE", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "WITH_ISSUES"]) {
      assert.ok(statuses.includes(expected), `expected "active" to include ${expected}`);
    }
    assert.ok(!statuses.includes("PAUSED"), '"active" must not include literal PAUSED');
    assert.equal(statuses.length, 4);
  });

  it('"paused" is unchanged — literal PAUSED only, no cascading statuses', () => {
    assert.deepEqual(effectiveStatusAllowListFor("paused"), ["PAUSED"]);
  });

  it('"all" returns null (no server-side status filter applied)', () => {
    assert.equal(effectiveStatusAllowListFor("all"), null);
  });

  it("CASCADING_PAUSE_STATUSES is the exact three-value set requested (CAMPAIGN_PAUSED, ADSET_PAUSED, WITH_ISSUES)", () => {
    assert.deepEqual(
      [...CASCADING_PAUSE_STATUSES].sort(),
      ["ADSET_PAUSED", "CAMPAIGN_PAUSED", "WITH_ISSUES"],
    );
  });

  it("an ad set nested under a paused campaign is representable by every status in the allow-list", () => {
    // Simulates the real-world shape: the ad set's OWN `status` is "ACTIVE"
    // for all five rows below, but `effective_status` varies — this is
    // exactly the set of values that must survive the Meta-side filter for
    // "Add to existing ad set(s)" / attach_all_adsets to see every ad set
    // whose own toggle is on, regardless of the parent campaign's state.
    const nestedAdSetEffectiveStatuses = ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "WITH_ISSUES"];
    const relevantAllowList = effectiveStatusAllowListFor("relevant")!;
    for (const status of nestedAdSetEffectiveStatuses) {
      assert.ok(
        relevantAllowList.includes(status),
        `"relevant" filter must let a nested ad set with effective_status=${status} through`,
      );
    }
  });
});
