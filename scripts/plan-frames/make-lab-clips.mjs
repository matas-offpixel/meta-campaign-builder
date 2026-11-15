/**
 * Writes the two Creative Lab fixture clips the CL frames play:
 *
 *   public/frames/fixtures/clip-916.webm   360×640, native 9:16
 *   public/frames/fixtures/clip-169.webm   640×360, landscape
 *
 * Synthetic stage scenes (lights over a crowd), drawn on a canvas in
 * Playwright's Chromium, 2 s at 12 fps, encoded VP9. VP9 because
 * Playwright's Chromium has no H.264 decoder. No real footage, no
 * network. Run once; the output is committed.
 *
 * The first second is one still frame. The tiles seek to 0.5 s on
 * loadedmetadata, but when metadata arrives before hydration that seek
 * never runs and the video sits at 0 s. A still first second makes both
 * the same picture, so the shot does not depend on that race.
 *
 *   FFMPEG=/path/to/ffmpeg node scripts/plan-frames/make-lab-clips.mjs
 *
 * FFMPEG defaults to Remotion's bundled ffmpeg for this platform.
 */

import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "public/frames/fixtures");
const FPS = 12;
const FRAMES = 24;

function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const dir = path.join(ROOT, `node_modules/@remotion/compositor-${process.platform}-${process.arch}`);
  const bin = path.join(dir, "ffmpeg");
  if (!existsSync(bin)) throw new Error(`no ffmpeg at ${bin}; set FFMPEG`);
  return bin;
}

const CLIPS = [
  { file: "clip-916.webm", width: 360, height: 640, hue: 330 },
  { file: "clip-169.webm", width: 640, height: 360, hue: 200 },
];

/** Runs in the page. Deterministic: same frame index, same pixels. */
function drawFrame({ width, height, hue, index, total }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const t = index / total;
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, `hsl(${hue}, 45%, 9%)`);
  bg.addColorStop(0.6, `hsl(${hue + 20}, 35%, 14%)`);
  bg.addColorStop(1, "hsl(0, 0%, 3%)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "lighter";
  const beams = 5;
  for (let i = 0; i < beams; i += 1) {
    const x = width * ((i + 0.5) / beams);
    const sway = Math.sin(t * Math.PI * 2 + i * 1.3) * width * 0.08;
    const grad = ctx.createLinearGradient(x, 0, x + sway, height * 0.8);
    const h = hue + i * 35;
    grad.addColorStop(0, `hsla(${h}, 90%, 65%, 0.55)`);
    grad.addColorStop(1, `hsla(${h}, 90%, 50%, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x - width * 0.01, 0);
    ctx.lineTo(x + width * 0.01, 0);
    ctx.lineTo(x + sway + width * 0.12, height * 0.8);
    ctx.lineTo(x + sway - width * 0.12, height * 0.8);
    ctx.closePath();
    ctx.fill();
  }
  const glow = ctx.createRadialGradient(width / 2, height * 0.55, 0, width / 2, height * 0.55, width * 0.5);
  glow.addColorStop(0, `hsla(${hue + 40}, 80%, 60%, 0.35)`);
  glow.addColorStop(1, "hsla(0, 0%, 0%, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "hsl(0, 0%, 2%)";
  const heads = Math.round(width / 26);
  for (let i = 0; i < heads; i += 1) {
    const x = (i + 0.5) * (width / heads);
    const bob = Math.sin(t * Math.PI * 4 + i * 2.1) * height * 0.006;
    const y = height * (0.86 + ((i * 37) % 7) * 0.006) + bob;
    const r = width / heads / 2.1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x - r * 1.4, y + r * 0.6, r * 2.8, height);
  }
  if (index % 12 < 6) {
    ctx.fillRect(width * 0.62, height * 0.7, width * 0.025, height * 0.18);
  }
  return canvas.toDataURL("image/png");

}

async function main() {
  const ffmpeg = ffmpegPath();
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    for (const clip of CLIPS) {
      const dir = await mkdtemp(path.join(os.tmpdir(), "lab-clip-"));
      try {
        for (let index = 0; index < FRAMES; index += 1) {
          const url = await page.evaluate(drawFrame, { ...clip, index: index < FPS ? 0 : index, total: FRAMES });
          const png = Buffer.from(url.split(",")[1], "base64");
          await writeFile(path.join(dir, `f${String(index).padStart(3, "0")}.png`), png);
        }
        const dest = path.join(OUT, clip.file);
        const run = spawnSync(
          ffmpeg,
          [
            "-y", "-loglevel", "error",
            "-framerate", String(FPS),
            "-i", path.join(dir, "f%03d.png"),
            "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36",
            "-pix_fmt", "yuv420p", "-row-mt", "1",
            "-an", dest,
          ],
          { env: { ...process.env, DYLD_LIBRARY_PATH: path.dirname(ffmpeg), LD_LIBRARY_PATH: path.dirname(ffmpeg) }, stdio: "inherit" },
        );
        if (run.status !== 0) throw new Error(`ffmpeg failed for ${clip.file}`);
        console.log(`wrote ${path.relative(ROOT, dest)}`);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
