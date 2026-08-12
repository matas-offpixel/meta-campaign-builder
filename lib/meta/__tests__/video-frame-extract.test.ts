/**
 * Tests for lib/meta/video-frame-extract.ts's pure seek-clamping logic.
 *
 * `extractVideoFrame` itself needs a real `HTMLVideoElement` +
 * `CanvasRenderingContext2D` (no DOM in this project's Node `--test`
 * runner) — `clampSeekTarget` is factored out specifically so the boundary
 * logic (never seek past the end of the clip, never seek negative) has
 * unit coverage without one.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clampSeekTarget } from "../video-frame-extract.ts";

describe("clampSeekTarget", () => {
  it("passes through an in-range target unchanged", () => {
    assert.equal(clampSeekTarget(5, 30), 5);
  });

  it("clamps a negative target to 0", () => {
    assert.equal(clampSeekTarget(-3, 30), 0);
  });

  it("clamps a target past the clip's end to duration minus the safety margin", () => {
    assert.equal(clampSeekTarget(999, 30), 29.95);
  });

  it("clamps to 0 when duration is 0 (still-loading / zero-length video)", () => {
    assert.equal(clampSeekTarget(5, 0), 0);
  });

  it("returns 0 for a non-finite atSeconds (NaN)", () => {
    assert.equal(clampSeekTarget(NaN, 30), 0);
  });

  it("returns 0 for a non-finite duration (NaN — metadata not yet loaded)", () => {
    assert.equal(clampSeekTarget(5, NaN), 0);
  });

  it("never returns a negative clamp bound even for a very short clip", () => {
    assert.equal(clampSeekTarget(5, 0.01), 0);
  });
});
