import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { isPublicPath } from "../../auth/public-routes.ts";
import { CANON_FRAME_IDS, EXTRA_FRAME_IDS, FRAME_IDS, NARROW_FRAME_IDS } from "../../../scripts/plan-frames/ids.ts";
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

  it("the frames route mounts PlanFrameMount and is gated", () => {
    const page = readFileSync(new URL("../../../app/(dev)/frames/[id]/page.tsx", import.meta.url), "utf8");
    assert.match(page, /ENABLE_PLAN_FRAMES/);
    assert.match(page, /PlanFrameMount/);
    assert.match(page, /getFrame/);
    assert.equal(isPublicPath("/frames/J2"), true);
    assert.equal(isPublicPath("/plan/299dd4e5-0000-0000-0000-000000000001"), false);
  });
});
