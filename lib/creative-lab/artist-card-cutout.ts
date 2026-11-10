/**
 * Artist card variant B (O21, rebuilt in fix round 4): the artist cut out
 * onto a plain ground. Order per photo: A (artist-card.ts, extension
 * included), then B1, then B2, then skip. Never a scrim.
 *
 * Shared by B1 and B2:
 *   - the figure is the photo's own pixels through the person mask
 *     (segment.ts, MediaPipe Selfie as vendored); nothing generated;
 *   - the ground is flat or a gradient; any texture is the PSD's own;
 *   - the type's contrast test runs on the final backdrop;
 *   - O6 shadow once on the figure; the slot table is variant A's.
 *
 * B1 (Ironworks pattern): a flat ground in the taped panel's own charcoal
 * (re-sampled from the smart object), and behind the figure its silhouette —
 * the figure's alpha scaled 1.18× about its bottom-centre and shifted 0.05 W
 * right — filled with the PSD's Background layer (covering the frame) and
 * clipped by that shape. No tint, no feather beyond 1 px, no shadow. If the
 * type fails contrast over it, the silhouette steps to 70 %, then 50 %
 * opacity; then B2.
 *
 * B2 (Locklead pattern): a vertical linear gradient from the panel charcoal
 * at the top to #1e1e1c at the bottom. Never kit red or coral.
 *
 * Figure rules (loosened): it may end anywhere from 0.80 H down to the frame's
 * bottom; ending above the bottom, its lowest 0.08 H fades linearly to 0. A
 * side cut by the photo's own edge is allowed only flush on the frame's
 * matching side (face centre then 0.38–0.62 W, otherwise 0.45–0.55 W); the
 * head is never cut; the photo's top edge never cuts the person. Kept: the
 * face bands, the 216 px face box, alpha ≥ 0.9 over the face box, a 1–1.5 px
 * feather, the halo test, ≤ 1.0× source.
 */

