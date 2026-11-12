/**
 * Shoot the on-sale refresh frames (OR1 at 1280 and 393) from a running
 * `ENABLE_PLAN_FRAMES=1 next start` into an output folder. Evidence for
 * the design review while the shared frames registry is in another PR;
 * baselines still come from the Ubuntu workflow once the OR series is in
 * run.mjs.
 *
 *   ENABLE_PLAN_FRAMES=1 npm run build && ENABLE_PLAN_FRAMES=1 npx next start -p 3100 &
 *   node scripts/onsale-refresh-frames.mjs --base http://localhost:3100 --out frames-evidence/onsale-refresh
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

import { REFRESH_SHOTS } from "./plan-frames/refresh-shots.mjs";

const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const base = arg("--base", "http://localhost:3100");
const out = arg("--out", "frames-evidence/onsale-refresh");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const shot of REFRESH_SHOTS) {
    const page = await browser.newPage({ viewport: { width: shot.width, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(`${base}${shot.path}`, { waitUntil: "networkidle" });
    await page.waitForSelector(`[data-frame-ready="${shot.frame}"]`);
    const file = path.join(out, `${shot.id}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`${shot.id} → ${file}`);
    await page.close();
  }
} finally {
  await browser.close();
}
