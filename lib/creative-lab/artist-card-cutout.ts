/**
 * Artist card variant B (O21, re-ruled in fix round 5): the artist cut out
 * onto a plain ground. Order per photo: A (artist-card.ts, extension
 * included), then B, then skip. Never a scrim, never the artwork's paint.
 *
 * Ground (chosen per card, printed): flat charcoal #32322f, or a soft radial
 * lift centred on the face's x at 0.60 H with radius 0.70 W (756 px), from
 * charcoal +8 L* at the centre to #1e1e1c at the edge and beyond (smoothstep
 * falloff, interpolated in CIELAB). Either way the ground darkens linearly
 * below 0.85 H to 25 % black at the frame's bottom.
 *
 * Figure:
 *   - matte: the person mask (segment.ts) refined again at source resolution
 *     (guided filter, radius 8), then at output size feathered 2.5 px on hair
 *     (the soft-alpha region above the chin) and 1.25 px on body edges;
 *   - decontamination: for alpha 0.05–0.98 the foreground colour is solved
 *     against the local source background (median of alpha < 0.05 pixels
 *     within 24 px): F = (I − (1 − α)·B) / α. Pixels the feather reaches
 *     beyond the matte take the nearest solid pixel's colour;
 *   - spill test: in the 6 px band inside the edge (alpha ≥ 0.5), at most 2 %
 *     of pixels within ΔE 12 of their local background, else blocked;
 *   - unify (bounded): contrast ±10 %, saturation −15 %…0, a white-balance
 *     shift towards the ground's neutral of ΔE ≤ 4 on the mid-greys; the face
 *     box's median colour may move ΔE ≤ 3 (else all three scale back); no
 *     relighting;
 *   - shadow: an ambient shadow from the figure's alpha, blurred 0.04 W,
 *     11 px down, black at 30 %, multiplied onto the ground only (O6 stays on
 *     the type);
 *   - light wrap: the ground screened into the figure's edge at 25 %, falling
 *     to 0 at 6 px (8 px on hair);
 *   - one monochrome grain layer over ground and figure, under the type, at the
 *     photo's own measured luma noise clamped to 2–5 levels, 1 px.
 *
 * Placement: the face bands, the 216 px face box, ≤ 1.0× source, alpha ≥ 0.9
 * over 99 % of the face box and ≥ 0.5 over its inner 80 %. The figure ends
 * either on the frame's bottom (bottom-anchored) or fades over 0.12 H
 * (smoothstep) ending inside the darkened ground (≥ 0.85 H). A side cut by
 * the photo's own edge sits flush on the frame's matching side (face centre
 * 0.38–0.62 W); in the 1:1 the figure layer moves out by the re-sit offset so
 * the cut stays flush on the square's side, and the face centre must still sit
 * in 0.38–0.62 of the square. The head is never cut; the photo's top edge
 * never cuts the person.
 */

import {
  KIT_SHADOW,
  MASTER,
  O20,
  PHOTO_RULES,
  RECT_45,
  SLOTS,
  checkLayout,
  gaussianNoise,
  layoutText,
  lowContrastShare,
  textBoxRect,
  textOverlay,
  type FaceLines,
  type LayoutCheck,
  type Piece,
  type Size,
  type TextLayout,
} from "./artist-card.ts";
import { deltaE, hex, labToRgb, parseHex, percentile, rgbToLab, smoothstep } from "./colour.ts";
import type { PersonMask } from "./segment.ts";

export { deltaE, rgbToLab } from "./colour.ts";

export const CUTOUT = {
  faceCentre: { min: 0.45, max: 0.55 },
  /** With a flush side cut (frame and square). */
  faceCentreCut: { min: 0.38, max: 0.62 },
  faceAlpha: { solid: 0.9, share: 0.99, innerMin: 0.5, inner: 0.8 },
  /** 10–90 % edge widths at output size; σ of a blurred step = width / 2.563. */
  feather: { hairPx: 2.5, bodyPx: 1.25, hair: { min: 2, max: 3 }, body: { min: 1, max: 1.5 } },
  matte: { radius: 8, eps: 1e-3, marginPx: 24 },
  /** The soft-alpha region: a 7×7 window at output size at least this share fractional (0.05–0.95), above the chin. */
  hair: { window: 3, minSoftShare: 0.35 },
  decontam: { lo: 0.05, hi: 0.98, radiusPx: 24, fallbackPx: 48, minBackground: 20, grid: 8 },
  spill: { bandPx: 6, deltaE: 12, maxShare: 0.02 },
  wrap: { opacity: 0.25, bodyPx: 6, hairPx: 8 },
  /** Ambient shadow: blur 0.04 W (sigma = half, as O6's blur is read), 0.01 W down, black 30 %. */
  shadow: { blur: 0.04, dy: 0.01, opacity: 0.3 },
  unify: {
    contrast: { min: 0.9, max: 1.1 },
    saturation: { min: 0.85, max: 1 },
    wbMaxDeltaE: 4,
    faceMaxDeltaE: 3,
    /** Mid-greys: solid figure pixels with L* 30–70 and C* ≤ 15. */
    midGrey: { lMin: 30, lMax: 70, cMax: 15, minPixels: 500 },
    /** Saturation steps from 0 at median C* 10 to −15 % at median C* 30. */
    chroma: { from: 10, to: 30 },
  },
  grain: { min: 2, max: 5 },
  fadeBand: 0.12,
  darken: { from: 0.85, black: 0.25 },
  /** The figure ends at or below this (fraction of H): the fade lands in the darkened ground. */
  figureEndMin: 0.85,
  ground: { charcoal: "#32322f", liftL: 8, edge: "#1e1e1c", centreY: 0.6, radius: 0.7 },
  halo: { bandPx: 4, deltaE: 10, maxShare: 0.02, ringFrom: 8, ringTo: 30 },
  /** Mask pixels on a photo edge before it counts as cutting the person. */
  touchMinPixels: 3,
  /** O1's 1:1 re-sits the 4:5 at 0.8×: 108 px each side, 135 px of the frame. */
  squareOffset: 108,
  wide: 135,
  forbiddenGrounds: ["#fe3232", "#ff6876"] as const,
} as const;

export const DISCLOSURE_B = "artist cut out onto a plain ground";

// ─── Ground ─────────────────────────────────────────────────────────────────

/**
 * The taped panel's own charcoal: the per-channel median of its centre over
 * pixels at least 80 % opaque (the panel is about 91 % opaque).
 */
export function panelCharcoal(rgba: ArrayLike<number>, width: number, height: number): string {
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  for (let y = Math.floor(height / 4); y < Math.floor((3 * height) / 4); y += 2) {
    for (let x = Math.floor(width / 4); x < Math.floor((3 * width) / 4); x += 2) {
      const i = (y * width + x) * 4;
      if (rgba[i + 3]! < 204) continue;
      r.push(rgba[i]!);
      g.push(rgba[i + 1]!);
      b.push(rgba[i + 2]!);
    }
  }
  const med = (v: number[]) => (v.length ? [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)]! : 0);
  return hex([med(r), med(g), med(b)]);
}

/** The panel as it is seen in the flattened PSD: the median of the preview's centre over dark neutral pixels (L* < 40, C* < 8), so the type and the paint showing through are left out. */
export function panelSeen(rgb: ArrayLike<number>, width: number, height: number, channels = 3): string {
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  for (let y = Math.floor(height / 4); y < Math.floor((3 * height) / 4); y += 2) {
    for (let x = Math.floor(width / 4); x < Math.floor((3 * width) / 4); x += 2) {
      const i = (y * width + x) * channels;
      const lab = rgbToLab(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!);
      if (lab[0] >= 40 || Math.hypot(lab[1], lab[2]) >= 8) continue;
      r.push(rgb[i]!);
      g.push(rgb[i + 1]!);
      b.push(rgb[i + 2]!);
    }
  }
  const med = (v: number[]) => (v.length ? [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)]! : 0);
  return hex([med(r), med(g), med(b)]);
}

