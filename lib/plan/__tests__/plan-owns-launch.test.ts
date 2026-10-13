import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { planOwnsLaunch } from "../linked-plan.ts";

describe("planOwnsLaunch", () => {
  it("attach_all_adsets on a live plan launches from the creator", () => {
    assert.equal(
      planOwnsLaunch({
        wizardMode: "attach_all_adsets",
        planLaunchStatus: "live",
        draftStatus: "published",
      }),
      false,
    );
  });

  it("a new unpublished campaign with an idle plan lets the canvas own Launch", () => {
    assert.equal(
      planOwnsLaunch({
        wizardMode: "new",
        planLaunchStatus: "idle",
        draftStatus: "draft",
      }),
      true,
    );
    assert.equal(
      planOwnsLaunch({
        wizardMode: "new",
        planLaunchStatus: "failed",
        draftStatus: "draft",
      }),
      true,
    );
  });

  it("a published linked draft launches from the creator", () => {
    assert.equal(
      planOwnsLaunch({
        wizardMode: "new",
        planLaunchStatus: "idle",
        draftStatus: "published",
      }),
      false,
    );
  });

  it("the launch route and the helper agree", () => {
    const route = readFileSync("app/api/meta/launch-campaign/route.ts", "utf8");
    const refusesPlanLink = /campaign_plan_meta_launch|planOwnsLaunch\(/.test(route);
    assert.equal(
      refusesPlanLink,
      false,
      "app/api/meta/launch-campaign/route.ts does not refuse a plan-linked draft, so it does not need a second copy of the rule",
    );
    const shell = readFileSync("components/wizard/wizard-shell.tsx", "utf8");
    assert.match(shell, /planOwnsLaunch\(/);
    assert.match(shell, /canvasOwnsLaunch=\{canvasOwnsLaunch\}/);
    assert.match(readFileSync("components/steps/review-launch.tsx", "utf8"), /launch-on-canvas/);
    const record = readFileSync("lib/plan/record-wizard-launch.ts", "utf8");
    assert.match(record, /planOwnsLaunch\(/);
    assert.match(record, /\[plan-record\] skipped: creator-owned launch/);
    assert.match(route, /preLaunchPlanOwnership/);
    assert.match(route, /\.\.\.preLaunchPlanOwnership/);
    assert.doesNotMatch(route, /draftStatus: publishedDraft\.status/);
  });
});
