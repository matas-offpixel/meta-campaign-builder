/**
 * Tests for the Phase 3.5 push-route guard.
 *
 * The guard is the defence-in-depth complement to the per-row
 * `pushed_resource_name` idempotency check in the writer adapter —
 * a route-level refusal for re-push of an already-pushed plan unless
 * the caller passes `{ force: true }`.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { evaluatePushGuard } from "../push-guard.ts";

describe("evaluatePushGuard", () => {
  it("does not refuse a fresh draft plan with no pushed rows", () => {
    const decision = evaluatePushGuard(
      {
        planStatus: "draft",
        campaigns: [{ pushed_resource_name: null }, { pushed_resource_name: null }],
      },
      false,
    );
    assert.equal(decision.refuse, false);
    assert.equal(decision.alreadyPushed, false);
    assert.equal(decision.pushedCampaignCount, 0);
    assert.equal(decision.message, undefined);
  });

  it("refuses when plan.status === 'pushed' and no force flag", () => {
    const decision = evaluatePushGuard(
      {
        planStatus: "pushed",
        campaigns: [{ pushed_resource_name: "customers/123/campaigns/1" }],
      },
      false,
    );
    assert.equal(decision.refuse, true);
    assert.equal(decision.alreadyPushed, true);
    assert.equal(decision.pushedCampaignCount, 1);
    assert.match(decision.message ?? "", /This plan was already pushed/);
    assert.match(decision.message ?? "", /Re-send with \{ force: true \}/);
  });

  it("refuses when ANY campaign carries a pushed_resource_name even if plan status is draft", () => {
    // This can happen if status was reset (e.g. manually) but a previous
    // push left markers — still treat as 'already pushed' to be safe.
    const decision = evaluatePushGuard(
      {
        planStatus: "draft",
        campaigns: [
          { pushed_resource_name: null },
          { pushed_resource_name: "customers/123/campaigns/2" },
        ],
      },
      false,
    );
    assert.equal(decision.refuse, true);
    assert.equal(decision.alreadyPushed, true);
    assert.equal(decision.pushedCampaignCount, 1);
  });

  it("does NOT refuse when force=true even if pushed", () => {
    const decision = evaluatePushGuard(
      {
        planStatus: "pushed",
        campaigns: [
          { pushed_resource_name: "customers/123/campaigns/1" },
          { pushed_resource_name: "customers/123/campaigns/2" },
        ],
      },
      true,
    );
    assert.equal(decision.refuse, false);
    assert.equal(decision.alreadyPushed, true);
    assert.equal(decision.pushedCampaignCount, 2);
  });

  it("formats the message with the count (plural vs singular)", () => {
    const one = evaluatePushGuard(
      { planStatus: "pushed", campaigns: [{ pushed_resource_name: "x" }] },
      false,
    );
    assert.match(one.message ?? "", /1 campaign is/);

    const many = evaluatePushGuard(
      {
        planStatus: "pushed",
        campaigns: [
          { pushed_resource_name: "x" },
          { pushed_resource_name: "y" },
          { pushed_resource_name: "z" },
        ],
      },
      false,
    );
    assert.match(many.message ?? "", /3 campaigns are/);
  });

  it("handles partially_pushed plans (refuses without force)", () => {
    // partially_pushed is the Phase 3 outcome of partial failure — we
    // also treat it as 'already pushed' so re-launching requires force.
    const decision = evaluatePushGuard(
      {
        planStatus: "partially_pushed",
        campaigns: [{ pushed_resource_name: "customers/123/campaigns/1" }],
      },
      false,
    );
    assert.equal(decision.refuse, true);
  });
});
