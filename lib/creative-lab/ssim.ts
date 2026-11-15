/**
 * Mask comparison for the caption reference check. Pure JavaScript over
 * decoded pixels (pngjs); no native image library. The reference clip
 * already has its caption burned in and there is no uncaptioned plate, so
 * the check thresholds both images and scores the masks (SSIM + overlap)
 * instead of the frames.
 */

import { PNG } from "pngjs";

export type LumaImage = { width: number; height: number; luma: Uint8Array };

export type Box = { x: number; y: number; width: number; height: number };

export function readPng(bytes: Buffer): LumaImage {
  const png = PNG.sync.read(bytes);
  return lumaOf(png.data, png.width, png.height);
}

/** Rec. 601 luma, 0–255. */
export function lumaOf(rgba: Uint8Array, width: number, height: number): LumaImage {
  const luma = new Uint8Array(width * height);
  for (let i = 0; i < luma.length; i++) {
    const o = i * 4;
    luma[i] = Math.round(0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]);
  }
  return { width, height, luma };
}

/** The box, as 0 or 255. */
export function thresholdBox(image: LumaImage, box: Box, lumaMin: number): Uint8Array {
  const out = new Uint8Array(box.width * box.height);
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      const sx = box.x + x;
      const sy = box.y + y;
      const v = sx < 0 || sy < 0 || sx >= image.width || sy >= image.height ? 0 : image.luma[sy * image.width + sx];
      out[y * box.width + x] = v >= lumaMin ? 255 : 0;
    }
  }
  return out;
}

/**
 * Mean SSIM over non-overlapping 8×8 windows (Wang et al.). `a` and `b`
 * are the same length, values 0–255, row-major.
 */
export function ssim(a: Uint8Array, b: Uint8Array, width: number, height: number): number {
  if (a.length !== b.length || a.length !== width * height) throw new Error("ssim: the two masks differ in size");
  const window = 8;
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  let total = 0;
  let n = 0;
  for (let y = 0; y + window <= height; y += window) {
    for (let x = 0; x + window <= width; x += window) {
      let sumA = 0;
      let sumB = 0;
      const av: number[] = [];
      const bv: number[] = [];
      for (let j = 0; j < window; j++) {
        for (let i = 0; i < window; i++) {
          const ai = a[(y + j) * width + (x + i)];
          const bi = b[(y + j) * width + (x + i)];
          av.push(ai);
          bv.push(bi);
          sumA += ai;
          sumB += bi;
        }
      }
      const count = window * window;
      const muA = sumA / count;
      const muB = sumB / count;
      let varA = 0;
      let varB = 0;
      let cov = 0;
      for (let k = 0; k < count; k++) {
        const da = av[k] - muA;
        const db = bv[k] - muB;
        varA += da * da;
        varB += db * db;
        cov += da * db;
      }
      varA /= count;
      varB /= count;
      cov /= count;
      total += ((2 * muA * muB + c1) * (2 * cov + c2)) / ((muA * muA + muB * muB + c1) * (varA + varB + c2));
      n += 1;
    }
  }
  if (!n) throw new Error("ssim: the box is smaller than one window");
  return total / n;
}

/** Dice and IoU of the lit pixels (value >= cutoff). */
export function maskOverlap(a: Uint8Array, b: Uint8Array, cutoff = 128): { dice: number; iou: number } {
  if (a.length !== b.length) throw new Error("overlap: the two masks differ in size");
  let inter = 0;
  let onlyA = 0;
  let onlyB = 0;
  for (let i = 0; i < a.length; i++) {
    const onA = a[i] >= cutoff;
    const onB = b[i] >= cutoff;
    if (onA && onB) inter += 1;
    else if (onA) onlyA += 1;
    else if (onB) onlyB += 1;
  }
  const union = inter + onlyA + onlyB;
  return {
    dice: inter + onlyA + onlyB === 0 ? 1 : (2 * inter) / (2 * inter + onlyA + onlyB),
    iou: union === 0 ? 1 : inter / union,
  };
}