/** The lift's centre: the charcoal raised 8 L*, its a* and b* kept. */
export function liftCentre(charcoal: string = CUTOUT.ground.charcoal): string {
  const [L, a, b] = rgbToLab(...parseHex(charcoal));
  return hex(labToRgb(L + CUTOUT.ground.liftL, a, b));
}

/** The darkening multiplier at frame row y: 1 above 0.85 H, linearly to 0.75 at the bottom. */
export function bottomDarken(y: number, frameHeight: number = MASTER.height): number {
  const from = CUTOUT.darken.from * frameHeight;
  if (y <= from) return 1;
  return 1 - CUTOUT.darken.black * Math.min(1, (y - from) / (frameHeight - from));
}

export type GroundSpec =
  | { kind: "flat"; colour: string }
  | { kind: "lift"; centre: string; edge: string; cx: number; cy: number; radius: number };

export function groundSpec(kind: "flat" | "lift", faceX: number, frame: Size = MASTER): GroundSpec {
  if (kind === "flat") return { kind, colour: CUTOUT.ground.charcoal };
  return { kind, centre: liftCentre(), edge: CUTOUT.ground.edge, cx: faceX, cy: CUTOUT.ground.centreY * frame.height, radius: CUTOUT.ground.radius * frame.width };
}

export function describeGround(g: GroundSpec): string {
  return g.kind === "flat"
    ? `flat ${g.colour}`
    : `lift centre ${g.centre} at x ${Math.round(g.cx)}, y ${Math.round(g.cy)} (0.60 H), radius ${Math.round(g.radius)} px → ${g.edge}`;
}

/** The ground's colour before darkening (floats 0–255) at distance d from the lift's centre. */
export function liftColourAt(g: Extract<GroundSpec, { kind: "lift" }>, d: number): [number, number, number] {
  const c = rgbToLab(...parseHex(g.centre));
  const e = rgbToLab(...parseHex(g.edge));
  const t = smoothstep(d / g.radius);
  return labToRgb(c[0] + (e[0] - c[0]) * t, c[1] + (e[1] - c[1]) * t, c[2] + (e[2] - c[2]) * t);
}

/** The ground on a canvas, RGB floats 0–255, darkening included. */
export function renderGround(g: GroundSpec, width: number, height: number, frameHeight: number = height): Float32Array {
  const out = new Float32Array(width * height * 3);
  let lut: Float32Array | null = null;
  if (g.kind === "lift") {
    const n = Math.ceil(g.radius * 4) + 2;
    lut = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) lut.set(liftColourAt(g, i / 4), i * 3);
  }
  const flat = g.kind === "flat" ? parseHex(g.colour) : null;
  for (let y = 0; y < height; y += 1) {
    const k = bottomDarken(y, frameHeight);
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 3;
      if (flat) {
        out[o] = flat[0] * k;
        out[o + 1] = flat[1] * k;
        out[o + 2] = flat[2] * k;
        continue;
      }
      const s = g as Extract<GroundSpec, { kind: "lift" }>;
      const d = Math.hypot(x - s.cx, y - s.cy);
      const i = Math.min(lut!.length / 3 - 1, Math.round(d * 4)) * 3;
      out[o] = lut![i]! * k;
      out[o + 1] = lut![i + 1]! * k;
      out[o + 2] = lut![i + 2]! * k;
    }
  }
  return out;
}

// ─── Figure placement ───────────────────────────────────────────────────────

export type MaskEdges = {
  /** The person reaches the photo's bottom edge. */
  bottom: boolean;
  left: boolean;
  right: boolean;
  top: boolean;
  /** The person touches a side edge within the head's rows. */
  headCutLeft: boolean;
  headCutRight: boolean;
  /** The lowest source row holding the person (alpha > 0.5). */
  lowestRow: number;
  /** The share of the bottom row that is person. */
  bottomShare: number;
};

export function maskEdges(mask: PersonMask, head: { top: number; bottom: number }): MaskEdges {
  const { width: w, height: h, alpha } = mask;
  const on = (x: number, y: number) => alpha[y * w + x]! > 0.5;
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  let headLeft = 0;
  let headRight = 0;
  const h0 = Math.max(0, Math.floor(head.top));
  const h1 = Math.min(h - 1, Math.ceil(head.bottom));
  for (let y = 0; y < h; y += 1) {
    if (on(0, y)) {
      left += 1;
      if (y >= h0 && y <= h1) headLeft += 1;
    }
    if (on(w - 1, y)) {
      right += 1;
      if (y >= h0 && y <= h1) headRight += 1;
    }
  }
  for (let x = 0; x < w; x += 1) {
    if (on(x, 0)) top += 1;
    if (on(x, h - 1)) bottom += 1;
  }
  let lowestRow = -1;
  for (let y = h - 1; y >= 0 && lowestRow < 0; y -= 1) {
    for (let x = 0; x < w; x += 1) {
      if (on(x, y)) {
        lowestRow = y;
        break;
      }
    }
  }
  const t = CUTOUT.touchMinPixels;
  return { bottom: bottom >= t, left: left >= t, right: right >= t, top: top >= t, headCutLeft: headLeft > 0, headCutRight: headRight > 0, lowestRow, bottomShare: bottom / w };
}

export type SideCut = "left" | "right" | null;

/** Where the figure layer sits on the 1:1's wide canvas (frame x + this): 135 px centred; flush on the square's side with a side cut. */
export function squareFigureOffset(sideCut: SideCut): number {
  return sideCut === "left" ? 0 : sideCut === "right" ? 2 * CUTOUT.wide : CUTOUT.wide;
}

/** The face centre as a fraction of the 1:1's width, with the figure layer moved out for a side cut (type stays at 0.8×). */
export function squareFaceCentre(frameCentre: number, sideCut: SideCut, frameWidth: number = MASTER.width): number {
  const k = CUTOUT.squareOffset / CUTOUT.wide;
  return ((frameCentre * frameWidth + squareFigureOffset(sideCut)) * k) / frameWidth;
}

export type FigurePlan = {
  scale: number;
  eyes: number;
  headTop: number;
  chin: number;
  faceWidthPx: number;
  faceCentreX: number;
  /** The face centre on the 1:1 (fraction of its width). */
  squareCentreX: number;
  /** The scaled photo's rectangle on the frame (may run past it). */
  rect: { left: number; top: number; width: number; height: number };
  /** Where the figure ends on the frame, px (the photo's bottom when it cuts the person, else the person's lowest row). */
  figureEnd: number;
  /** The lowest 0.12 H fades: the figure ends above the frame's bottom. */
  fade: boolean;
  sideCut: SideCut;
};

type FaceForCutout = FaceLines & { box: { x: number; width: number } };

/**
 * The largest figure the rules allow. Scale from the face bands, the 216 px
 * face box and 1.0× source; eyes centred in what the bands leave free; x from
 * the face centre, or flush on the cut side; the figure must reach 0.85 H.
 */
