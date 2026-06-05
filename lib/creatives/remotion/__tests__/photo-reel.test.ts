/**
 * Unit tests for PhotoReelStatic composition logic.
 *
 * Covers:
 * 1. PhotoReelStaticProps shape (including zoom field)
 * 2. durationInFrames calculation (photos.length × framesPerPhoto)
 * 3. Empty-photos guard: calculateMetadata returns at least 1 frame
 * 4. zoom=false → scale is always 1.0 (no transform)
 * 5. zoom=true  → scale interpolates 1.00→1.04 over the photo window
 * 6. Backwards compatibility: missing zoom field defaults to no-zoom behaviour
 *
 * These tests run in Node via `node --experimental-strip-types --test`
 * without invoking the Remotion bundler or a React renderer.
 * The PhotoReelStaticProps interface is defined inline to avoid importing
 * from a JSX/TSX file which Node cannot strip-type.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

// ---------------------------------------------------------------------------
// Interface mirrored from src/remotion/compositions/PhotoReelStatic.tsx
// Keep in sync if the props shape changes.
// ---------------------------------------------------------------------------
interface PhotoReelStaticProps {
  photos: string[];
  framesPerPhoto: number;
  /** Enable Ken-Burns slow zoom-in on each photo. Default false (static photos). */
  zoom?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers — mirror the logic from PhotoReelStatic / calculateMetadata
// without importing Remotion (browser env not available in node:test).
// ---------------------------------------------------------------------------

function calcDuration(props: PhotoReelStaticProps): number {
  return Math.max(1, props.photos.length * props.framesPerPhoto);
}

/**
 * Mirrors the scale computation in PhotoSlide.
 * interpolate(frame, [0, max], [1.0, 1.04], { clamp }) when zoom=true, else 1.
 */
function computeScale(frame: number, framesPerPhoto: number, zoom: boolean): number {
  if (!zoom) return 1;
  const max = Math.max(1, framesPerPhoto - 1);
  const t = Math.min(Math.max(frame / max, 0), 1);
  return 1.0 + t * 0.04;
}

// ---------------------------------------------------------------------------
// Props shape tests
// ---------------------------------------------------------------------------

test("PhotoReelStaticProps: type accepts shape with zoom omitted (backwards-compatible)", () => {
  const props: PhotoReelStaticProps = {
    photos: ["https://example.com/bridge-01.jpeg"],
    framesPerPhoto: 7,
  };
  assert.equal(props.photos.length, 1);
  assert.equal(props.framesPerPhoto, 7);
  assert.equal(props.zoom, undefined);
});

test("PhotoReelStaticProps: type accepts shape with zoom: false", () => {
  const props: PhotoReelStaticProps = {
    photos: ["https://example.com/bridge-01.jpeg"],
    framesPerPhoto: 7,
    zoom: false,
  };
  assert.equal(props.zoom, false);
});

test("PhotoReelStaticProps: type accepts shape with zoom: true", () => {
  const props: PhotoReelStaticProps = {
    photos: ["https://example.com/bridge-01.jpeg"],
    framesPerPhoto: 7,
    zoom: true,
  };
  assert.equal(props.zoom, true);
});

// ---------------------------------------------------------------------------
// Duration tests
// ---------------------------------------------------------------------------

test("durationInFrames = photos.length × framesPerPhoto (64 × 7 = 448)", () => {
  const fakeUrls = Array.from(
    { length: 64 },
    (_, i) => `https://cdn.test/bridge-${String(i + 1).padStart(2, "0")}.jpeg`,
  );
  assert.equal(calcDuration({ photos: fakeUrls, framesPerPhoto: 7 }), 448);
});

test("durationInFrames with various photo counts", () => {
  assert.equal(calcDuration({ photos: Array(10).fill("u"), framesPerPhoto: 5 }), 50);
  assert.equal(calcDuration({ photos: Array(1).fill("u"), framesPerPhoto: 30 }), 30);
  assert.equal(calcDuration({ photos: Array(100).fill("u"), framesPerPhoto: 3 }), 300);
});

test("empty photos array: calcDuration returns 1 (no-op safety)", () => {
  assert.equal(calcDuration({ photos: [], framesPerPhoto: 7 }), 1);
});

test("framesPerPhoto=0: clamped to minimum 1 frame", () => {
  assert.equal(calcDuration({ photos: ["u"], framesPerPhoto: 0 }), 1);
});

// ---------------------------------------------------------------------------
// Zoom scale tests
// ---------------------------------------------------------------------------

test("zoom=false: scale is 1.0 at every frame (no transform)", () => {
  for (const frame of [0, 1, 3, 6, 100]) {
    assert.equal(computeScale(frame, 7, false), 1, `frame=${frame}`);
  }
});

test("zoom=true: scale is 1.0 at frame 0", () => {
  assert.equal(computeScale(0, 7, true), 1.0);
});

test("zoom=true: scale is 1.04 at last frame (framesPerPhoto-1)", () => {
  assert.ok(
    Math.abs(computeScale(6, 7, true) - 1.04) < 1e-10,
    "scale at frame 6 should be 1.04",
  );
});

test("zoom=true: scale is strictly between 1.0 and 1.04 at mid-window frames", () => {
  const mid = computeScale(3, 7, true);
  assert.ok(mid > 1.0 && mid < 1.04, `mid-frame scale ${mid} should be between 1.0 and 1.04`);
});

test("zoom=true: scale is clamped at 1.04 beyond framesPerPhoto", () => {
  assert.ok(Math.abs(computeScale(100, 7, true) - 1.04) < 1e-10, "should clamp at 1.04");
});

test("zoom=true: scale is clamped at 1.0 below frame 0", () => {
  assert.equal(computeScale(-5, 7, true), 1.0, "negative frames clamp to 1.0");
});

test("missing zoom in props defaults to static behaviour (zoom=false path)", () => {
  const props: PhotoReelStaticProps = { photos: ["u"], framesPerPhoto: 7 };
  const zoom = props.zoom ?? false;
  assert.equal(computeScale(6, 7, zoom), 1, "undefined zoom treated as false");
});
