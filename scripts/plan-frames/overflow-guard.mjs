/**
 * scripts/plan-frames/overflow-guard.mjs
 *
 * MB1 guard (docs/design-record/2026-11-14-dashboard-v2-phone.html): no
 * page-level sideways scroll on dashboard v2 at any width from 320 px up.
 * Opens the live-like frames (MBO internal, MBS share link: nine long show
 * names, four venue options, the longest header sentence) at 320, 375, 390
 * and 430 and fails when
 *   - the document's scroll width is more than the viewport width, or
 *   - any element outside a scrolling row (overflow-x auto or scroll) has
 *     its right edge past the viewport.
 *
 *   ENABLE_PLAN_FRAMES=1 npm run build && ENABLE_PLAN_FRAMES=1 node scripts/plan-frames/overflow-guard.mjs
 *   node scripts/plan-frames/overflow-guard.mjs --base http://127.0.0.1:3000   # a running server (next dev)
 *
 * Writes frames-evidence/overflow-guard.md and .json (uploaded with the
 * plan-frames artifact). Fixtures only: no Supabase, no platform calls.
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE = path.join(ROOT, "frames-evidence");
const argBase = process.argv.indexOf("--base");
const PORT = Number(process.env.OVERFLOW_GUARD_PORT ?? 3311);
const BASE = argBase >= 0 ? process.argv[argBase + 1] : `http://127.0.0.1:${PORT}`;

export const OVERFLOW_FRAMES = ["sales/MBO", "sales/MBS", "sales/MBF375", "sales/MBM", "sales/MBA", "sales/MBH1"];
export const OVERFLOW_WIDTHS = [320, 375, 390, 430];

/**
 * MB2 budgets: on the first screen, everything to "More figures" fits at
 * 375 × 548 and 390 × 664, and at 430 × 739 the chart with its axes fits too.
 */
export const FOLD_BUDGETS = [
  { frame: "sales/MBF375", width: 375, height: 548, until: "[data-more-figures]", what: "More figures" },
  { frame: "sales/MBF390", width: 390, height: 664, until: "[data-more-figures]", what: "More figures" },
  { frame: "sales/MBF430", width: 430, height: 739, until: "[data-phone-plot]", what: "the chart and its axes" },
];

/** MB6: the chart as it opens (MBC) shows the period's last day at the right end. */
export const OPENS_ON_LATEST = { frame: "sales/MBC", lastDay: "13 Nov" };

async function waitForServer(url, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(4000) });
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`overflow guard: server did not start: ${url}`);
}

/** Runs in the page: the scroll width, and every element past the right edge that no scrolling row holds. */
function measure() {
  const vw = document.documentElement.clientWidth;
  const scrollWidth = document.documentElement.scrollWidth;
  const scrolls = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
    return false;
  };
  const describe = (el) => {
    const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 50);
    const cls = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 4).join(".") : "";
    return `<${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}> "${text}"`;
  };
  const past = [];
  for (const el of document.querySelectorAll("[data-frame-ready] *")) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.right <= vw + 0.5) continue;
    if (scrolls(el)) continue;
    past.push({ el: describe(el), right: Math.round(rect.right) });
  }
  return { vw, scrollWidth, past };
}

