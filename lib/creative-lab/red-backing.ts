/**
 * O58 (overlay templates issue 8): the roll-call's red line stays #FE3232.
 * After the band steps (clips only), a black backing goes under line 1 only,
 * at 40, then 60, then 80 %; white only past 80 %. The backing is line 1's
 * ink box padded (t1-video.ts backingRect, O66), full over its core and
 * fading to 0 outward with J2's fade, reaching 0 at the neighbouring type's
 * ink and by 0.07 / 0.93 W: no hard edge. Over the bands, under the type. No shadow, stroke, glow
 * or larger cap. Shared by T1 on a clip and the artist card.
 */

import { J2_FALL, knotAt } from "./overlay-gradient.ts";
import type { BackingBox } from "./t1-video.ts";

/** The backing's alpha (0–1) at a pixel: full over the core, J2's fade to 0 over each side's feather outside it (O66). */
export function backingAlphaAt(x: number, y: number, b: BackingBox, opacity: number): number {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const { rect, feather } = b;
  const f = (d: number, span: number) => (d <= 0 ? 1 : span <= 0 || d >= span ? 0 : knotAt(J2_FALL, d / span));
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

/** The backing as an RGBA layer (black, straight alpha) at the frame's size. */
export function backingLayer(width: number, height: number, b: BackingBox, opacity: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const { x0, x1, y0, y1 } = extent(b, width, height);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) out[(y * width + x) * 4 + 3] = Math.round(backingAlphaAt(x, y, b, opacity) * 255);
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
