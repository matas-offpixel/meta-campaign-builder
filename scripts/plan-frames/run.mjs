/**
 * Render each frame against `next start` and write / diff
 * `docs/frames/<id>.png`. 0.2% pixel tolerance.
 *
 * Raster truth is Ubuntu CI (Playwright 1.63.0 Chromium). `frames:check`
 * is the CI truth. `npm run frames -- --local` writes `docs/frames/local/`
 * for looking, not asserting.
 *
 * Every run also writes the evidence pack to `frames-evidence/` (the CI
 * artifact): `shots/<id>.png` for every shot, `diff/<id>/{expected,
 * actual,diff}.png` for each shot over tolerance, and `index.md` /
 * `index.json` mapping each file to its frame id and width.
 *
 *   ENABLE_PLAN_FRAMES=1 npm run frames        # write Ubuntu baselines
 *   ENABLE_PLAN_FRAMES=1 npm run frames:check  # fail on a missing baseline or a diff (CI)
 *   ENABLE_PLAN_FRAMES=1 npm run frames -- --local
 *   … run.mjs --check --only CL                # only shots whose id starts with CL
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

import { classifyShot, missingBaselineLine } from "./baseline.mjs";
import { evidenceIndex } from "./evidence.mjs";
import { LAB_SHOTS } from "./lab-shots.mjs";

const PLAYWRIGHT_PIN = "1.63.0";
const require = createRequire(import.meta.url);
const playwrightVersion = require("@playwright/test/package.json").version;
if (playwrightVersion !== PLAYWRIGHT_PIN) {
  console.error(`Playwright must be ${PLAYWRIGHT_PIN} (Chromium r1243), got ${playwrightVersion}`);
  process.exit(1);
}

const CANON = [
  "L1", "L2", "L3", "L4", "L5", "L6",
  "A0", "A1", "A2", "A4", "A6", "A8", "A9", "A10", "A11", "A13", "A14", "A15",
  "J1", "J2", "J3", "J5", "J7", "J8", "J9", "J12", "J14", "J18", "J19", "J22",
  "E1", "E2", "E3", "E6",
];
const PLAN_SHOTS = [
  ...[...CANON, "J0"].map((id) => ({ id, frame: id, width: 1176 })),
  { id: "L3-768", frame: "L3", width: 768 },
  { id: "J2-768", frame: "J2", width: 768 },
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOCAL = process.argv.includes("--local");
const OUT = path.join(ROOT, LOCAL ? "docs/frames/local" : "docs/frames");
const EVIDENCE = path.join(ROOT, "frames-evidence");
const PORT = Number(process.env.PLAN_FRAMES_PORT ?? 3310);
const BASE = `http://127.0.0.1:${PORT}`;
const TOLERANCE = 0.002;
const UPDATE = LOCAL || process.argv.includes("--update");
const ONLY = (() => {
  const at = process.argv.indexOf("--only");
  return at >= 0 ? process.argv[at + 1] ?? "" : "";
})();
const FRAME_SHOTS = [...PLAN_SHOTS, ...LAB_SHOTS].filter((shot) => !ONLY || shot.id.startsWith(ONLY));

function shotFile(id) {
  return path.join(OUT, `${id}.png`);
}

async function waitForServer(url, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(4000) });
      if (res.status < 500) return;
    } catch {
      /* not up or still compiling */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`frames server did not start: ${url}`);
}

function startServer() {
  const child = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, ENABLE_PLAN_FRAMES: "1" },
    stdio: "inherit",
  });
  return child;
}

/** Share of pixels over threshold, and the diff image when the sizes match. */
function compare(baseline, current) {
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return { ratio: 1, diff: null };
  }
  const diff = new PNG({ width: baseline.width, height: baseline.height });
  const count = pixelmatch(
    baseline.data,
    current.data,
    diff.data,
    baseline.width,
    baseline.height,
    { threshold: 0.1 },
  );
  return { ratio: count / (baseline.width * baseline.height), diff };
}

/**
 * Lab frames play real video and set the caption in TikTok Sans. Every
 * declared font face must load, and every visible video must show its
 * poster frame.
 *
 * The clip tiles and caption overlay seek to their poster in
 * onLoadedMetadata. When metadata arrives before React hydrates, that
 * handler never runs and the video sits unpainted at 0 s, so the shot
 * would depend on a race. Once each visible video is hydrated and has
 * metadata, the runner fires loadedmetadata again so the component's
 * own handler seeks it, then waits for the seek and a painted frame.
 */
