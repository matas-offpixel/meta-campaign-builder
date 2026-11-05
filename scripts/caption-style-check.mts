/**
 * Reference-frame check for the locked caption style. Not wired into CI:
 * it renders one still through Remotion, which needs the bundle and Chrome.
 *
 *   npm run bundle-remotion
 *   npx tsx scripts/caption-style-check.mts
 *
 * Renders the reference lines on black, thresholds that and the committed
 * frame inside the box in reference.json, and prints SSIM + overlap.
 *
 * The fixture is still the captioned UGC 1 mask. Approval of
 * docs/creative-lab/ugc1-side-by-side.png is pending, so the script prints
 * the score and exits 0. Once that render is approved, the fixture becomes
 * its caption mask and CAPTION_SSIM_MIN (0.95) is a drift guard.
 */

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { renderStill, selectComposition } from "@remotion/renderer";

import { maskOverlap, readPng, ssim, thresholdBox, type Box } from "../lib/creative-lab/ssim.ts";
import { styleVersion } from "../src/remotion/caption-style/profile.ts";
import type { CaptionOnClipProps } from "../src/remotion/compositions/CaptionOnClip.tsx";

/** Applies once docs/creative-lab/ugc1-side-by-side.png is approved. */
const CAPTION_SSIM_MIN = 0.95;

const root = process.cwd();
const reference = JSON.parse(readFileSync(path.join(root, "src/remotion/caption-style/reference/reference.json"), "utf8")) as {
  lines: string[];
  frame: { width: number; height: number };
  box: Box;
  lumaMin: number;
};
const box = reference.box;
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

const referenceMask = thresholdBox(readPng(readFileSync(path.join(root, "src/remotion/caption-style/reference/frame.png"))), box, reference.lumaMin);
const renderedMask = thresholdBox(readPng(readFileSync(output)), box, reference.lumaMin);
const score = ssim(referenceMask, renderedMask, box.width, box.height);
const overlap = maskOverlap(referenceMask, renderedMask);

console.log(`SSIM ${score.toFixed(4)}  dice ${overlap.dice.toFixed(4)}  iou ${overlap.iou.toFixed(4)}`);
console.log(`style_version ${version}`);
console.log(`rendered ${output}`);
console.log(`pending approval: docs/creative-lab/ugc1-side-by-side.png. After that render is approved, this check scores its caption mask and exits non-zero under ${CAPTION_SSIM_MIN}.`);