export function planFigure(photo: Size, face: FaceForCutout, edges: MaskEdges, frame: Size = MASTER): FigurePlan | { blocker: string } {
  const H = frame.height;
  const W = frame.width;
  const f = SLOTS.face;
  if (edges.top) return { blocker: "the photo's top edge cuts the person (never allowed)" };
  if (edges.headCutLeft || edges.headCutRight) return { blocker: `the photo's ${edges.headCutLeft ? "left" : "right"} edge cuts the head` };
  if (edges.left && edges.right) return { blocker: "the person runs off both photo sides; both cuts can't sit flush on the 1:1" };
  const a = Math.max(1, face.eyeY - face.headTopY);
  const b = Math.max(1, face.chinY - face.eyeY);
  const sHi = Math.min(PHOTO_RULES.maxScale, ((f.chinMax - f.headTopMin) * H) / (a + b), ((f.eyesMax - f.headTopMin) * H) / a, ((f.chinMax - f.eyesMin) * H) / b);
  const sLo = (O20.minFaceWidth * W) / face.box.width;
  if (sLo > sHi) return { blocker: `face box ${Math.round(face.box.width * sHi)} px at the largest size the face bands allow (min ${O20.minFaceWidth * W})` };
  const faceCx = face.box.x + face.box.width / 2;
  const sideCut: SideCut = edges.left ? "left" : edges.right ? "right" : null;
  const range = sideCut ? CUTOUT.faceCentreCut : CUTOUT.faceCentre;
  const end = edges.bottom ? photo.height : edges.lowestRow + 1;
  let reason = "";
  const steps = 80;
  for (let i = 0; i <= steps; i += 1) {
    const s = sHi - ((sHi - sLo) * i) / steps;
    const lo = Math.max(f.eyesMin, f.headTopMin + (a * s) / H);
    const hi = Math.min(f.eyesMax, f.chinMax - (b * s) / H);
    if (lo > hi + 1e-9) continue;
    const e = Math.min(hi, Math.max(lo, 0.61));
    const width = photo.width * s;
    const left = sideCut === "left" ? 0 : sideCut === "right" ? W - width : W / 2 - faceCx * s;
    const centre = (left + faceCx * s) / W;
    if (centre < range.min - 1e-9 || centre > range.max + 1e-9) {
      reason ||= `face centre ${centre.toFixed(3)} W outside ${range.min}–${range.max} with the ${sideCut} cut flush`;
      continue;
    }
    const square = squareFaceCentre(centre, sideCut, W);
    if (sideCut && (square < CUTOUT.faceCentreCut.min - 1e-9 || square > CUTOUT.faceCentreCut.max + 1e-9)) {
      reason ||= `face centre ${square.toFixed(3)} of the 1:1 outside 0.38–0.62 with the ${sideCut} cut flush on the square`;
      continue;
    }
    const top = e * H - face.eyeY * s;
    const figureEnd = top + end * s;
    if (figureEnd < CUTOUT.figureEndMin * H - 0.5) {
      reason ||= `the figure ends at ${(figureEnd / H).toFixed(3)} H (min ${CUTOUT.figureEndMin}: the fade must land in the darkened ground)`;
      continue;
    }
    return {
      scale: s,
      eyes: e,
      headTop: e - (a * s) / H,
      chin: e + (b * s) / H,
      faceWidthPx: face.box.width * s,
      faceCentreX: centre,
      squareCentreX: square,
      rect: { left, top, width, height: photo.height * s },
      figureEnd,
      fade: figureEnd < H - 0.5,
      sideCut,
    };
  }
  return { blocker: reason || "no eye position in 0.58–0.64 H works" };
}

/** The fade's alpha multiplier at frame row y: smoothstep over the 0.12 H above the figure's end, 0 at the end. */
export function fadeAt(y: number, figureEnd: number, frameHeight: number = MASTER.height): number {
  const band = CUTOUT.fadeBand * frameHeight;
  return smoothstep((figureEnd - y) / band);
}

// ─── Distances and blurs ────────────────────────────────────────────────────

/**
 * For every pixel, the distance (px, ≈ Euclidean) to the nearest pixel where
 * `inside` is set, and that pixel's index (−1 when there is none): an
 * 8-neighbour two-pass propagation of nearest sites.
 */
export function nearestInside(inside: Uint8Array, w: number, h: number): { dist: Float32Array; idx: Int32Array } {
  const idx = new Int32Array(w * h).fill(-1);
  const dist = new Float32Array(w * h).fill(1e9);
  for (let i = 0; i < w * h; i += 1) {
    if (inside[i]) {
      idx[i] = i;
      dist[i] = 0;
    }
  }
  const tryFrom = (i: number, j: number, x: number, y: number) => {
    const s = idx[j]!;
    if (s < 0) return;
    const sx = s % w;
    const sy = (s - sx) / w;
    const d = Math.hypot(x - sx, y - sy);
    if (d < dist[i]!) {
      dist[i] = d;
      idx[i] = s;
    }
  };
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (x > 0) tryFrom(i, i - 1, x, y);
      if (y > 0) {
        tryFrom(i, i - w, x, y);
        if (x > 0) tryFrom(i, i - w - 1, x, y);
        if (x < w - 1) tryFrom(i, i - w + 1, x, y);
      }
    }
  }
  for (let y = h - 1; y >= 0; y -= 1) {
    for (let x = w - 1; x >= 0; x -= 1) {
      const i = y * w + x;
      if (x < w - 1) tryFrom(i, i + 1, x, y);
      if (y < h - 1) {
        tryFrom(i, i + w, x, y);
        if (x < w - 1) tryFrom(i, i + w + 1, x, y);
        if (x > 0) tryFrom(i, i + w - 1, x, y);
      }
    }
  }
  return { dist, idx };
}

/** Distance from every pixel to the nearest pixel where `inside` is set (0 inside). */
export function distanceOutside(inside: Uint8Array, w: number, h: number): Float32Array {
  return nearestInside(inside, w, h).dist;
}

/** Separable Gaussian blur of a one-channel float image, edges clamped. */
export function gaussBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0) return Float32Array.from(src);
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i += 1) {
    k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
    sum += k[i + r]!;
  }
  for (let i = 0; i < k.length; i += 1) k[i]! /= sum;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let i = -r; i <= r; i += 1) acc += src[row + Math.min(w - 1, Math.max(0, x + i))]! * k[i + r]!;
      tmp[row + x] = acc;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let i = -r; i <= r; i += 1) acc += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x]! * k[i + r]!;
      out[y * w + x] = acc;
    }
  }
  return out;
}

// ─── Matte ──────────────────────────────────────────────────────────────────

/** The hair weight (0–1): where the soft-alpha band is wide (≥ 35 % of a 7×7 window fractional) above the chin row, softened. */
export function hairWeight(a: Float32Array, w: number, h: number, chinRow: number): Float32Array {
  const soft = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) soft[i] = a[i]! > 0.05 && a[i]! < 0.95 ? 1 : 0;
  const r = CUTOUT.hair.window;
  // Box share via an integral image.
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y += 1) {
    let row = 0;
    for (let x = 0; x < w; x += 1) {
      row += soft[y * w + x]!;
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1]! + row;
    }
  }
  const hair = new Float32Array(w * h);
  const yMax = Math.min(h, Math.max(0, Math.round(chinRow)));
  for (let y = 0; y < yMax; y += 1) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x += 1) {
      if (a[y * w + x]! <= 0.02) continue;
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      const s = integral[(y1 + 1) * (w + 1) + x1 + 1]! - integral[y0 * (w + 1) + x1 + 1]! - integral[(y1 + 1) * (w + 1) + x0]! + integral[y0 * (w + 1) + x0]!;
      if (s / ((y1 - y0 + 1) * (x1 - x0 + 1)) >= CUTOUT.hair.minSoftShare) hair[y * w + x] = 1;
    }
  }
  const out = gaussBlur(hair, w, h, 2);
  for (let i = 0; i < w * h; i += 1) out[i] = Math.min(1, out[i]! * 2);
  return out;
}