async function main() {
  const server =
    argBase >= 0
      ? null
      : spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: ROOT, env: { ...process.env, ENABLE_PLAN_FRAMES: "1" }, stdio: "inherit" });
  const rows = [];
  const folds = [];
  const opens = [];
  let failed = false;
  try {
    await waitForServer(`${BASE}/frames/${OVERFLOW_FRAMES[0]}`);
    const browser = await chromium.launch({ timeout: 30_000, args: ["--lang=en-GB"] });
    try {
      for (const frame of OVERFLOW_FRAMES) {
        for (const width of OVERFLOW_WIDTHS) {
          const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 1, locale: "en-GB" });
          const res = await page.goto(`${BASE}/frames/${frame}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
          if (!res || res.status() >= 400) throw new Error(`${frame} @ ${width}: HTTP ${res?.status() ?? "no response"}`);
          await page.waitForSelector(`[data-frame-ready="${frame}"]`, { timeout: 30_000 });
          await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2000))]));
          await page.waitForTimeout(150);
          const m = await page.evaluate(measure);
          await page.close();
          const ok = m.scrollWidth <= m.vw && m.past.length === 0;
          if (!ok) failed = true;
          rows.push({ frame, width, ok, scrollWidth: m.scrollWidth, viewport: m.vw, past: m.past.slice(0, 8), pastCount: m.past.length });
          console.log(`${ok ? "ok  " : "FAIL"} ${frame} @ ${width}: scroll width ${m.scrollWidth} / ${m.vw}${m.past.length ? `, ${m.past.length} past the edge: ${m.past.slice(0, 3).map((p) => `${p.el} → ${p.right}`).join("; ")}` : ""}`);
        }
      }
      // MB6: the phone chart opens on the latest day (the range in view ends on the last day).
      {
        const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, locale: "en-GB" });
        await page.goto(`${BASE}/frames/${OPENS_ON_LATEST.frame}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForSelector(`[data-frame-ready="${OPENS_ON_LATEST.frame}"]`, { timeout: 30_000 });
        // As the frames runner waits before its screenshot: fonts, then 150 ms.
        await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2000))]));
        await page.waitForTimeout(150);
        const range = await page.evaluate(() => (document.querySelector("[data-phone-chart] [data-range]")?.textContent ?? "").replace(/ /g, " "));
        await page.close();
        const ok = range.endsWith(OPENS_ON_LATEST.lastDay);
        if (!ok) failed = true;
        opens.push({ ...OPENS_ON_LATEST, range, ok });
        console.log(`${ok ? "ok  " : "FAIL"} chart opens on the latest day: range "${range}"`);
      }
      for (const budget of FOLD_BUDGETS) {
        const page = await browser.newPage({ viewport: { width: budget.width, height: budget.height }, deviceScaleFactor: 1, locale: "en-GB" });
        await page.goto(`${BASE}/frames/${budget.frame}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForSelector(`[data-frame-ready="${budget.frame}"]`, { timeout: 30_000 });
        await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2000))]));
        await page.waitForTimeout(150);
        const bottom = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          return el ? Math.ceil(el.getBoundingClientRect().bottom + window.scrollY) : null;
        }, budget.until);
        await page.close();
        const ok = bottom != null && bottom <= budget.height;
        if (!ok) failed = true;
        folds.push({ ...budget, bottom, ok });
        console.log(`${ok ? "ok  " : "FAIL"} fold ${budget.width}×${budget.height}: ${budget.what} ends at ${bottom ?? "missing"}`);
      }
    } finally {
      await browser.close();
    }
  } finally {
    server?.kill("SIGTERM");
  }
  await mkdir(EVIDENCE, { recursive: true });
  await writeFile(path.join(EVIDENCE, "overflow-guard.json"), JSON.stringify({ overflow: rows, folds, opens }, null, 2));
  const md = [
    "# Overflow guard (MB1)",
    "",
    "| Frame | Width | Scroll width | Past the edge | Result |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.frame} | ${r.width} | ${r.scrollWidth} | ${r.pastCount} | ${r.ok ? "ok" : "FAIL"} |`),
    "",
    "## First screen (MB2)",
    "",
    "| Viewport | Must fit | Ends at | Result |",
    "|---|---|---|---|",
    ...folds.map((f) => `| ${f.width}×${f.height} | ${f.what} | ${f.bottom ?? "missing"} | ${f.ok ? "ok" : "FAIL"} |`),
    "",
    "## Phone chart opens on the latest day (MB6)",
    "",
    ...opens.map((o) => `- ${o.frame}: range "${o.range}" → ${o.ok ? "ok" : "FAIL"} (must end on ${o.lastDay})`),
    "",
    ...rows.filter((r) => !r.ok).flatMap((r) => [`## ${r.frame} @ ${r.width}`, ...r.past.map((p) => `- ${p.el} → right ${p.right}`), ""]),
  ].join("\n");
  await writeFile(path.join(EVIDENCE, "overflow-guard.md"), md);
  if (failed) {
    console.error("overflow guard: a dashboard v2 page is wider than the phone (MB1). See frames-evidence/overflow-guard.md.");
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
