import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import sharp from "sharp";

import type { Piece } from "../artist-card.ts";
import { planClipLayout, planVideoClaim, type VideoClaimPlan } from "../t1-video.ts";
import { tripleFitTypeChecks } from "../triple-fit.ts";
import { buildTripleFitLayers, clipKitPieces } from "../triple-fit-render.ts";

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
    const layout = planClipLayout({ lockup: piece(1290, 388, 0, "lockup"), name: piece(1000, 220, 220, "name"), date: piece(800, 60, 60, "SUNDAY 27TH DECEMBER"), claim: roll }, "9:16", "B");
    assert.equal(Math.round(layout.boxes.lockup!.top), 353);
    assert.equal(layout.pieces.date.piece.label, "SUNDAY 27TH DECEMBER");
    assert.ok(tripleFitTypeChecks(layout).every((check) => check.ok));
    const painted = await buildTripleFitLayers({ ...layout, claim: [] }, null);
    const bands = await sharp(painted.bands).metadata();
    const top = await sharp(painted.top).metadata();
    assert.deepEqual([bands.width, bands.height], [1080, 1920]);
    assert.deepEqual([top.width, top.height], [1080, 1920]);
    assert.equal(painted.claim, null);
  });

  it("uses the kit lockup and the kit's date line, not a shortened date", () => {
    const picked = clipKitPieces([
      { role: "info", label: "CIRCUIT > SOUTHAMPTON", file: "venue.png", cap_px: 183 },
      { role: "info", label: "SUNDAY 27TH DECEMBER", file: "date.png", cap_px: 182 },
      { role: "info", label: "1PM > 9:30PM", file: "time.png", cap_px: 180 },
      { role: "logo", label: "PUZZLE 4th Birthday", file: "logo.png", cap_px: 558 },
      { role: "name", label: "LUKE DEAN", file: "name.png", cap_px: 469 },
    ]);
    assert.equal(picked.date.label, "SUNDAY 27TH DECEMBER");
    assert.equal(picked.lockup.file, "logo.png");
    assert.notEqual(picked.date.label, "SUN 27 DEC");
  });

  it("the pending stub is gone", () => {
    const needle = "triple-fit composition " + "pending";
    const hits = tree(process.cwd()).filter((path) => readFileSync(path).includes(needle));
    assert.deepEqual(hits, []);
  });
});