async function settleLab(page, shotId) {
  // next/font's "<family> Fallback" faces point at a local() system font
  // and fail where it isn't installed (Ubuntu CI). Only real faces count.
  const unloaded = await page.evaluate(async () => {
    const faces = [...document.fonts].filter((face) => !/ Fallback["']?$/.test(face.family));
    await Promise.all(faces.map((face) => (face.status === "loaded" ? face : face.load().catch(() => face))));
    return faces.filter((face) => face.status !== "loaded").map((face) => face.family);
  });
  if (unloaded.length) throw new Error(`${shotId}: fonts not loaded: ${unloaded.join(", ")}`);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("video")]
        .filter((node) => node.getClientRects().length > 0)
        .every((node) => node.readyState >= 1 && Object.keys(node).some((key) => key.startsWith("__reactProps"))),
    null,
    { timeout: 15_000 },
  );
  const stuck = await page.evaluate(async () => {
    const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve("timeout"), ms));
    const videos = [...document.querySelectorAll("video")].filter((node) => node.getClientRects().length > 0);
    const results = await Promise.all(
      videos.map(async (node) => {
        const painted = new Promise((resolve) => node.requestVideoFrameCallback(() => resolve("painted")));
        const seeked = new Promise((resolve) => node.addEventListener("seeked", () => resolve("seeked"), { once: true }));
        node.dispatchEvent(new Event("loadedmetadata"));
        const seek = node.seeking ? await Promise.race([seeked, timeout(10_000)]) : "no-seek";
        await Promise.race([painted, timeout(3000)]);
        return seek === "timeout" || node.readyState < 2 ? node.getAttribute("src") : null;
      }),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return results.filter(Boolean);
  });
  if (stuck.length) throw new Error(`${shotId}: video never reached its poster: ${stuck.join(", ")}`);
}

async function main() {
  if (process.env.ENABLE_PLAN_FRAMES !== "1") {
    console.error("ENABLE_PLAN_FRAMES=1 is required");
    process.exit(1);
  }
  if (!existsSync(path.join(ROOT, ".next"))) {
    console.error("Run `ENABLE_PLAN_FRAMES=1 npm run build` first");
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });
  await rm(EVIDENCE, { recursive: true, force: true });
  await mkdir(path.join(EVIDENCE, "shots"), { recursive: true });
  const results = [];
  const server = startServer();
  let failed = false;
  try {
    console.log(`waiting for ${BASE}/frames/L1`);
    await waitForServer(`${BASE}/frames/L1`);
    console.log("server up");
    const browser = await chromium.launch({ timeout: 30_000 });
    try {
      for (const shot of FRAME_SHOTS) {
        const dest = shotFile(shot.id);
        const action = classifyShot({ destExists: existsSync(dest), update: UPDATE });
        console.log(`capture ${shot.id}`);
        const page = await browser.newPage({
          viewport: { width: shot.width, height: 900 },
          deviceScaleFactor: 1,
        });
        const res = await page.goto(`${BASE}/frames/${shot.frame}`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        if (!res || res.status() >= 400) {
          throw new Error(`${shot.id}: HTTP ${res?.status() ?? "no response"}`);
        }
        await page.waitForSelector(`[data-frame-ready="${shot.frame}"]`, { timeout: 15_000 });
        if (shot.lab) {
          if (shot.before) await shot.before(page, shot.width);
          await settleLab(page, shot.id);
        } else {
          await page.evaluate(
            () => Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 2000))]),
          );
        }
        await page.waitForTimeout(150);
        const png = await page.locator(`[data-frame-ready="${shot.frame}"]`).screenshot({
          type: "png",
          timeout: 15_000,
        });
        await page.close();
        const shotPath = `shots/${shot.id}.png`;
        await writeFile(path.join(EVIDENCE, shotPath), png);
        const row = { id: shot.id, frame: shot.frame, width: shot.width, shot: shotPath, status: "ok", diffPct: null, diff: null };
        results.push(row);
        if (action === "missing") {
          failed = true;
          row.status = "missing";
          console.error(missingBaselineLine(shot.id));
          continue;
        }
        if (action === "write") {
          await writeFile(dest, png);
          const hash = createHash("sha1").update(png).digest("hex").slice(0, 8);
          row.status = "written";
          console.log(`wrote ${shot.id} ${hash}`);
          continue;
        }
        const expectedBytes = await readFile(dest);
        const baseline = PNG.sync.read(expectedBytes);
        const current = PNG.sync.read(png);
        const { ratio, diff } = compare(baseline, current);
        if (ratio > TOLERANCE) {
          failed = true;
          const dir = `diff/${shot.id}`;
          await mkdir(path.join(EVIDENCE, dir), { recursive: true });
          await writeFile(path.join(EVIDENCE, dir, "expected.png"), expectedBytes);
          await writeFile(path.join(EVIDENCE, dir, "actual.png"), png);
          if (diff) await writeFile(path.join(EVIDENCE, dir, "diff.png"), PNG.sync.write(diff));
          row.status = diff ? "diff" : "resized";
          row.diffPct = diff ? Number((ratio * 100).toFixed(3)) : null;
          row.diff = {
            dir,
            expected: `${baseline.width}×${baseline.height}`,
            actual: `${current.width}×${current.height}`,
            hasDiffImage: Boolean(diff),
          };
          console.error(
            diff
              ? `DIFF ${shot.id} ${row.diffPct}% (tolerance 0.2%)`
              : `DIFF ${shot.id} size ${row.diff.expected} → ${row.diff.actual}`,
          );
        } else {
          console.log(`ok ${shot.id}`);
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill("SIGTERM");
    const index = evidenceIndex(results, { tolerance: TOLERANCE, sha: process.env.FRAMES_HEAD_SHA || process.env.GITHUB_SHA || null });
    await writeFile(path.join(EVIDENCE, "index.json"), `${JSON.stringify(index.json, null, 2)}\n`);
    await writeFile(path.join(EVIDENCE, "index.md"), index.markdown);
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