import {
  KIT_SHADOW,
  MASTER,
  O20,
  PHOTO_RULES,
  RECT_45,
  SLOTS,
  checkLayout,
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
import { deltaE, hex, parseHex, rgbToLab } from "./colour.ts";
import type { PersonMask } from "./segment.ts";

export { deltaE, rgbToLab } from "./colour.ts";

export const CUTOUT = {
  faceCentre: { min: 0.45, max: 0.55 },
  /** With a flush side cut. */
  faceCentreCut: { min: 0.38, max: 0.62 },
  faceAlpha: 0.9,
  /** 10–90 % edge width at output size; σ of a blurred step = width / 2.563. */
  featherPx: 1.25,
  feather: { min: 1, max: 1.5 },
  halo: { bandPx: 4, deltaE: 10, maxShare: 0.02, ringFrom: 8, ringTo: 30 },
  /** The figure may end from here down to the frame's bottom (fraction of H). */
  figureEndMin: 0.8,
  /** Ending above the bottom, the lowest share of H fades to 0. */
  fade: 0.08,
  /** Mask pixels on a photo edge before it counts as cutting the person. */
  touchMinPixels: 3,
  silhouette: { scale: 1.18, shiftX: 0.05, featherPx: 1, opacities: [1, 0.7, 0.5] as const },
  gradientBottom: "#1e1e1c",
  /** Never a ground: kit red and the PSD's coral. */
  forbiddenGrounds: ["#fe3232", "#ff6876"] as const,
} as const;

export const DISCLOSURE_B1 = "artist cut out onto a plain ground, with the artwork's paint as a silhouette";
export const DISCLOSURE_B2 = "artist cut out onto a plain ground";

// ─── Ground ─────────────────────────────────────────────────────────────────

/**
 * The taped panel's charcoal: the per-channel median of its centre (middle
 * half each way), over pixels at least 80 % opaque. The PSD's panel is
 * itself about 91 % opaque (alpha 232), so its own colour is darker than the
 * panel seen over the paint.
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

/** A vertical linear gradient, top colour to bottom colour, as raw RGB. */
export function verticalGradient(width: number, height: number, top: string, bottom: string): Buffer {
  const a = parseHex(top);
  const z = parseHex(bottom);
  const out = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const t = height > 1 ? y / (height - 1) : 0;
    const c = [0, 1, 2].map((k) => Math.round(a[k]! + (z[k]! - a[k]!) * t));
    for (let x = 0; x < width; x += 1) out.set(c, (y * width + x) * 3);
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

export type FigurePlan = {
  scale: number;
  eyes: number;
  headTop: number;
  chin: number;
  faceWidthPx: number;
  faceCentreX: number;
  /** The scaled photo's rectangle on the frame (may run past it). */
  rect: { left: number; top: number; width: number; height: number };
  /** Where the figure ends on the frame, px (the photo's bottom when it cuts the person, else the person's lowest row). */
  figureEnd: number;
  /** The lowest 0.08 H fades: the figure ends above the frame's bottom. */
  fade: boolean;
  sideCut: "left" | "right" | "both" | null;
};

type FaceForCutout = FaceLines & { box: { x: number; width: number } };

/**
 * The largest figure the rules allow (B1 and B2 share it). Scale from the
 * face bands, the 216 px face box and 1.0× source; eyes centred in what the
 * bands leave free; x from the face centre, or flush on the cut side; the
 * figure must reach 0.80 H.
 */
export function planFigure(photo: Size, face: FaceForCutout, edges: MaskEdges, frame: Size = MASTER): FigurePlan | { blocker: string } {
  const H = frame.height;
  const W = frame.width;
  const f = SLOTS.face;
  if (edges.top) return { blocker: "the photo's top edge cuts the person (never allowed)" };
  if (edges.headCutLeft || edges.headCutRight) return { blocker: `the photo's ${edges.headCutLeft ? "left" : "right"} edge cuts the head` };
  const a = Math.max(1, face.eyeY - face.headTopY);
  const b = Math.max(1, face.chinY - face.eyeY);
  const sHi = Math.min(PHOTO_RULES.maxScale, ((f.chinMax - f.headTopMin) * H) / (a + b), ((f.eyesMax - f.headTopMin) * H) / a, ((f.chinMax - f.eyesMin) * H) / b);
  const sLo = (O20.minFaceWidth * W) / face.box.width;
  if (sLo > sHi) return { blocker: `face box ${Math.round(face.box.width * sHi)} px at the largest size the face bands allow (min ${O20.minFaceWidth * W})` };
  const faceCx = face.box.x + face.box.width / 2;
  const sideCut = edges.left && edges.right ? "both" : edges.left ? "left" : edges.right ? "right" : null;
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
    let left: number;
    if (sideCut === "both") {
      if (Math.abs(width - W) > 0.5) {
        reason ||= "the person runs off both photo sides, which can't both sit flush on the frame";
        continue;
      }
      left = 0;
    } else if (sideCut === "left") left = 0;
    else if (sideCut === "right") left = W - width;
    else left = W / 2 - faceCx * s;
    const centre = (left + faceCx * s) / W;
    if (centre < range.min - 1e-9 || centre > range.max + 1e-9) {
      reason ||= `face centre ${centre.toFixed(3)} W outside ${range.min}–${range.max} with the ${sideCut} cut flush`;
      continue;
    }
    const top = e * H - face.eyeY * s;
    const figureEnd = top + end * s;
    if (figureEnd < CUTOUT.figureEndMin * H - 0.5) {
      reason ||= `the figure ends at ${(figureEnd / H).toFixed(3)} H (min ${CUTOUT.figureEndMin})`;
      continue;
    }
    return {
      scale: s,
      eyes: e,
      headTop: e - (a * s) / H,
      chin: e + (b * s) / H,
      faceWidthPx: face.box.width * s,
      faceCentreX: centre,
      rect: { left, top, width, height: photo.height * s },
      figureEnd,
      fade: figureEnd < H - 0.5,
      sideCut,
    };
  }
  return { blocker: reason || "no eye position in 0.58–0.64 H works" };
}

/** Linear fade over the figure's lowest 0.08 H when it ends above the frame's bottom: the alpha multiplier at frame row y. */
export function fadeAt(y: number, figureEnd: number, frameHeight = MASTER.height): number {
  const band = CUTOUT.fade * frameHeight;
  if (y >= figureEnd) return 0;
  if (y <= figureEnd - band) return 1;
  return (figureEnd - y) / band;
}

/** Where a pixel of the silhouette samples the figure: scaled 1.18× about (cx, cy), shifted 0.05 W right. */
export function silhouetteSource(x: number, y: number, about: { x: number; y: number }, frameWidth = MASTER.width): { x: number; y: number } {
  const k = CUTOUT.silhouette.scale;
  return { x: (x - CUTOUT.silhouette.shiftX * frameWidth - about.x) / k + about.x, y: (y - about.y) / k + about.y };
}

// ─── Halo ───────────────────────────────────────────────────────────────────

/** Chamfer distance (in px, ≈ Euclidean) from every pixel to the nearest pixel where `inside` is true. */
export function distanceOutside(inside: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) d[i] = inside[i] ? 0 : INF;
  const b = Math.SQRT2;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (x > 0) d[i] = Math.min(d[i]!, d[i - 1]! + 1);
      if (y > 0) {
        d[i] = Math.min(d[i]!, d[i - w]! + 1);
        if (x > 0) d[i] = Math.min(d[i]!, d[i - w - 1]! + b);
        if (x < w - 1) d[i] = Math.min(d[i]!, d[i - w + 1]! + b);
      }
    }
  }
  for (let y = h - 1; y >= 0; y -= 1) {
    for (let x = w - 1; x >= 0; x -= 1) {
      const i = y * w + x;
      if (x < w - 1) d[i] = Math.min(d[i]!, d[i + 1]! + 1);
      if (y < h - 1) {
        d[i] = Math.min(d[i]!, d[i + w]! + 1);
        if (x < w - 1) d[i] = Math.min(d[i]!, d[i + w + 1]! + b);
        if (x > 0) d[i] = Math.min(d[i]!, d[i + w - 1]! + b);
      }
    }
  }
  return d;
}

