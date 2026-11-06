/**
 * Reference-frame check for the locked caption style. Not wired into CI:
 * it renders one still through Remotion, which needs the bundle and Chrome.
 *
 *   npm run bundle-remotion
 *   npx tsx scripts/caption-style-check.mts
 *
 * Renders the reference lines on black, thresholds the caption box, and
 * scores that mask against reference/caption-mask.png. That fixture is the
 * approved render. CAPTION_SSIM_MIN is a drift guard: the script exits
 * non-zero when the score falls under it.
 */

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { renderStill, selectComposition } from "@remotion/renderer";

import { maskOverlap, readPng, ssim, thresholdBox, type Box } from "../lib/creative-lab/ssim.ts";
import { boxInsideRect, profile, styleVersion } from "../src/remotion/caption-style/profile.ts";
import type { CaptionOnClipProps } from "../src/remotion/compositions/CaptionOnClip.tsx";

const CAPTION_SSIM_MIN = 0.95;

const root = process.cwd();
const reference = JSON.parse(readFileSync(path.join(root, "src/remotion/caption-style/reference/reference.json"), "utf8")) as {
  lines: string[];
  frame: { width: number; height: number };
  safeRect: { x: number; y: number; w: number; h: number };
  box: Box;
  lumaMin: number;
};
const box = reference.box;
const spec = reference.safeRect;
if (spec.x !== profile.safeRect["9:16"].x || spec.y !== profile.safeRect["9:16"].y || spec.w !== profile.safeRect["9:16"].w || spec.h !== profile.safeRect["9:16"].h) {
  throw new Error("reference.json safeRect does not match the style profile");
}
const safe = {
  x: spec.x * reference.frame.width,
  y: spec.y * reference.frame.height,
  width: spec.w * reference.frame.width,
  height: spec.h * reference.frame.height,
};
if (!boxInsideRect(safe, { left: box.x, top: box.y, width: box.width, height: box.height })) {
  throw new Error("reference caption leaves the 4:5 safe rectangle");
}
const version = await styleVersion();
const bundle = path.join(root, ".remotion/bundle");

const props: CaptionOnClipProps = {
  clipUrl: "",
  lines: reference.lines,
  styleVersion: version,
  aspect: "9:16",
  audio: "original",
  cropFocusY: 0.5,
  sourceWidth: reference.frame.width,
  sourceHeight: reference.frame.height,
  fps: 30,
  durationInSeconds: 1,
  plate: "black",
};

const output = path.join(os.tmpdir(), "caption-style-check.png");
const composition = await selectComposition({ serveUrl: bundle, id: "CaptionOnClip", inputProps: props as unknown as Record<string, unknown> });
await renderStill({
  composition,
  serveUrl: bundle,
  output,
  inputProps: props as unknown as Record<string, unknown>,
  frame: 0,
});

const fixtureImage = readPng(readFileSync(path.join(root, "src/remotion/caption-style/reference/caption-mask.png")));
if (fixtureImage.width !== box.width || fixtureImage.height !== box.height) {
  throw new Error(`caption mask is ${fixtureImage.width}x${fixtureImage.height}, expected ${box.width}x${box.height}`);
}
const fixture = Uint8Array.from(fixtureImage.luma, (value) => (value >= 128 ? 255 : 0));
const renderedMask = thresholdBox(readPng(readFileSync(output)), box, reference.lumaMin);
const score = ssim(fixture, renderedMask, box.width, box.height);
const overlap = maskOverlap(fixture, renderedMask);

console.log(`SSIM ${score.toFixed(4)}  dice ${overlap.dice.toFixed(4)}  iou ${overlap.iou.toFixed(4)}`);
console.log(`style_version ${version}`);
console.log(`rendered ${output}`);
if (score < CAPTION_SSIM_MIN) {
  console.error(`caption mask drifted below ${CAPTION_SSIM_MIN}`);
  process.exit(1);
}
