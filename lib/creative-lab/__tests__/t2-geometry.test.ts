import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DEFAULT_GRADIENT_SHADOW } from "../overlay-gradient.ts";
import { PUZZLE_FLOATING_T2 } from "../overlay-kits.ts";
import { composeT2Ground, type T2Ground } from "../t2-render.ts";

/**
 * T2's geometry without any type, in place of a CI frame until Bootzy's
 * licence is confirmed (overlay templates issue 6 Q9). No font is read.
 *
 * The panel is a 1-bit silhouette of Puzzle's STORY PSD panel layer at its
 * placed size (991 × 1246, alpha > 8 → on): its outline and tape strips only,
 * none of the panel's print or the paint. The ground is a flat fill.
 */
const sharpLib = async () => ((await import("sharp")) as unknown as { default: typeof import("sharp") }).default;

async function puzzleGround(): Promise<T2Ground> {
  const sharp = await sharpLib();
  const sil = await sharp(readFileSync(new URL("./fixtures/puzzle-t2-panel-alpha.png", import.meta.url))).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = sil.info;
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = 50;
    rgba[i * 4 + 1] = 50;
    rgba[i * 4 + 2] = 47;
    rgba[i * 4 + 3] = sil.data[i * channels]! > 127 ? 255 : 0;
  }
  const panelPng = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const ground = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#7d6f62" } }).png().toBuffer();
  // The STORY PSD's panel layer bounds (110, 1046, 3097 × 3893) at the kit's ×0.32.
  const scale = 1080 / 3375;
  const panel = { png: panelPng, left: 110 * scale, top: 1046 * scale, width: 3097 * scale, height: 3893 * scale };
  const g = await composeT2Ground({ ground, panel, bands: DEFAULT_GRADIENT_SHADOW, kit: PUZZLE_FLOATING_T2 });
  assert.ok(!("held" in g), "held" in g ? g.held : "");
  return g as T2Ground;
}

describe("T2 geometry without type: Puzzle's slot, paper and bands (O25, O32, H30)", () => {
  it("the slot is x 126–938 × y 411–1510, 812 px wide, and 650 px in the 1:1", async () => {
    const { slot } = await puzzleGround();
    assert.equal(Math.round(slot.left), 126);
    assert.equal(Math.ceil(slot.right) - 1, 938);
    assert.equal(Math.round(slot.top), 411);
    assert.equal(Math.ceil(slot.bottom) - 1, 1510);
    assert.equal(Math.round(slot.right - slot.left), 812);
    assert.equal(Math.round((slot.right - slot.left) * 0.8), 650);
    assert.ok(slot.fromPanel);
  });

  it("the paper measures x 94–970 × y 373–1548 and matches the kit's stored box; the ink box, tape included, is wider", async () => {
    const { panelInk, paperMatches } = await puzzleGround();
    const p = panelInk!.box;
    assert.deepEqual([p.left, p.left + p.width - 1, p.top, p.top + p.height - 1], [94, 970, 373, 1548]);
    assert.deepEqual(PUZZLE_FLOATING_T2.paper, { left: 94, top: 373, right: 970, bottom: 1548 });
    assert.equal(paperMatches, true);
    const b = panelInk!.bbox;
    assert.ok(b.left < p.left && b.left + b.width > p.left + p.width, "the tape strips sit outside the paper");
  });

  it("every O25 band stop is within ±1 % on the 3 × 3 average, in 9:16, 4:5 and 1:1", async () => {
    const { bandStops, master, crop45, square } = await puzzleGround();
    const sharp = await sharpLib();
    assert.deepEqual([(await sharp(master).metadata()).height, (await sharp(crop45).metadata()).height, (await sharp(square).metadata()).height], [1920, 1350, 1080]);
    for (const [fmt, stops] of Object.entries(bandStops!)) {
      assert.equal(stops.length, 12, fmt);
      for (const s of stops) assert.ok(s.ok, `${fmt} ${s.at} H read ${s.got} % (O25 ${s.want}${s.pairedWith ? `, paired with ${s.pairedWith.join("/")}` : ""})`);
    }
  });
});
