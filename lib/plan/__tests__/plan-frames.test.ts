import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { isPublicPath } from "../../auth/public-routes.ts";
import { planWindowValidity } from "../canvas-inputs.ts";
import { CANON_FRAME_IDS, EXTRA_FRAME_IDS, FRAME_IDS, NARROW_FRAME_IDS } from "../../../scripts/plan-frames/ids.ts";
import { MAR_18 } from "../../../scripts/plan-frames/builders.ts";
import { FRAME_FIXTURES, getFrame } from "../../../scripts/plan-frames/fixtures.ts";

describe("plan-v2 frame catalog", () => {
  it("has the 33 canon frames plus J0", () => {
    assert.equal(CANON_FRAME_IDS.length, 33);
    assert.deepEqual([...EXTRA_FRAME_IDS], ["J0"]);
    assert.equal(FRAME_IDS.length, 34);
    assert.deepEqual([...NARROW_FRAME_IDS], ["L3", "J2"]);
  });

  it("every id has a fixture the surface can mount", () => {
    for (const id of FRAME_IDS) {
      const fixture = getFrame(id);
      assert.ok(fixture, id);
      assert.equal(fixture.id, id);
      assert.ok(fixture.title);
      assert.ok(fixture.now);
      assert.equal(FRAME_FIXTURES[id].kind, fixture.kind);
    }
  });

  it("A13–A15 carry now = Wed 18 Mar and a valid window", () => {
    for (const id of ["A13", "A14", "A15"] as const) {
      const fixture = getFrame(id);
      assert.equal(fixture.kind, "launch");
      if (fixture.kind !== "launch") continue;
      assert.equal(fixture.now, MAR_18);
      const ok = planWindowValidity(
        {
          startDate: fixture.plan.intent.startDate,
          startTime: fixture.plan.intent.startTime,
          endDate: fixture.plan.intent.endDate,
          endTime: fixture.plan.intent.endTime,
        },
        { eventDate: fixture.event.eventDate },
        { now: new Date(fixture.now), createdAt: fixture.plan.createdAt },
      );
      assert.equal(ok.ok, true, id);
    }
  });

  it("frame surfaces read the fixture now, never Date.now()", () => {
    const files = [
      "components/plan/plan-frame-mount.tsx",
      "components/plan/canvas-window.tsx",
      "components/plan/canvas-adjust.tsx",
      "components/plan/canvas-target.tsx",
      "components/viz/window-bar.tsx",
      "components/plan/plan-workspace.tsx",
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      assert.doesNotMatch(src, /Date\.now\(/, file);
      assert.doesNotMatch(src, /now \?\? new Date\(/, file);
    }
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(workspace, /now=\{clock\}/);
    const runner = readFileSync("scripts/plan-frames/run.mjs", "utf8");
    assert.match(runner, /--local/);
    assert.match(runner, /CI truth/);
  });

  it("the frames route mounts PlanFrameMount and is gated", () => {
    const page = readFileSync(new URL("../../../app/(dev)/frames/[id]/page.tsx", import.meta.url), "utf8");
    assert.match(page, /ENABLE_PLAN_FRAMES/);
    assert.match(page, /PlanFrameMount/);
    assert.match(page, /getFrame/);
    assert.equal(isPublicPath("/frames/J2"), true);
    assert.equal(isPublicPath("/plan/299dd4e5-0000-0000-0000-000000000001"), false);
  });
});
