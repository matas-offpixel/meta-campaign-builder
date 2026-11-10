/**
 * O58 (overlay templates issue 8): the roll-call's red line stays #FE3232.
 * After the band steps (clips only), a black backing goes under line 1 only,
 * at 40, then 60, then 80 %; white only past 80 %. The backing is line 1's
 * ink box padded (t1-video.ts backingRect), full inside and fading to 0 over
 * 1 cap outside with J2's fade, cut hard at its bounds (never under other
 * type, inside 0.07–0.93 W), over the bands and under the type. No shadow, stroke, glow
 * or larger cap. Shared by T1 on a clip and the artist card.
 */

import { J2_FALL, knotAt } from "./overlay-gradient.ts";
import type { BackingBox } from "./t1-video.ts";

/** The backing's alpha (0–1) at a pixel: full inside the padded box, J2's fade over `feather` outside it, 0 past its bounds. */
export function backingAlphaAt(x: number, y: number, b: BackingBox, opacity: number): number {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const { rect, bounds, feather } = b;
  if (cx < bounds.left || cx > bounds.left + bounds.width || cy < bounds.top || cy > bounds.top + bounds.height) return 0;
  const ox = Math.max(0, rect.left - cx, cx - (rect.left + rect.width));
  const oy = Math.max(0, rect.top - cy, cy - (rect.top + rect.height));
  const f = (d: number) => (d <= 0 ? 1 : feather <= 0 || d >= feather ? 0 : knotAt(J2_FALL, d / feather));
  return opacity * f(ox) * f(oy);
}

const extent = (b: BackingBox, width: number, height: number) => ({
  x0: Math.max(0, Math.floor(Math.max(b.bounds.left, b.rect.left - b.feather))),
  x1: Math.min(width, Math.ceil(Math.min(b.bounds.left + b.bounds.width, b.rect.left + b.rect.width + b.feather))),
  y0: Math.max(0, Math.floor(Math.max(b.bounds.top, b.rect.top - b.feather))),
  y1: Math.min(height, Math.ceil(Math.min(b.bounds.top + b.bounds.height, b.rect.top + b.rect.height + b.feather))),
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