/** The output matte: body edges a 1.25 px feather of the binary mask, hair a 2.5 px feather of the soft alpha, mixed by the hair weight. */
export function composeMatte(a: Float32Array, w: number, h: number, hair: Float32Array): Float32Array {
  const binary = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) binary[i] = a[i]! > 0.5 ? 1 : 0;
  const body = gaussBlur(binary, w, h, CUTOUT.feather.bodyPx / 2.563);
  const soft = gaussBlur(a, w, h, CUTOUT.feather.hairPx / 2.563);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) out[i] = Math.min(1, Math.max(0, body[i]! * (1 - hair[i]!) + soft[i]! * hair[i]!));
  return out;
}

// ─── Decontamination and spill ──────────────────────────────────────────────

/**
 * The local source background on a grid (one cell per 8 px): the per-channel
 * median of the photo's pixels with alpha < 0.05 within 24 px of the cell's
 * centre (48 px when fewer than 20 are found), only for cells where `need` is
 * set. NaN where none is found.
 */
export function localBackground(rgb: ArrayLike<number>, a: Float32Array, inPhoto: Uint8Array, w: number, h: number, need: Uint8Array): { at(x: number, y: number): [number, number, number] | null } {
  const { grid: step, radiusPx, fallbackPx, minBackground, lo } = CUTOUT.decontam;
  const gw = Math.ceil(w / step);
  const gh = Math.ceil(h / step);
  const cells = new Float32Array(gw * gh * 3).fill(NaN);
  const needed = new Uint8Array(gw * gh);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (need[y * w + x]) needed[Math.floor(y / step) * gw + Math.floor(x / step)] = 1;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const median = (hst: Uint32Array, n: number) => {
    let c = 0;
    for (let v = 0; v < 256; v += 1) {
      c += hst[v]!;
      if (c * 2 >= n) return v;
    }
    return 255;
  };
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      if (!needed[gy * gw + gx]) continue;
      const cx = gx * step + step / 2;
      const cy = gy * step + step / 2;
      for (const r of [radiusPx, fallbackPx]) {
        for (const hst of hist) hst.fill(0);
        let n = 0;
        for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y += 1) {
          for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x += 1) {
            const i = y * w + x;
            if (!inPhoto[i] || a[i]! >= lo) continue;
            hist[0]![rgb[i * 3]!]! += 1;
            hist[1]![rgb[i * 3 + 1]!]! += 1;
            hist[2]![rgb[i * 3 + 2]!]! += 1;
            n += 1;
          }
        }
        if (n >= minBackground) {
          const o = (gy * gw + gx) * 3;
          cells[o] = median(hist[0]!, n);
          cells[o + 1] = median(hist[1]!, n);
          cells[o + 2] = median(hist[2]!, n);
          break;
        }
      }
    }
  }
  return {
    at(x: number, y: number) {
      const o = (Math.floor(y / step) * gw + Math.floor(x / step)) * 3;
      const r = cells[o]!;
      return Number.isNaN(r) ? null : [r, cells[o + 1]!, cells[o + 2]!];
    },
  };
}

/** Solve I = αF + (1 − α)B for F, clamped to 0–255. */
export function solveForeground(I: readonly number[], alpha: number, B: readonly number[]): [number, number, number] {
  const f = (k: number) => Math.min(255, Math.max(0, (I[k]! - (1 - alpha) * B[k]!) / Math.max(alpha, 1e-3)));
  return [f(0), f(1), f(2)];
}

/** The share of band pixels whose colour is within ΔE 12 of their local background (pixels with no background found are left out). */
export function spillShare(colours: readonly (readonly number[])[], backgrounds: readonly (readonly number[] | null)[]): { share: number; counted: number; unknown: number } {
  let near = 0;
  let counted = 0;
  let unknown = 0;
  for (let i = 0; i < colours.length; i += 1) {
    const B = backgrounds[i];
    if (!B) {
      unknown += 1;
      continue;
    }
    counted += 1;
    if (deltaE(rgbToLab(colours[i]![0]!, colours[i]![1]!, colours[i]![2]!), rgbToLab(B[0]!, B[1]!, B[2]!)) < CUTOUT.spill.deltaE) near += 1;
  }
  return { share: counted ? near / counted : 0, counted, unknown };
}

// ─── Light wrap, shadow, grain ──────────────────────────────────────────────

/** Light-wrap weight at distance d inside the edge: 25 % at the edge, 0 at 6 px (8 px on hair), times the pixel's alpha. */
export function wrapWeight(d: number, alpha: number, hair: number): number {
  const R = CUTOUT.wrap.bodyPx + (CUTOUT.wrap.hairPx - CUTOUT.wrap.bodyPx) * hair;
  return CUTOUT.wrap.opacity * alpha * Math.max(0, 1 - d / R);
}

export function screen(a: number, b: number): number {
  return 255 - ((255 - a) * (255 - b)) / 255;
}

/** The ambient shadow's darkness (0–0.3) on a canvas: the alpha moved 0.01 W down, blurred (sigma 0.02 W). */
export function shadowMap(alpha: Float32Array, w: number, h: number, frameWidth: number = MASTER.width): Float32Array {
  const dy = Math.round(CUTOUT.shadow.dy * frameWidth);
  const moved = new Float32Array(w * h);
  for (let y = dy; y < h; y += 1) moved.set(alpha.subarray((y - dy) * w, (y - dy + 1) * w), y * w);
  const out = gaussBlur(moved, w, h, (CUTOUT.shadow.blur * frameWidth) / 2);
  for (let i = 0; i < w * h; i += 1) out[i] = out[i]! * CUTOUT.shadow.opacity;
  return out;
}

/**
 * The photo's luma noise (levels, 0–255): 1.4826 × the median |response| of
 * Immerkær's noise operator over the selected pixels, ÷ 6 (the operator's
 * gain on white noise).
 */
export function lumaNoise(rgb: ArrayLike<number>, w: number, h: number, select: Uint8Array): number {
  const Y = (i: number) => 0.2126 * rgb[i * 3]! + 0.7152 * rgb[i * 3 + 1]! + 0.0722 * rgb[i * 3 + 2]!;
  const resp: number[] = [];
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      if (!select[i]) continue;
      const v = Y(i - w - 1) - 2 * Y(i - w) + Y(i - w + 1) - 2 * Y(i - 1) + 4 * Y(i) - 2 * Y(i + 1) + Y(i + w - 1) - 2 * Y(i + w) + Y(i + w + 1);
      resp.push(Math.abs(v));
    }
  }
  return resp.length ? (1.4826 * percentile(resp, 50)) / 6 : 0;
}

export function grainSigma(measured: number): number {
  return Math.min(CUTOUT.grain.max, Math.max(CUTOUT.grain.min, measured));
}

/** One monochrome grain layer, 1 px, seeded: the same offset on R, G and B. */
export function addGrain(rgb: Float32Array, w: number, h: number, sigma: number, seed: number): void {
  const noise = gaussianNoise(seed);
  for (let i = 0; i < w * h; i += 1) {
    const n = noise() * sigma;
    rgb[i * 3]! += n;
    rgb[i * 3 + 1]! += n;
    rgb[i * 3 + 2]! += n;
  }
}

// ─── Unify ──────────────────────────────────────────────────────────────────

export type UnifyStats = { p5L: number; medianL: number; medianC: number; midGreyAB: [number, number] | null; midGreys: number };
export type Unify = { contrast: number; saturation: number; wb: [number, number] };