/** Of the composite's pixels 0 < d ≤ 4 px outside the alpha edge, the share within ΔE 10 of the source's own background colour. */
export function haloShare(composite: Uint8Array | Buffer, channels: number, inside: Uint8Array, w: number, h: number, backgroundLab: readonly number[]): { share: number; band: number } {
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

/** O21: A when every rule passes, else B1, else B2, else skip. */
export function chooseVariant(a: { pass: boolean }, b1: { pass: boolean } | null, b2: { pass: boolean } | null): "A" | "B1" | "B2" | "skip" {
  if (a.pass) return "A";
  if (b1?.pass) return "B1";
  if (b2?.pass) return "B2";
  return "skip";
}

// ─── Rendering ──────────────────────────────────────────────────────────────

type Sharp = typeof import("sharp");
async function sharpLib(): Promise<Sharp> {
  const m = await import("sharp");
  return ((m as unknown as { default: Sharp }).default ?? (m as unknown as Sharp)) as Sharp;
}

export type CutoutRule = { rule: string; pass: boolean; detail: string };

export type CutoutVariant = {
  variant: "B1" | "B2";
  pass: boolean;
  rules: CutoutRule[];
  contrastShare: number;
  /** B1 only: the silhouette's opacity that passed (or the last tried). */
  silhouetteOpacity: number | null;
  master: Buffer | null;
  crop45: Buffer | null;
  square: Buffer | null;
  disclosure: string;
};

export type CutoutResult = {
  plan: FigurePlan | null;
  /** Rules shared by B1 and B2 (placement, edge quality). */
  shared: CutoutRule[];
  sharedPass: boolean;
  figures: {
    faceAlphaMin: number | null;
    /** The share of the face box at alpha ≥ 0.9 (reported beside the rule's minimum). */
    faceAlphaShare: number | null;
    featherPx: number;
    haloShare: number | null;
    haloBand: number;
    bottomShare: number;
  };
  charcoal: string;
  b1: CutoutVariant | null;
  b2: CutoutVariant | null;
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
  /** The PSD's Background layer and taped-panel layer, as PNG. */
  background: Buffer;
  panel: Buffer;
};

export async function renderCutout(input: CutoutInput): Promise<CutoutResult> {
  const sharp = await sharpLib();
  const frame = MASTER;
  const W = frame.width;
  const H = frame.height;
  const layout = layoutText({ lockup: input.lockup, name: input.name, info: input.info }, frame);
  const layoutCheck = checkLayout(layout, frame);
  const pieces = [...(input.lockup ? [input.lockup] : []), input.name, ...input.info];
  const panelRaw = await sharp(input.panel).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const charcoal = panelCharcoal(panelRaw.data, panelRaw.info.width, panelRaw.info.height);
  const shared: CutoutRule[] = [];
  const figures = { faceAlphaMin: null as number | null, faceAlphaShare: null as number | null, featherPx: CUTOUT.featherPx, haloShare: null as number | null, haloBand: 0, bottomShare: 0 };
  const done = (plan: FigurePlan | null): CutoutResult => ({ plan, shared, sharedPass: false, figures, charcoal, b1: null, b2: null, layout, layoutCheck });

  shared.push({ rule: "subject", pass: input.subjects === 1, detail: `${input.subjects} face${input.subjects === 1 ? "" : "s"}` });
  if (input.eyes) shared.push({ rule: "eyes", pass: input.eyes.ok, detail: input.eyes.ok ? "measurable" : `not measurable: ${input.eyes.why}` });
  if (!input.face) {
    shared.push({ rule: "placement", pass: false, detail: "no face found to place" });
    return done(null);
  }
  const face = input.face;
  const edges = maskEdges(input.mask, { top: face.headTopY, bottom: face.chinY });
  figures.bottomShare = edges.bottomShare;
  const planned = planFigure({ width: input.mask.width, height: input.mask.height }, face, edges, frame);
  if ("blocker" in planned) {
    shared.push({ rule: "placement", pass: false, detail: planned.blocker });
    return done(null);
  }
  const plan = planned;
  shared.push({
    rule: "placement",
    pass: true,
    detail: `head ${plan.headTop.toFixed(3)} · eyes ${plan.eyes.toFixed(3)} · chin ${plan.chin.toFixed(3)} H · face box ${Math.round(plan.faceWidthPx)} px · face centre ${plan.faceCentreX.toFixed(3)} W · ${plan.scale.toFixed(3)}× source · ends ${(plan.figureEnd / H).toFixed(3)} H${plan.fade ? " (fades)" : ""}${plan.sideCut ? ` · ${plan.sideCut} side cut flush` : ""}`,
  });

  // The figure at output size. Built per canvas: the frame (9:16 and its 4:5),
  // and a canvas 135 px wider each side for the 1:1 (O1 re-sits the 4:5 at 0.8×,
  // so the square shows 108 / 0.8 = 135 px of the figure beyond each side).
  const rotated = await sharp(input.photo).rotate().removeAlpha().toBuffer();
  const pw = Math.max(1, Math.round(plan.rect.width));
  const ph = Math.max(1, Math.round(plan.rect.height));
  const scaledPhoto = await sharp(rotated).resize(pw, ph, { fit: "fill" }).raw().toBuffer();
  const scaledMask = await sharp(Buffer.from(Uint8Array.from(input.mask.alpha, (v) => Math.round(v * 255))), { raw: { width: input.mask.width, height: input.mask.height, channels: 1 } })
    .resize(pw, ph, { fit: "fill", kernel: "cubic" })
    .extractChannel(0)
    .raw()
    .toBuffer();
  const WIDE = 135;

  type Layer = { cw: number; ox: number; fx: number; fy: number; vw: number; vh: number; vx0: number; vy0: number; rgb: Buffer; binary: Buffer; alpha: Buffer; figure: Buffer; shadow: Buffer; inside: Uint8Array };
  const layerFor = async (cw: number, ox: number): Promise<Layer | null> => {
    const left = Math.round(plan.rect.left) + ox;
    const top = Math.round(plan.rect.top);
    const vx0 = Math.max(0, -left);
    const vy0 = Math.max(0, -top);
    const vx1 = Math.min(pw, cw - left);
    const vy1 = Math.min(ph, H - top);
    const vw = vx1 - vx0;
    const vh = vy1 - vy0;
    if (vw <= 0 || vh <= 0) return null;
    const region = { left: vx0, top: vy0, width: vw, height: vh };
    const rgb = await sharp(scaledPhoto, { raw: { width: pw, height: ph, channels: 3 } }).extract(region).raw().toBuffer();
    const maskOut = await sharp(scaledMask, { raw: { width: pw, height: ph, channels: 1 } }).extract(region).extractChannel(0).raw().toBuffer();
    const binary = Buffer.from(Uint8Array.from(maskOut, (v) => (v > 127 ? 255 : 0)));
    const feathered = await sharp(binary, { raw: { width: vw, height: vh, channels: 1 } }).blur(Math.max(0.3, CUTOUT.featherPx / 2.563)).extractChannel(0).raw().toBuffer();
    const fx = left + vx0;
    const fy = top + vy0;
    // The fade over the lowest 0.08 H when the figure ends above the frame's bottom.
    const alpha = Buffer.alloc(vw * vh);
    for (let y = 0; y < vh; y += 1) {
      const k = plan.fade ? fadeAt(y + fy, plan.figureEnd, H) : 1;
      for (let x = 0; x < vw; x += 1) alpha[y * vw + x] = Math.round(feathered[y * vw + x]! * k);
    }
    const figure = await sharp(rgb, { raw: { width: vw, height: vh, channels: 3 } }).joinChannel(alpha, { raw: { width: vw, height: vh, channels: 1 } }).png().toBuffer();
    const inside = new Uint8Array(cw * H);
    for (let y = 0; y < vh; y += 1) for (let x = 0; x < vw; x += 1) if (binary[y * vw + x]! > 0 && (!plan.fade || y + fy < plan.figureEnd)) inside[(y + fy) * cw + (x + fx)] = 1;
    // O6 once on the figure, on the canvas (a full-width figure's shadow must not run past it).
    const shadowAlpha = Buffer.alloc(cw * H);
    const dy = Math.round(KIT_SHADOW.dy * W);
    for (let y = 0; y < vh; y += 1) {
      const ty = y + fy + dy;
      if (ty < 0 || ty >= H) continue;
      for (let x = 0; x < vw; x += 1) shadowAlpha[ty * cw + x + fx] = Math.round(alpha[y * vw + x]! * KIT_SHADOW.opacity);
    }
    const blurredShadow = await sharp(shadowAlpha, { raw: { width: cw, height: H, channels: 1 } }).blur(Math.max(0.3, (KIT_SHADOW.blur * W) / 2)).extractChannel(0).raw().toBuffer();
    const shadow = await sharp(Buffer.alloc(cw * H * 3), { raw: { width: cw, height: H, channels: 3 } }).joinChannel(blurredShadow, { raw: { width: cw, height: H, channels: 1 } }).png().toBuffer();
    return { cw, ox, fx, fy, vw, vh, vx0, vy0, rgb, binary, alpha, figure, shadow, inside };
  };
  const main = await layerFor(W, 0);
  const wide = await layerFor(W + 2 * WIDE, WIDE);
  if (!main || !wide) {
    shared.push({ rule: "placement", pass: false, detail: "the figure falls outside the frame" });
    return done(plan);
  }
  const { vw, vh, vx0, vy0, alpha, binary, inside } = main;

  // Face-box alpha.
  const box = face.box;
  const bx0 = Math.max(0, Math.round(box.x * plan.scale) - vx0);
  const by0 = Math.max(0, Math.round(box.y * plan.scale) - vy0);
  const bx1 = Math.min(vw, Math.round((box.x + box.width) * plan.scale) - vx0);
  const by1 = Math.min(vh, Math.round((box.y + box.height) * plan.scale) - vy0);
  let faceAlphaMin = 1;
  let solid = 0;
  let total = 0;
  for (let y = by0; y < by1; y += 1) {
    for (let x = bx0; x < bx1; x += 1) {
      const v = alpha[y * vw + x]! / 255;
      faceAlphaMin = Math.min(faceAlphaMin, v);
      total += 1;
      if (v >= CUTOUT.faceAlpha) solid += 1;
    }
  }
  figures.faceAlphaMin = faceAlphaMin;
  figures.faceAlphaShare = total ? solid / total : null;
  shared.push({ rule: "faceAlpha", pass: faceAlphaMin >= CUTOUT.faceAlpha, detail: `alpha ${faceAlphaMin.toFixed(2)} at its lowest across the face box (min ${CUTOUT.faceAlpha}); ${total ? ((solid / total) * 100).toFixed(1) : "–"} % of the box at ≥ ${CUTOUT.faceAlpha}` });
  shared.push({ rule: "feather", pass: CUTOUT.featherPx >= CUTOUT.feather.min && CUTOUT.featherPx <= CUTOUT.feather.max, detail: `${CUTOUT.featherPx} px (10–90 %) at output size` });
  // A photo-edge side cut sits flush on the 9:16, but the 1:1 re-sit (0.8×, centred) would put it 108 px inside the square.
  shared.push({
    rule: "square",
    pass: !plan.sideCut,
    detail: plan.sideCut ? `the ${plan.sideCut} cut, flush on the 9:16, would sit 108 px inside the 1:1 as a straight line (O1 re-sits at 0.8×)` : "the 1:1 shows the figure beyond the 9:16's sides from the photo itself",
  });

  // Halo: the colour beside the person in the source, against the band outside the edge on the plain ground.
  const distFig = distanceOutside(Uint8Array.from(binary, (v) => (v > 0 ? 1 : 0)), vw, vh);
  const ring: number[][] = [];
  for (let i = 0; i < vw * vh; i += 3) if (distFig[i]! >= CUTOUT.halo.ringFrom && distFig[i]! <= CUTOUT.halo.ringTo) ring.push(rgbToLab(main.rgb[i * 3]!, main.rgb[i * 3 + 1]!, main.rgb[i * 3 + 2]!));
  const median = (k: number) => {
    const v = ring.map((c) => c[k]!).sort((p, q) => p - q);
    return v.length ? v[Math.floor(v.length / 2)]! : 0;
  };
  const bgLab = [median(0), median(1), median(2)];
  const flat = await sharp({ create: { width: W, height: H, channels: 3, background: hexColour(charcoal) } }).png().toBuffer();
  const onFlat = await sharp(flat).composite([{ input: main.figure, left: main.fx, top: main.fy }]).raw().toBuffer({ resolveWithObject: true });
  const halo = haloShare(onFlat.data, onFlat.info.channels, inside, W, H, bgLab);
  figures.haloShare = halo.share;
  figures.haloBand = halo.band;
  shared.push({ rule: "halo", pass: halo.share <= CUTOUT.halo.maxShare, detail: `${(halo.share * 100).toFixed(2)} % of ${halo.band} band px within ΔE ${CUTOUT.halo.deltaE} of the source background (max ${CUTOUT.halo.maxShare * 100} %)` });
  const sharedPass = shared.every((r) => r.pass) && layoutCheck.insideSafe && layoutCheck.insideTextBox;

  const fgOf = async (layer: Layer, behind: Buffer | null) =>
    sharp({ create: { width: layer.cw, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([...(behind ? [{ input: behind, left: 0, top: 0 }] : []), { input: layer.shadow, left: 0, top: 0 }, { input: layer.figure, left: layer.fx, top: layer.fy }])
      .png()
      .toBuffer();

  /** Compose one variant on its ground: 9:16, 4:5 and the 1:1 re-sit. */
  const compose = async (ground: (size: Size) => Promise<Buffer>, behind: { main: Buffer; wide: Buffer } | null) => {
    const fg = await fgOf(main, behind?.main ?? null);
    const pictured = await sharp(await ground(frame)).composite([{ input: fg, left: 0, top: 0 }]).png().toBuffer();
    const raw = await sharp(pictured).raw().toBuffer({ resolveWithObject: true });
    const contrastShare = lowContrastShare(raw.data, raw.info.width, raw.info.channels, textBoxRect(frame));
    const overlay = await textOverlay(pieces, layout.all, frame, { k: 1, dx: 0, dy: 0 }, KIT_SHADOW);
    const master = await sharp(pictured).composite([{ input: overlay, left: 0, top: 0 }]).png().toBuffer();
    const crop45 = await sharp(master).extract({ left: 0, top: RECT_45.top, width: W, height: RECT_45.bottom - RECT_45.top }).png().toBuffer();
    const side = 1080;
    const k = 0.8;
    const dx = (side - W * k) / 2;
    const fgWide = await fgOf(wide, behind?.wide ?? null);
    const band = await sharp(fgWide).extract({ left: 0, top: RECT_45.top, width: wide.cw, height: RECT_45.bottom - RECT_45.top }).png().toBuffer();
    const band08 = await sharp(band).resize(side, side).png().toBuffer();
    const overlay11 = await textOverlay(pieces, layout.all, { width: side, height: side }, { k, dx, dy: -RECT_45.top * k }, KIT_SHADOW);
    const square = await sharp(await ground({ width: side, height: side }))
      .composite([
        { input: band08, left: 0, top: 0 },
        { input: overlay11, left: 0, top: 0 },
      ])
      .png()
      .toBuffer();
    return { contrastShare, master, crop45, square };
  };

  /** The silhouette on a canvas: the figure's shape scaled 1.18× about its bottom-centre (from the frame), shifted 0.05 W right. */
  const silhouetteOn = async (layer: Layer, about: { x: number; y: number }, opacity: number) => {
    const cw = layer.cw;
    const sil = Buffer.alloc(cw * H);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < cw; x += 1) {
        const src = silhouetteSource(x, y, { x: about.x + layer.ox, y: about.y }, W);
        const sx = Math.round(src.x);
        const sy = Math.round(src.y);
        if (sx >= 0 && sx < cw && sy >= 0 && sy < H && layer.inside[sy * cw + sx]) sil[y * cw + x] = 255;
      }
    }
    const silAlpha = await sharp(sil, { raw: { width: cw, height: H, channels: 1 } }).blur(Math.max(0.3, CUTOUT.silhouette.featherPx / 2.563)).extractChannel(0).raw().toBuffer();
    const paint = await sharp(input.background).resize(cw, H, { fit: "cover", position: "centre" }).removeAlpha().raw().toBuffer();
    return sharp(paint, { raw: { width: cw, height: H, channels: 3 } })
      .joinChannel(Buffer.from(Uint8Array.from(silAlpha, (v) => Math.round(v * opacity))), { raw: { width: cw, height: H, channels: 1 } })
      .png()
      .toBuffer();
  };

  // B1: flat charcoal, the Background layer through the figure's silhouette.
  let b1: CutoutVariant | null = null;
  const b1Rules: CutoutRule[] = [];
  if (plan.fade && edges.bottom) {
    b1Rules.push({ rule: "silhouette", pass: false, detail: "the figure ends on the photo's bottom cut above the frame's bottom; scaled, the silhouette would show that cut as a straight line (the silhouette takes no feather beyond 1 px)" });
    b1 = { variant: "B1", pass: false, rules: b1Rules, contrastShare: 0, silhouetteOpacity: null, master: null, crop45: null, square: null, disclosure: DISCLOSURE_B1 };
  } else if (sharedPass) {
    let minX: number = W;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (inside[y * W + x]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const about = { x: (minX + maxX) / 2, y: Math.min(H, maxY + 1) };
    const groundFlat = async (size: Size) => sharp({ create: { width: size.width, height: size.height, channels: 3, background: hexColour(charcoal) } }).png().toBuffer();
    let last: Awaited<ReturnType<typeof compose>> | null = null;
    let used = 0;
    for (const opacity of CUTOUT.silhouette.opacities) {
      last = await compose(groundFlat, { main: await silhouetteOn(main, about, opacity), wide: await silhouetteOn(wide, about, opacity) });
      used = opacity;
      if (last.contrastShare <= PHOTO_RULES.maxLowContrastShare) break;
    }
    const ok = last!.contrastShare <= PHOTO_RULES.maxLowContrastShare;
    b1Rules.push({ rule: "contrast", pass: ok, detail: `${(last!.contrastShare * 100).toFixed(1)} % of the text box below 3:1 with the silhouette at ${Math.round(used * 100)} % (max ${PHOTO_RULES.maxLowContrastShare * 100} %)` });
    b1 = { variant: "B1", pass: ok, rules: b1Rules, contrastShare: last!.contrastShare, silhouetteOpacity: used, master: ok ? last!.master : null, crop45: ok ? last!.crop45 : null, square: ok ? last!.square : null, disclosure: DISCLOSURE_B1 };
  }

  // B2: the charcoal-to-#1e1e1c gradient.
  let b2: CutoutVariant | null = null;
  if (sharedPass && !b1?.pass) {
    const groundGradient = async (size: Size) => sharp(verticalGradient(size.width, size.height, charcoal, CUTOUT.gradientBottom), { raw: { width: size.width, height: size.height, channels: 3 } }).png().toBuffer();
    const g = await compose(groundGradient, null);
    const ok = g.contrastShare <= PHOTO_RULES.maxLowContrastShare;
    b2 = {
      variant: "B2",
      pass: ok,
      rules: [{ rule: "contrast", pass: ok, detail: `${(g.contrastShare * 100).toFixed(1)} % of the text box below 3:1 (max ${PHOTO_RULES.maxLowContrastShare * 100} %)` }],
      contrastShare: g.contrastShare,
      silhouetteOpacity: null,
      master: ok ? g.master : null,
      crop45: ok ? g.crop45 : null,
      square: ok ? g.square : null,
      disclosure: DISCLOSURE_B2,
    };
  }
  return { plan, shared, sharedPass, figures, charcoal, b1, b2, layout, layoutCheck };
}

function hexColour(h: string): { r: number; g: number; b: number } {
  const [r, g, b] = parseHex(h);
  return { r, g, b };
}
