import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { isPublicPath } from "../../auth/public-routes.ts";
import { VIZ_CLIENT_SAFE, VIZ_LOCKED_CLIENT_CREATIVE } from "../../viz/tokens.ts";
import { adjustControlsVisible } from "../adjust-face.ts";
import { launchControlsVisible } from "../launch-face.ts";
import { learnControlsVisible } from "../learn-face.ts";
import { isPlanShareId, planShareControls, planSharePath } from "../share-role.ts";

describe("share role — view function the surface calls", () => {
  it("client strips every control and never adds a marker", () => {
    const client = planShareControls("client");
    assert.deepEqual(client, {
      launch: false,
      unitPicker: false,
      drawerEdit: false,
      suggestion: false,
      doIt: false,
      notNow: false,
      undo: false,
      nextTimeColumn: false,
      switcher: false,
      marker: false,
    });
    const operator = planShareControls("operator");
    assert.equal(operator.launch, true);
    assert.equal(operator.suggestion, true);
    assert.equal(operator.nextTimeColumn, true);
    assert.equal(operator.switcher, true);
    assert.equal(operator.marker, false);
  });

  it("composes the three face functions", () => {
    assert.deepEqual(
      {
        launch: launchControlsVisible("client").launch,
        unitPicker: launchControlsVisible("client").unitPicker,
        drawerEdit: launchControlsVisible("client").drawerEdit,
        ...adjustControlsVisible("client"),
        ...learnControlsVisible("client"),
      },
      {
        launch: false,
        unitPicker: false,
        drawerEdit: false,
        suggestion: false,
        doIt: false,
        notNow: false,
        undo: false,
        nextTimeColumn: false,
      },
    );
  });

  it("share path is one plan under /share/", () => {
    assert.equal(planSharePath("299dd4e5-0000-0000-0000-000000000001"), "/share/plan/299dd4e5-0000-0000-0000-000000000001");
    assert.equal(isPlanShareId("299dd4e5-0000-0000-0000-000000000001"), true);
    assert.equal(isPlanShareId("not-a-uuid"), false);
  });
});

describe("share role — surfaces call the view", () => {
  it("LAUNCH hides the button and the unit picker", () => {
    const launch = readFileSync("components/plan/canvas-launch.tsx", "utf8");
    const target = readFileSync("components/plan/canvas-target.tsx", "utf8");
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(launch, /launchControlsVisible/);
    assert.match(target, /unitPicker/);
    assert.match(workspace, /role=\{role\}/);
    assert.match(workspace, /planShareControls/);
    assert.doesNotMatch(workspace, /shared ▾/);
  });

  it("ADJUST keeps the log and strips suggestion / do it / undo", () => {
    const adjust = readFileSync("components/plan/canvas-adjust.tsx", "utf8");
    assert.match(adjust, /adjustControlsVisible/);
    assert.match(adjust, /adjustFaceView/);
    assert.match(adjust, /face\.creativeSentence/);
    assert.match(adjust, /role=\{role\}/);
  });

  it("LEARN keeps the exhibits and strips next-time", () => {
    const learn = readFileSync("components/plan/canvas-learn.tsx", "utf8");
    assert.match(learn, /learnControlsVisible/);
    assert.match(learn, /learnCreativeLock\(role\)/);
  });

  it("system sentences go through VIZ_CLIENT_SAFE", () => {
    assert.equal(VIZ_CLIENT_SAFE(VIZ_LOCKED_CLIENT_CREATIVE), VIZ_LOCKED_CLIENT_CREATIVE);
    assert.doesNotMatch(VIZ_CLIENT_SAFE("creative_scores table and ENABLE_AI_AUTOTAG"), /table|ENABLE_/i);
    const locked = readFileSync("components/viz/locked.tsx", "utf8");
    assert.match(locked, /VIZ_CLIENT_SAFE/);
  });
});

describe("share route — one plan, existing allow-list", () => {
  it("is under /share/ and does not widen PUBLIC_PREFIXES", () => {
    const page = readFileSync("app/share/plan/[id]/page.tsx", "utf8");
    assert.match(page, /role="client"/);
    assert.match(page, /PlanWorkspace/);
    assert.match(page, /loadSharedPlanWorkspace/);
    assert.doesNotMatch(page, /PageHeader/);
    assert.doesNotMatch(page, /\/plans/);

    const prefixes = readFileSync("lib/auth/public-routes.ts", "utf8");
    assert.match(prefixes, /"\/share\/"/);
    assert.doesNotMatch(prefixes, /"\/share\/plan/);
    assert.equal(isPublicPath("/share/plan/299dd4e5-0000-0000-0000-000000000001"), true);
    assert.equal(isPublicPath("/plan/299dd4e5-0000-0000-0000-000000000001"), false);
  });
});