/**
 * The bounded unify for a figure on a ground:
 *   - contrast about the figure's median L*, set so its 5th-percentile L* meets
 *     the ground's L* (black levels match), within 0.9–1.1;
 *   - saturation 0 at a median C* of 10 or less, −15 % at 30 or more, linear;
 *   - white balance: the mid-greys' mean a* and b* moved towards the ground's,
 *     at most ΔE 4.
 */
export function chooseUnify(stats: UnifyStats, groundLab: readonly number[]): Unify {
  const u = CUTOUT.unify;
  const span = stats.medianL - stats.p5L;
  const contrast = span > 1 ? Math.min(u.contrast.max, Math.max(u.contrast.min, (stats.medianL - groundLab[0]!) / span)) : 1;
  const t = Math.min(1, Math.max(0, (stats.medianC - u.chroma.from) / (u.chroma.to - u.chroma.from)));
  const saturation = 1 - (1 - u.saturation.min) * t;
  let wb: [number, number] = [0, 0];
  if (stats.midGreyAB && stats.midGreys >= u.midGrey.minPixels) {
    const da = groundLab[1]! - stats.midGreyAB[0];
    const db = groundLab[2]! - stats.midGreyAB[1];
    const m = Math.hypot(da, db);
    const k = m > u.wbMaxDeltaE ? u.wbMaxDeltaE / m : 1;
    wb = [da * k, db * k];
  }
  return { contrast, saturation, wb };
}

/** The unify scaled towards none by k (0–1). */
export function scaleUnify(u: Unify, k: number): Unify {
  return { contrast: 1 + (u.contrast - 1) * k, saturation: 1 + (u.saturation - 1) * k, wb: [u.wb[0] * k, u.wb[1] * k] };
}

export function applyUnifyLab(lab: readonly number[], u: Unify, pivotL: number): [number, number, number] {
  return [pivotL + (lab[0]! - pivotL) * u.contrast, lab[1]! * u.saturation + u.wb[0], lab[2]! * u.saturation + u.wb[1]];
}

/** The median Lab of a set, per channel. */
export function medianLab(labs: readonly (readonly number[])[]): [number, number, number] {
  return [0, 1, 2].map((k) => percentile(labs.map((c) => c[k]!), 50)) as [number, number, number];
}

/** The largest k ≤ 1 for which the face box's median colour moves at most ΔE 3 (bisection). */
export function boundUnify(u: Unify, faceLabs: readonly (readonly number[])[], pivotL: number): { unify: Unify; k: number; faceDeltaE: number } {
  const before = medianLab(faceLabs);
  const moved = (k: number) => deltaE(before, medianLab(faceLabs.map((c) => applyUnifyLab(c, scaleUnify(u, k), pivotL))));
  if (!faceLabs.length || moved(1) <= CUTOUT.unify.faceMaxDeltaE) return { unify: u, k: 1, faceDeltaE: faceLabs.length ? moved(1) : 0 };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2;
    if (moved(mid) <= CUTOUT.unify.faceMaxDeltaE) lo = mid;
    else hi = mid;
  }
  return { unify: scaleUnify(u, lo), k: lo, faceDeltaE: moved(lo) };
}

// ─── Face alpha ─────────────────────────────────────────────────────────────

/** ≥ 99 % of the face box at alpha ≥ 0.9, and no pixel below 0.5 in the box's inner 80 %. */
export function faceAlphaRule(alpha: ArrayLike<number>, w: number, box: { x0: number; y0: number; x1: number; y1: number }): { share: number; innerMin: number; pass: boolean } {
  const { solid, share: minShare, innerMin: floor, inner } = CUTOUT.faceAlpha;
  const mx = ((box.x1 - box.x0) * (1 - inner)) / 2;
  const my = ((box.y1 - box.y0) * (1 - inner)) / 2;
  let total = 0;
  let ok = 0;
  let innerMin = 1;
  for (let y = box.y0; y < box.y1; y += 1) {
    for (let x = box.x0; x < box.x1; x += 1) {
      const v = alpha[y * w + x]!;
      total += 1;
      if (v >= solid) ok += 1;
      if (x >= box.x0 + mx && x < box.x1 - mx && y >= box.y0 + my && y < box.y1 - my) innerMin = Math.min(innerMin, v);
    }
  }
  const share = total ? ok / total : 0;
  return { share, innerMin, pass: total > 0 && share >= minShare - 1e-12 && innerMin >= floor };
}

// ─── Halo ───────────────────────────────────────────────────────────────────

/** Of the composite's pixels 0 < d ≤ 4 px outside the alpha edge, the share within ΔE 10 of the source's own background colour. */
export function haloShare(composite: ArrayLike<number>, channels: number, inside: Uint8Array, w: number, h: number, backgroundLab: readonly number[]): { share: number; band: number } {
  const d = distanceOutside(inside, w, h);
  let band = 0;
  let near = 0;
  for (let i = 0; i < w * h; i += 1) {
    if (d[i]! > 0 && d[i]! <= CUTOUT.halo.bandPx) {
      band += 1;
      const lab = rgbToLab(composite[i * channels]!, composite[i * channels + 1]!, composite[i * channels + 2]!);
      if (deltaE(lab, backgroundLab) < CUTOUT.halo.deltaE) near += 1;
    }
  }
  return { share: band ? near / band : 0, band };
}

// ─── Order ──────────────────────────────────────────────────────────────────

/** O21: A when every rule passes, else B, else skip. */
export function chooseVariant(a: { pass: boolean }, b: { pass: boolean } | null): "A" | "B" | "skip" {
  if (a.pass) return "A";
  if (b?.pass) return "B";
  return "skip";
}

// ─── Rendering ──────────────────────────────────────────────────────────────

type Sharp = typeof import("sharp");
async function sharpLib(): Promise<Sharp> {
  const m = await import("sharp");
  return ((m as unknown as { default: Sharp }).default ?? (m as unknown as Sharp)) as Sharp;
}

export type CutoutRule = { rule: string; pass: boolean; detail: string };

export type CutoutResult = {
  pass: boolean;
  plan: FigurePlan | null;
  rules: CutoutRule[];
  figures: {
    faceAlphaShare: number | null;
    faceAlphaInnerMin: number | null;
    spillShare: number | null;
    spillCounted: number;
    spillUnknown: number;
    haloShare: number | null;
    haloBand: number;
    hairShare: number | null;
    grainMeasured: number | null;
    grainSigma: number | null;
    unify: (Unify & { k: number; faceDeltaE: number; wbDeltaE: number; midGreys: number }) | null;
    separation: { flat: number; lift: number } | null;
  };
  ground: GroundSpec | null;
  contrastShare: number | null;
  charcoal: { used: string; panelOwn: string | null; panelSeen: string | null };
  master: Buffer | null;
  crop45: Buffer | null;
  square: Buffer | null;
  disclosure: string;
  layout: TextLayout;
  layoutCheck: LayoutCheck;
};

export type CutoutInput = {
  photo: Buffer;
  mask: PersonMask;
  face: (FaceLines & { box: { x: number; y: number; width: number; height: number } }) | null;
  eyes?: { ok: boolean; why: string };
  subjects: number;
  name: Piece;
  info: Piece[];
  lockup: Piece | null;
  /** The PSD's taped panel layer and flattened preview, for the charcoal re-sample (printed; the ruling's #32322f is used). */
  panel?: Buffer | null;
  preview?: Buffer | null;
  /** The mask refined at source resolution (segment.ts refineAtSource); the caller supplies it so the module stays testable. */
  refine?: (region: { left: number; top: number; width: number; height: number }) => Promise<PersonMask>;
  /** Diagnostics: one-channel maps at frame size (matte, hair, spill and halo hits). */
  debug?: (name: string, gray: Uint8Array, width: number, height: number) => Promise<void>;
};

