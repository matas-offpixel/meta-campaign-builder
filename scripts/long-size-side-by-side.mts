/**
 * Photographs the unapproved long caption size on the raw UGC 1 frame.
 *
 * The captioned UGC folder had no long overlay to measure, so the size is
 * 0.75× the locked default. This still is the sign-off image. Production
 * renders do not set unapprovedProof and still refuse the long size.
 *
 *   npx tsx scripts/long-size-side-by-side.mts /path/to/ugc1-raw-15.17s.png
 *
 * The frame is raw UGC 1 at 15.17s (the same moment as the reference
 * caption, after the 14.17s audio lag). The left panel is the existing
 * default-size reference.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import sharp from "sharp";

import { wrapCaption } from "../lib/creative-lab/caption-facts.ts";
import { profile, styleVersion } from "../src/remotion/caption-style/profile.ts";
import type { CaptionOnClipProps } from "../src/remotion/compositions/CaptionOnClip.tsx";

const LINE = "Prospa at NX last season. This season: Interplanetary Criminal, Schak, East End Dubs and more.";
const root = process.cwd();
const sourcePng = path.join(root, "docs/creative-lab/ugc1-side-by-side.png");
const outPng = path.join(root, "docs/creative-lab/long-size-side-by-side.png");

const rawFrame = process.argv[2];
if (!rawFrame) throw new Error("Pass the raw UGC 1 frame png (15.17s).");
const rawMeta = await sharp(rawFrame).metadata();
const panelW = rawMeta.width ?? 0;
const evenH = rawMeta.height ?? 0;
if (panelW < 2 || evenH < 2) throw new Error("raw frame has no size");
const refMeta = await sharp(sourcePng).metadata();
const refW = Math.floor((refMeta.width ?? 0) / 2);
const refH = evenH;
const dir = mkdtempSync(path.join(tmpdir(), "creative-lab-long-"));
const still = path.join(dir, "long.png");

const version = await styleVersion();
const lines = wrapCaption(LINE, profile.long.charsPerLine, ["Prospa", "Interplanetary Criminal", "Schak", "East End Dubs"]);
const props: CaptionOnClipProps = {
  clipUrl: "",
  lines,
  styleVersion: version,
  aspect: "9:16",
  audio: "muted",
  cropFocusY: 0.5,
  sourceWidth: panelW,
  sourceHeight: evenH,
  fps: 30,
  durationInSeconds: 1,
  plate: "black",
  size: "long",
  unapprovedProof: true,
};

const serveUrl = await bundle({ entryPoint: path.join(root, "src/remotion/index.tsx"), outDir: path.join(dir, "bundle") });
const composition = await selectComposition({ serveUrl, id: "CaptionOnClip", inputProps: props as unknown as Record<string, unknown> });
await renderStill({
  composition,
  serveUrl,
  output: still,
  inputProps: props as unknown as Record<string, unknown>,
  frame: 0,
});

const reference = await sharp(sourcePng).extract({ left: 0, top: 0, width: refW, height: Math.min(refH, (refMeta.height ?? refH) - 36) }).resize(panelW, evenH).png().toBuffer();
const keyed = await sharp(still)
  .resize(panelW, evenH)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
for (let i = 0; i < keyed.data.length; i += 4) {
  const r = keyed.data[i];
  const g = keyed.data[i + 1];
  const b = keyed.data[i + 2];
  if (g > 80 && g > r * 1.4 && g > b * 1.4) keyed.data[i + 3] = 0;
}
// The stored UGC file already has the reference caption burned in.
// Blur that band so the long size is the only type on the plate.
const blurTop = Math.round(evenH * 0.27);
const blurHeight = Math.round(evenH * 0.18);
const plate = await sharp(rawFrame)
  .composite([
    {
      input: await sharp(rawFrame).extract({ left: 0, top: blurTop, width: panelW, height: blurHeight }).blur(24).png().toBuffer(),
      left: 0,
      top: blurTop,
    },
  ])
  .png()
  .toBuffer();
const long = await sharp(plate)
  .composite([{ input: await sharp(keyed.data, { raw: { width: keyed.info.width, height: keyed.info.height, channels: 4 } }).png().toBuffer(), left: 0, top: 0 }])
  .png()
  .toBuffer();
const labelH = 64;
const label = Buffer.from(
  `<svg width="${panelW * 2}" height="${labelH}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#111"/>
    <text x="${panelW / 2}" y="28" fill="#fff" font-family="sans-serif" font-size="16" text-anchor="middle">UGC 1 reference, default size</text>
    <text x="${panelW + panelW / 2}" y="28" fill="#fff" font-family="sans-serif" font-size="16" text-anchor="middle">Long size, 0.75×, not approved</text>
    <text x="${panelW + panelW / 2}" y="50" fill="#bbb" font-family="sans-serif" font-size="13" text-anchor="middle">Up to 5 lines of 24. Not approved. This sentence wraps to ${lines.length} lines.</text>
  </svg>`,
);

await sharp({
  create: { width: panelW * 2, height: evenH + labelH, channels: 3, background: "#111111" },
})
  .composite([
    { input: reference, left: 0, top: 0 },
    { input: long, left: panelW, top: 0 },
    { input: label, left: 0, top: evenH },
  ])
  .png()
  .toFile(outPng);

console.log(`wrote ${outPng}`);
console.log(`${LINE.length} characters, ${lines.length} lines at ${profile.long.charsPerLine}`);
console.log(lines.join(" | "));
console.log(`style_version ${version}`);
