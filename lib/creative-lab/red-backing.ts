/**
 * O58 (overlay templates issue 8): the roll-call's red line stays #FE3232.
 * After the band steps (clips only), a black backing goes under line 1 only,
 * at 40, then 60, then 80 %; white only past 80 %. The backing is line 1's
 * ink box padded (t1-video.ts backingRect, O66), full over its core and
 * fading to 0 outward, reaching 0 at the neighbouring type's ink and by
 * 0.07 / 0.93 W: no hard edge. O70 (issue 10, amends O66): the fade is a
 * smoothstep (3t² − 2t³), never shorter than 12 px; the bands keep J2's fade.
 * Over the bands, under the type. No shadow, stroke, glow or larger cap.
 * Shared by T1 on a clip, the artist card and T2.
 */

import type { BackingBox } from "./t1-video.ts";
import { blueNoise } from "./video-bands.ts";

// The bands' blue-noise map (video-bands.ts), so the backing's 8-bit alpha is dithered the same way.
const NOISE_SIDE = 32;
let noise: Float64Array | null = null;
const noiseAt = (x: number, y: number) => (noise ??= blueNoise(NOISE_SIDE))[(y % NOISE_SIDE) * NOISE_SIDE + (x % NOISE_SIDE)]!;

/** O70: the backing's 8-bit alpha at a pixel, from 16-bit and dithered as the bands are: floor(alpha16 / 257 + threshold). */
export function backingAlpha8(x: number, y: number, b: BackingBox, opacity: number): number {
  const a16 = Math.round(backingAlphaAt(x, y, b, opacity) * 65535);
  if (a16 === 0) return 0;
  return Math.min(255, Math.floor(a16 / 257 + noiseAt(x, y)));
}

/** O70: the feather's opacity at t (0 at the core's edge, 1 at the feather's end): 1 − smoothstep(t). */
export function featherAt(t: number): number {
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  return 1 - t * t * (3 - 2 * t);
}

/** The backing's alpha (0–1) at a pixel: full over the core, O70's smoothstep to 0 over each side's feather outside it. */
export function backingAlphaAt(x: number, y: number, b: BackingBox, opacity: number): number {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const { rect, feather } = b;
  const f = (d: number, span: number) => (d <= 0 ? 1 : span <= 0 || d >= span ? 0 : featherAt(d / span));
  const fx = cx < rect.left ? f(rect.left - cx, feather.left) : f(cx - (rect.left + rect.width), feather.right);
  const fy = cy < rect.top ? f(rect.top - cy, feather.top) : f(cy - (rect.top + rect.height), feather.bottom);
  return opacity * fx * fy;
}

const extent = (b: BackingBox, width: number, height: number) => ({
  x0: Math.max(0, Math.floor(b.rect.left - b.feather.left)),
  x1: Math.min(width, Math.ceil(b.rect.left + b.rect.width + b.feather.right)),
  y0: Math.max(0, Math.floor(b.rect.top - b.feather.top)),
  y1: Math.min(height, Math.ceil(b.rect.top + b.rect.height + b.feather.bottom)),
});

/** The backing as an RGBA layer (black, straight alpha, blue-noise dithered from 16-bit, O70) at the frame's size. */
export function backingLayer(width: number, height: number, b: BackingBox, opacity: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const { x0, x1, y0, y1 } = extent(b, width, height);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) out[(y * width + x) * 4 + 3] = backingAlpha8(x, y, b, opacity);
  }
  return out;
}

/** The ground with the backing applied (black over), for the ink-box test. */
export function applyBacking(data: Uint8Array | Buffer, width: number, height: number, channels: number, b: BackingBox, opacity: number): Buffer {
  const out = Buffer.from(data);
  const { x0, x1, y0, y1 } = extent(b, width, height);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const a = backingAlphaAt(x, y, b, opacity);
      if (a <= 0) continue;
      const i = (y * width + x) * channels;
      for (let c = 0; c < 3; c += 1) out[i + c] = Math.round(out[i + c]! * (1 - a));
    }
  }
  return out;
}

/** O70: the largest row-to-row step may be at most this many times the feather's mean step (a smoothstep peaks at 1.5×). */
export const FEATHER_STEP_RATIO = 1.6;

export type FeatherCheck = { side: "top" | "bottom"; rows: number; meanStep: number; maxStep: number; ratio: number; ok: boolean };

/**
 * O70's check: the backing layer rendered alone (its dithered 8-bit alpha,
 * as drawn) over flat mid-grey, each row's mean level across the core's
 * width, over the feather's rows only: from the last row of the core to the
 * first row the feather has reached 0. The padding between the type's ink
 * and the core is flat and isn't read (#1174 fix round 1). The largest
 * row-to-row step there must be at most 1.6 × the feather's mean step: the
 * level measured across those rows, over the feather's length in rows. The grey
 * isn't rounded a second time: that rounding is the display's, the same for
 * any layer, and at a 2–3 level mean step it alone would add a 1-level step.
 * The type's edge and shadow are never in it: the layer has no type. A hard
 * cut (no feather) fails at any opacity.
 */
export function checkFeather(b: BackingBox, opacity: number, side: "top" | "bottom", frame: { width: number; height: number }, grey = 128): FeatherCheck {
  const x0 = Math.max(0, Math.ceil(b.rect.left));
  const x1 = Math.min(frame.width, Math.floor(b.rect.left + b.rect.width));
  const level = (y: number) => {
    let sum = 0;
    for (let x = x0; x < x1; x += 1) sum += grey * (1 - backingAlpha8(x, y, b, opacity) / 255);
    return sum / Math.max(1, x1 - x0);
  };
  const span = b.feather[side];
  if (span < 1) {
    const total = grey * opacity;
    return { side, rows: 0, meanStep: 0, maxStep: total, ratio: Infinity, ok: total === 0 };
  }
  // Rows by their centres: the last core row, then each feather row, to the first row at 0.
  const edge = side === "bottom" ? b.rect.top + b.rect.height : b.rect.top;
  const dir = side === "bottom" ? 1 : -1;
  const first = side === "bottom" ? Math.floor(edge - 0.5) : Math.ceil(edge - 0.5);
  const last = side === "bottom" ? Math.ceil(edge + span - 0.5) : Math.floor(edge - span - 0.5);
  const steps: number[] = [];
  for (let y = first; y !== last && y + dir >= 0 && y + dir < frame.height; y += dir) steps.push(Math.abs(level(y + dir) - level(y)));
  // The mean step is the drop measured across those rows over the feather's length in rows: its own average slope.
  // (Dividing by the count of row steps would add one step a feather never has, and fail every short smoothstep.)
  const meanStep = steps.length ? Math.abs(level(first) - level(last)) / span : 0;
  const maxStep = steps.length ? Math.max(...steps) : 0;
  const ratio = meanStep > 0 ? maxStep / meanStep : 0;
  return { side, rows: steps.length, meanStep, maxStep, ratio, ok: ratio <= FEATHER_STEP_RATIO + 1e-9 };
}
