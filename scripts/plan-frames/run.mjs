/**
 * Render each plan-v2 frame against `next start` and write / diff
 * `docs/frames/<id>.png`. 0.2% pixel tolerance.
 *
 *   ENABLE_PLAN_FRAMES=1 npm run frames        # write baselines
 *   ENABLE_PLAN_FRAMES=1 npm run frames:check  # fail on a diff
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const CANON = [
  "L1", "L2", "L3", "L4", "L5", "L6",
  "A1", "A2", "A4", "A6", "A8", "A9", "A10", "A11", "A13", "A14", "A15",
  "J1", "J2", "J3", "J5", "J7", "J8", "J9", "J12", "J14", "J18", "J19", "J22",
  "E1", "E2", "E3", "E6",
];
const FRAME_SHOTS = [
  ...[...CANON, "J0"].map((id) => ({ id, width: 1176 })),
  { id: "L3-768", width: 768 },
  { id: "J2-768", width: 768 },
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "docs/frames");
const PORT = Number(process.env.PLAN_FRAMES_PORT ?? 3310);
const BASE = `http://127.0.0.1:${PORT}`;
const TOLERANCE = 0.002;
const UPDATE = process.argv.includes("--update");

function shotFile(id) {
  return path.join(OUT, `${id}.png`);
}

async function waitForServer(url, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`frames server did not start: ${url}`);
}

function startServer() {
  const child = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, ENABLE_PLAN_FRAMES: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (buf) => process.stdout.write(buf));
  child.stderr.on("data", (buf) => process.stderr.write(buf));
  return child;
}

function diffRatio(baseline, current) {
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return 1;
  }
  const diff = pixelmatch(
    baseline.data,
    current.data,
    null,
    baseline.width,
    baseline.height,
    { threshold: 0.1 },
  );
  return diff / (baseline.width * baseline.height);
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
  const server = startServer();
  let failed = false;
  try {
    await waitForServer(`${BASE}/frames/L1`);
    const browser = await chromium.launch();
    try {
      for (const shot of FRAME_SHOTS) {
        const frameId = shot.id.replace(/-768$/, "");
        const page = await browser.newPage({
          viewport: { width: shot.width, height: 900 },
          deviceScaleFactor: 1,
        });
        const res = await page.goto(`${BASE}/frames/${frameId}`, {
          waitUntil: "networkidle",
        });
        if (!res || res.status() >= 400) {
          throw new Error(`${shot.id}: HTTP ${res?.status() ?? "no response"}`);
        }
        await page.waitForSelector(`[data-frame-ready="${frameId}"]`);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(150);
        const png = await page.screenshot({ fullPage: true, type: "png" });
        await page.close();
        const dest = shotFile(shot.id);
        if (UPDATE || !existsSync(dest)) {
          await writeFile(dest, png);
          const hash = createHash("sha1").update(png).digest("hex").slice(0, 8);
          console.log(`wrote ${shot.id} ${hash}`);
          continue;
        }
        const baseline = PNG.sync.read(await readFile(dest));
        const current = PNG.sync.read(png);
        const ratio = diffRatio(baseline, current);
        if (ratio > TOLERANCE) {
          failed = true;
          const pct = (ratio * 100).toFixed(3);
          console.error(`DIFF ${shot.id} ${pct}% (tolerance 0.2%)`);
        } else {
          console.log(`ok ${shot.id}`);
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill("SIGTERM");
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
