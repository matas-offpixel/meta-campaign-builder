/**
 * Unit tests for PhotoReelStatic composition logic.
 *
 * Covers:
 * 1. PhotoReelStaticProps shape is accepted by the type system
 * 2. durationInFrames calculation (photos.length × framesPerPhoto)
 * 3. Empty-photos guard: calculateMetadata returns at least 1 frame
 *
 * These tests run in Node via `node --experimental-strip-types --test`
 * without invoking the Remotion bundler or a React renderer.
 * The PhotoReelStaticProps interface is defined inline here to avoid
 * importing from a JSX/TSX file which Node cannot strip-type.
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
}

// ---------------------------------------------------------------------------
// Pure helper — mirrors calculateMetadata from src/remotion/index.tsx.
// Tested without importing Remotion (browser env not available in node:test).
// ---------------------------------------------------------------------------
function calcDuration(props: PhotoReelStaticProps): number {
  return Math.max(1, props.photos.length * props.framesPerPhoto);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("PhotoReelStaticProps: type accepts expected shape", () => {
  const props: PhotoReelStaticProps = {
    photos: ["https://example.com/bridge-01.jpeg"],
    framesPerPhoto: 7,
  };
  assert.equal(props.photos.length, 1);
  assert.equal(props.framesPerPhoto, 7);
});

test("durationInFrames = photos.length × framesPerPhoto (64 × 7 = 448)", () => {
  const fakeUrls = Array.from(
    { length: 64 },
    (_, i) => `https://cdn.test/bridge-${String(i + 1).padStart(2, "0")}.jpeg`,
  );
  const props: PhotoReelStaticProps = { photos: fakeUrls, framesPerPhoto: 7 };
  assert.equal(calcDuration(props), 448);
});

test("durationInFrames with various photo counts", () => {
  assert.equal(calcDuration({ photos: Array(10).fill("u"), framesPerPhoto: 5 }), 50);
  assert.equal(calcDuration({ photos: Array(1).fill("u"), framesPerPhoto: 30 }), 30);
  assert.equal(calcDuration({ photos: Array(100).fill("u"), framesPerPhoto: 3 }), 300);
});

test("empty photos array: calcDuration returns 1 (no-op safety)", () => {
  const props: PhotoReelStaticProps = { photos: [], framesPerPhoto: 7 };
  assert.equal(calcDuration(props), 1);
});

test("framesPerPhoto=0: clamped to minimum 1 frame", () => {
  const props: PhotoReelStaticProps = { photos: ["u"], framesPerPhoto: 0 };
  assert.equal(calcDuration(props), 1);
});
