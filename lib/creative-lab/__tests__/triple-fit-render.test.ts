import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import sharp from "sharp";

import type { Piece } from "../artist-card.ts";
import { planClipLayout, planVideoClaim, type VideoClaimPlan } from "../t1-video.ts";
import { tripleFitTypeChecks } from "../triple-fit.ts";
import { buildTripleFitLayers } from "../triple-fit-render.ts";

const measure = (t: string, cap: number) => t.length * 0.35 * cap;
const roll = planVideoClaim("Early bird, 1st & 2nd release sold out\n3rd release selling fast", measure) as VideoClaimPlan;

function tree(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".git" || name === ".next") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? tree(path) : [path];
  });
}

describe("triple-fit render", () => {
  it("paints arrangement B bands and the top block at 1080 × 1920", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 255 } } }).png().toBuffer();
    const piece = (w: number, h: number, cap: number, label: string): Piece => ({ png, width: w, height: h, capPx: cap, label });
    const layout = planClipLayout({ lockup: piece(1290, 388, 0, "lockup"), name: piece(1000, 220, 220, "name"), date: piece(800, 60, 60, "date"), claim: roll }, "9:16", "B");
    assert.ok(tripleFitTypeChecks(layout).every((check) => check.ok));
    const painted = await buildTripleFitLayers({ ...layout, claim: [] }, null);
    const bands = await sharp(painted.bands).metadata();
    const top = await sharp(painted.top).metadata();
    assert.deepEqual([bands.width, bands.height], [1080, 1920]);
    assert.deepEqual([top.width, top.height], [1080, 1920]);
    assert.equal(painted.claim, null);
  });

  it("the pending stub is gone", () => {
    const needle = "triple-fit composition " + "pending";
    const hits = tree(process.cwd()).filter((path) => readFileSync(path).includes(needle));
    assert.deepEqual(hits, []);
  });
});