type Canvas = {
  cw: number;
  /** The scaled photo's pixels on the canvas (0 outside it). */
  rgb: Uint8Array;
  inPhoto: Uint8Array;
  /** The refined soft alpha at output size. */
  a: Float32Array;
  hair: Float32Array;
  /** The matte (before the fade) and the final alpha (with it). */
  matte: Float32Array;
  alpha: Float32Array;
  distIn: Float32Array;
  /** Decontaminated foreground colour, floats. */
  F: Float32Array;
  bgAt: (x: number, y: number) => [number, number, number] | null;
  faceX: number;
};

export async function renderCutout(input: CutoutInput): Promise<CutoutResult> {
  const sharp = await sharpLib();
  const frame = MASTER;
  const W = frame.width;
  const H = frame.height;
  const layout = layoutText({ lockup: input.lockup, name: input.name, info: input.info }, frame);
  const layoutCheck = checkLayout(layout, frame);
  const pieces = [...(input.lockup ? [input.lockup] : []), input.name, ...input.info];
  let panelOwn: string | null = null;
  let seen: string | null = null;
  if (input.panel) {
    const raw = await sharp(input.panel).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    panelOwn = panelCharcoal(raw.data, raw.info.width, raw.info.height);
  }
  if (input.preview) {
    const raw = await sharp(input.preview).resize(1080).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    seen = panelSeen(raw.data, raw.info.width, raw.info.height, raw.info.channels);
  }
  const rules: CutoutRule[] = [];
  const figures: CutoutResult["figures"] = { faceAlphaShare: null, faceAlphaInnerMin: null, spillShare: null, spillCounted: 0, spillUnknown: 0, haloShare: null, haloBand: 0, hairShare: null, grainMeasured: null, grainSigma: null, unify: null, separation: null };
  const base = { charcoal: { used: CUTOUT.ground.charcoal, panelOwn, panelSeen: seen }, disclosure: DISCLOSURE_B, layout, layoutCheck };
  const done = (plan: FigurePlan | null, ground: GroundSpec | null = null, contrastShare: number | null = null): CutoutResult => ({ pass: false, plan, rules, figures, ground, contrastShare, master: null, crop45: null, square: null, ...base });

  rules.push({ rule: "subject", pass: input.subjects === 1, detail: `${input.subjects} face${input.subjects === 1 ? "" : "s"}` });
  if (input.eyes) rules.push({ rule: "eyes", pass: input.eyes.ok, detail: input.eyes.ok ? "measurable" : `not measurable: ${input.eyes.why}` });
  if (!input.face) {
    rules.push({ rule: "placement", pass: false, detail: "no face found to place" });
    return done(null);
  }
  const face = input.face;
  const edges = maskEdges(input.mask, { top: face.headTopY, bottom: face.chinY });
  const planned = planFigure({ width: input.mask.width, height: input.mask.height }, face, edges, frame);
  if ("blocker" in planned) {
    rules.push({ rule: "placement", pass: false, detail: planned.blocker });
    return done(null);
  }
  const plan = planned;
  rules.push({
    rule: "placement",
    pass: true,
    detail: `head ${plan.headTop.toFixed(3)} · eyes ${plan.eyes.toFixed(3)} · chin ${plan.chin.toFixed(3)} H · face box ${Math.round(plan.faceWidthPx)} px · face centre ${plan.faceCentreX.toFixed(3)} W (1:1 ${plan.squareCentreX.toFixed(3)}) · ${plan.scale.toFixed(3)}× source · ends ${(plan.figureEnd / H).toFixed(3)} H${plan.fade ? " (fades)" : " (bottom-anchored)"}${plan.sideCut ? ` · ${plan.sideCut} side cut flush` : ""}`,
  });
  if (!(rules.every((r) => r.pass) && layoutCheck.insideSafe && layoutCheck.insideTextBox)) return done(plan);

  // 1. The matte refined at source resolution over the part of the photo any canvas shows (frame x −270…1350).
  const s = plan.scale;
  const region = {
    left: (-2 * CUTOUT.wide - plan.rect.left) / s - CUTOUT.matte.marginPx,
    top: -plan.rect.top / s - CUTOUT.matte.marginPx,
    width: (W + 4 * CUTOUT.wide) / s + 2 * CUTOUT.matte.marginPx,
    height: H / s + 2 * CUTOUT.matte.marginPx,
  };
  const refined = input.refine ? await input.refine(region) : input.mask;

  // 2. Photo and matte at output size.
  const rotated = await sharp(input.photo).rotate().removeAlpha().toBuffer();
  const pw = Math.max(1, Math.round(plan.rect.width));
  const ph = Math.max(1, Math.round(plan.rect.height));
  const scaledPhoto = await sharp(rotated).resize(pw, ph, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer();
  const scaledA = Float32Array.from(
    await sharp(Buffer.from(Uint8Array.from(refined.alpha, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255))), { raw: { width: refined.width, height: refined.height, channels: 1 } })
      .resize(pw, ph, { fit: "fill", kernel: "cubic" })
      .extractChannel(0)
      .raw()
      .toBuffer(),
    (v) => v / 255,
  );

  const chinRow = Math.round(face.chinY * s + plan.rect.top);
  const faceXFrame = plan.rect.left + (face.box.x + face.box.width / 2) * s;

  const canvasFor = (cw: number, ox: number): Canvas => {
    const left = Math.round(plan.rect.left) + ox;
    const top = Math.round(plan.rect.top);
    const n = cw * H;
    const rgb = new Uint8Array(n * 3);
    const inPhoto = new Uint8Array(n);
    const a = new Float32Array(n);
    for (let y = 0; y < H; y += 1) {
      const sy = y - top;
      if (sy < 0 || sy >= ph) continue;
      for (let x = 0; x < cw; x += 1) {
        const sx = x - left;
        if (sx < 0 || sx >= pw) continue;
        const i = y * cw + x;
        const j = sy * pw + sx;
        inPhoto[i] = 1;
        rgb[i * 3] = scaledPhoto[j * 3]!;
        rgb[i * 3 + 1] = scaledPhoto[j * 3 + 1]!;
        rgb[i * 3 + 2] = scaledPhoto[j * 3 + 2]!;
        a[i] = scaledA[j]!;
      }
    }
    const hair = hairWeight(a, cw, H, chinRow);
    const matte = composeMatte(a, cw, H, hair);
    const alpha = new Float32Array(n);
    for (let y = 0; y < H; y += 1) {
      const k = plan.fade ? fadeAt(y, plan.figureEnd, H) : 1;
      for (let x = 0; x < cw; x += 1) alpha[y * cw + x] = matte[y * cw + x]! * k;
    }
    // Distance inside the matte's edge (the fade is not an edge).
    const outside = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) outside[i] = matte[i]! < 0.5 ? 1 : 0;
    const distIn = distanceOutside(outside, cw, H);
    // Local background where it is needed: the soft band and the spill band.
    const need = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) if ((a[i]! >= CUTOUT.decontam.lo && a[i]! <= CUTOUT.decontam.hi) || (matte[i]! >= 0.5 && distIn[i]! <= CUTOUT.spill.bandPx)) need[i] = 1;
    const bg = localBackground(rgb, a, inPhoto, cw, H, need);
    // Decontaminate; pixels the feather reaches beyond the matte take the nearest solid pixel's colour.
    const F = new Float32Array(n * 3);
    const solidSet = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) solidSet[i] = a[i]! >= 0.5 && inPhoto[i] ? 1 : 0;
    const near = nearestInside(solidSet, cw, H).idx;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < cw; x += 1) {
        const i = y * cw + x;
        if (alpha[i]! <= 0 && a[i]! < CUTOUT.decontam.lo) continue;
        const I = [rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!];
        let c: readonly number[] = I;
        if (a[i]! >= CUTOUT.decontam.lo && a[i]! <= CUTOUT.decontam.hi) {
          const B = bg.at(x, y);
          if (B) c = solveForeground(I, a[i]!, B);
        }
        F[i * 3] = c[0]!;
        F[i * 3 + 1] = c[1]!;
        F[i * 3 + 2] = c[2]!;
      }
    }
    for (let i = 0; i < n; i += 1) {
      if (alpha[i]! > 0 && (a[i]! < CUTOUT.decontam.lo || !inPhoto[i]) && near[i]! >= 0 && near[i] !== i) {
        const j = near[i]!;
        F[i * 3] = F[j * 3]!;
        F[i * 3 + 1] = F[j * 3 + 1]!;
        F[i * 3 + 2] = F[j * 3 + 2]!;
      }
    }
    return { cw, rgb, inPhoto, a, hair, matte, alpha, distIn, F, bgAt: bg.at, faceX: faceXFrame + ox };
  };

  const main = canvasFor(W, 0);
  const n = W * H;

  // 3. Face alpha (≥ 99 % at ≥ 0.9; inner 80 % ≥ 0.5).
  const box = face.box;
  const fb = {
    x0: Math.max(0, Math.round(plan.rect.left + box.x * s)),
    y0: Math.max(0, Math.round(plan.rect.top + box.y * s)),
    x1: Math.min(W, Math.round(plan.rect.left + (box.x + box.width) * s)),
    y1: Math.min(H, Math.round(plan.rect.top + (box.y + box.height) * s)),
  };
  const fa = faceAlphaRule(main.alpha, W, fb);
  figures.faceAlphaShare = fa.share;
  figures.faceAlphaInnerMin = fa.innerMin;
  rules.push({ rule: "faceAlpha", pass: fa.pass, detail: `${(fa.share * 100).toFixed(2)} % of the face box at alpha ≥ 0.9 (min 99 %); inner 80 % min ${fa.innerMin.toFixed(2)} (min 0.5)` });

  // 4. Feather and hair.
  let hairPx = 0;
  let edgePx = 0;
  for (let i = 0; i < n; i += 1) {
    if (main.matte[i]! > 0.05 && main.matte[i]! < 0.95) {
      edgePx += 1;
      if (main.hair[i]! > 0.5) hairPx += 1;
    }
  }
  figures.hairShare = edgePx ? hairPx / edgePx : 0;
  rules.push({ rule: "feather", pass: true, detail: `hair ${CUTOUT.feather.hairPx} px, body ${CUTOUT.feather.bodyPx} px (10–90 %) at output size; ${(figures.hairShare * 100).toFixed(1)} % of the edge reads as hair` });

  // 5. Spill: the 6 px band inside the edge, decontaminated colour against the local background.
  const bandColours: number[][] = [];
  const bandBgs: ([number, number, number] | null)[] = [];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (main.matte[i]! < 0.5 || main.distIn[i]! > CUTOUT.spill.bandPx || !main.inPhoto[i]) continue;
      if (plan.fade && y >= plan.figureEnd - CUTOUT.fadeBand * H) continue; // the fade, not an edge
      bandColours.push([main.F[i * 3]!, main.F[i * 3 + 1]!, main.F[i * 3 + 2]!]);
      bandBgs.push(main.bgAt(x, y));
    }
  }
  const spill = spillShare(bandColours, bandBgs);
  if (input.debug) {
    const map = new Uint8Array(n);
    let k = 0;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = y * W + x;
        if (main.matte[i]! < 0.5 || main.distIn[i]! > CUTOUT.spill.bandPx || !main.inPhoto[i]) continue;
        if (plan.fade && y >= plan.figureEnd - CUTOUT.fadeBand * H) continue;
        const B = bandBgs[k];
        const C = bandColours[k];
        k += 1;
        map[i] = !B ? 64 : deltaE(rgbToLab(C![0]!, C![1]!, C![2]!), rgbToLab(B[0], B[1], B[2])) < CUTOUT.spill.deltaE ? 255 : 128;
      }
    }
    await input.debug("spill", map, W, H);
    await input.debug("matte", Uint8Array.from(main.matte, (v) => Math.round(v * 255)), W, H);
    await input.debug("hair", Uint8Array.from(main.hair, (v) => Math.round(v * 255)), W, H);
    await input.debug("a", Uint8Array.from(main.a, (v) => Math.round(v * 255)), W, H);
  }
  figures.spillShare = spill.share;
  figures.spillCounted = spill.counted;
  figures.spillUnknown = spill.unknown;
  rules.push({ rule: "spill", pass: spill.share <= CUTOUT.spill.maxShare, detail: `${(spill.share * 100).toFixed(2)} % of ${spill.counted} band px within ΔE ${CUTOUT.spill.deltaE} of the local background (max ${CUTOUT.spill.maxShare * 100} %; ${spill.unknown} px with no background within 48 px left out)` });

  // 6. Unify, chosen on the frame's solid figure, bounded by the face box.
  const groundLab = rgbToLab(...parseHex(CUTOUT.ground.charcoal));
  const Ls: number[] = [];
  const Cs: number[] = [];
  let mgA = 0;
  let mgB = 0;
  let mgN = 0;
  const faceLabs: number[][] = [];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (main.matte[i]! < 0.98 || !main.inPhoto[i]) continue;
      if ((x + y) % 2) continue; // every other pixel is enough for the statistics
      const lab = rgbToLab(main.F[i * 3]!, main.F[i * 3 + 1]!, main.F[i * 3 + 2]!);
      Ls.push(lab[0]);
      const c = Math.hypot(lab[1], lab[2]);
      Cs.push(c);
      const mg = CUTOUT.unify.midGrey;
      if (lab[0] >= mg.lMin && lab[0] <= mg.lMax && c <= mg.cMax) {
        mgA += lab[1];
        mgB += lab[2];
        mgN += 1;
      }
      if (x >= fb.x0 && x < fb.x1 && y >= fb.y0 && y < fb.y1) faceLabs.push(lab);
    }
  }
  const stats: UnifyStats = { p5L: percentile(Ls, 5), medianL: percentile(Ls, 50), medianC: percentile(Cs, 50), midGreyAB: mgN ? [mgA / mgN, mgB / mgN] : null, midGreys: mgN * 2 };
  const proposed = chooseUnify(stats, groundLab);
  const bounded = boundUnify(proposed, faceLabs, stats.medianL);
  const unify = bounded.unify;
  figures.unify = { ...unify, k: bounded.k, faceDeltaE: bounded.faceDeltaE, wbDeltaE: Math.hypot(unify.wb[0], unify.wb[1]), midGreys: stats.midGreys };

  // 7. Grain sigma from the photo's own luma noise on the solid figure.
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) solid[i] = main.matte[i]! >= 0.98 && main.distIn[i]! > 3 && main.inPhoto[i] ? 1 : 0;
  const measured = lumaNoise(main.rgb, W, H, solid);
  const sigma = grainSigma(measured);
  figures.grainMeasured = measured;
  figures.grainSigma = sigma;

  /** The picture (ground, shadow, figure, light wrap) on a canvas, floats; no grain. */
  const unified = new Map<Canvas, { Fu: Float32Array; shade: Float32Array }>();
  const unifiedFor = (c: Canvas) => {
    let u = unified.get(c);
    if (!u) {
      const m = c.cw * H;
      const Fu = new Float32Array(m * 3);
      for (let i = 0; i < m; i += 1) {
        if (c.alpha[i]! <= 0) continue;
        const lab = applyUnifyLab(rgbToLab(c.F[i * 3]!, c.F[i * 3 + 1]!, c.F[i * 3 + 2]!), unify, stats.medianL);
        Fu.set(labToRgb(lab[0], lab[1], lab[2]).map((v) => Math.min(255, Math.max(0, v))), i * 3);
      }
      u = { Fu, shade: shadowMap(c.alpha, c.cw, H, W) };
      unified.set(c, u);
    }
    return u;
  };
  const picture = (c: Canvas, ground: GroundSpec): { rgb: Float32Array; groundRgb: Float32Array; Fu: Float32Array } => {
    const cw = c.cw;
    const m = cw * H;
    const g = renderGround(ground, cw, H, H);
    const { Fu, shade } = unifiedFor(c);
    const out = new Float32Array(m * 3);
    for (let i = 0; i < m; i += 1) {
      const al = c.alpha[i]!;
      const k = 1 - shade[i]!;
      for (let ch = 0; ch < 3; ch += 1) {
        const gr = g[i * 3 + ch]!;
        let v = al * Fu[i * 3 + ch]! + (1 - al) * gr * k;
        if (al > 0) {
          const w = wrapWeight(c.distIn[i]!, al, c.hair[i]!);
          if (w > 0) v += w * (screen(v, gr) - v);
        }
        out[i * 3 + ch] = v;
      }
    }
    return { rgb: out, groundRgb: g, Fu };
  };

  // 8. Ground: the one with more separation between the figure's inner edge band and the ground behind it.
  const sep = (p: { groundRgb: Float32Array; Fu: Float32Array }) => {
    const v: number[] = [];
    for (let i = 0; i < n; i += 1) {
      if (main.matte[i]! < 0.5 || main.distIn[i]! > CUTOUT.spill.bandPx || !main.inPhoto[i] || (i % 3)) continue;
      v.push(deltaE(rgbToLab(p.Fu[i * 3]!, p.Fu[i * 3 + 1]!, p.Fu[i * 3 + 2]!), rgbToLab(p.groundRgb[i * 3]!, p.groundRgb[i * 3 + 1]!, p.groundRgb[i * 3 + 2]!)));
    }
    return percentile(v, 50);
  };
  const flatSpec = groundSpec("flat", main.faceX);
  const liftSpec = groundSpec("lift", main.faceX);
  const pFlat = picture(main, flatSpec);
  const pLift = picture(main, liftSpec);
  const sFlat = sep(pFlat);
  const sLift = sep(pLift);
  figures.separation = { flat: sFlat, lift: sLift };
  const finish = (p: Float32Array, seed: number, w: number, h: number) => {
    const out = Float32Array.from(p);
    addGrain(out, w, h, sigma, seed);
    return Buffer.from(Uint8Array.from(out, (v) => Math.min(255, Math.max(0, Math.round(v)))));
  };
  const contrastOf = (rgb8: Buffer) => lowContrastShare(rgb8, W, 3, textBoxRect(frame));
  const flat8 = finish(pFlat.rgb, 5, W, H);
  const lift8 = finish(pLift.rgb, 5, W, H);
  const cFlat = contrastOf(flat8);
  const cLift = contrastOf(lift8);
  let useLift = sLift > sFlat;
  if (useLift && cLift > PHOTO_RULES.maxLowContrastShare && cFlat <= PHOTO_RULES.maxLowContrastShare) useLift = false;
  if (!useLift && cFlat > PHOTO_RULES.maxLowContrastShare && cLift <= PHOTO_RULES.maxLowContrastShare) useLift = true;
  const ground = useLift ? liftSpec : flatSpec;
  const chosen = useLift ? pLift : pFlat;
  const master8 = useLift ? lift8 : flat8;
  const contrastShare = useLift ? cLift : cFlat;
  rules.push({ rule: "contrast", pass: contrastShare <= PHOTO_RULES.maxLowContrastShare, detail: `${(contrastShare * 100).toFixed(1)} % of the text box below 3:1 on the final pixels (max ${PHOTO_RULES.maxLowContrastShare * 100} %)` });

  // 9. Halo: the band outside the edge against the source's own background colour, on the chosen ground (before grain).
  const inside = new Uint8Array(n);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) inside[y * W + x] = main.matte[y * W + x]! >= 0.5 && (!plan.fade || y < plan.figureEnd) ? 1 : 0;
  const distOut = distanceOutside(inside, W, H);
  const ring: number[][] = [];
  for (let i = 0; i < n; i += 3) if (main.inPhoto[i] && distOut[i]! >= CUTOUT.halo.ringFrom && distOut[i]! <= CUTOUT.halo.ringTo) ring.push(rgbToLab(main.rgb[i * 3]!, main.rgb[i * 3 + 1]!, main.rgb[i * 3 + 2]!));
  const bgLab = medianLab(ring);
  const halo = haloShare(chosen.rgb, 3, inside, W, H, bgLab);
  figures.haloShare = halo.share;
  figures.haloBand = halo.band;
  rules.push({ rule: "halo", pass: halo.share <= CUTOUT.halo.maxShare, detail: `${(halo.share * 100).toFixed(2)} % of ${halo.band} band px within ΔE ${CUTOUT.halo.deltaE} of the source background (max ${CUTOUT.halo.maxShare * 100} %)` });

  const pass = rules.every((r) => r.pass) && layoutCheck.insideSafe && layoutCheck.insideTextBox;
  // A failed card still renders (for the report's held renders); the caller files only a pass.

  // 10. Outputs: 9:16 and 4:5 from the frame; the 1:1 from a wide canvas (figure moved out for a side cut).
  const overlay = await textOverlay(pieces, layout.all, frame, { k: 1, dx: 0, dy: 0 }, KIT_SHADOW);
  const master = await sharp(master8, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: overlay, left: 0, top: 0 }]).png().toBuffer();
  const crop45 = await sharp(master).extract({ left: 0, top: RECT_45.top, width: W, height: RECT_45.bottom - RECT_45.top }).png().toBuffer();
  const cw = W + 2 * CUTOUT.wide;
  const wideCanvas = canvasFor(cw, squareFigureOffset(plan.sideCut));
  const wideGround = groundSpec(ground.kind, wideCanvas.faceX);
  const widePic = picture(wideCanvas, wideGround);
  const bandH = RECT_45.bottom - RECT_45.top;
  const bandRaw = Buffer.from(Uint8Array.from(widePic.rgb.subarray(RECT_45.top * cw * 3, RECT_45.bottom * cw * 3), (v) => Math.min(255, Math.max(0, Math.round(v)))));
  const side = 1080;
  const sq = await sharp(bandRaw, { raw: { width: cw, height: bandH, channels: 3 } }).resize(side, side, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer();
  const sq8 = finish(Float32Array.from(sq), 6, side, side);
  const k = CUTOUT.squareOffset / CUTOUT.wide;
  const overlay11 = await textOverlay(pieces, layout.all, { width: side, height: side }, { k, dx: CUTOUT.squareOffset, dy: -RECT_45.top * k }, KIT_SHADOW);
  const square = await sharp(sq8, { raw: { width: side, height: side, channels: 3 } }).composite([{ input: overlay11, left: 0, top: 0 }]).png().toBuffer();
  return { pass, plan, rules, figures, ground, contrastShare, master, crop45, square, ...base };
}
