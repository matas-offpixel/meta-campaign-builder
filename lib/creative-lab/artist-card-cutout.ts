/**
 * Artist card variant B (O21): the artist cut out onto the poster background.
 *
 * Per photo the order is A (the photo as the background, artist-card.ts) if
 * every rule passes, else B if the cut-out passes, else the photo is skipped.
 * Never a scrim.
 *
 * Backdrop: the PSD's own pixels as the designer stacked them — the Background
 * layer (paint texture) scaled to cover the format and centred, never
 * stretched or extended; the flat taped-panel smart object on top, centred,
 * 0.81 W wide, top at 0.17 H, height from its own aspect. The type sits on the
 * panel; the slot table is variant A's.
 *
 * Figure: only the photo's own pixels through the person mask (segment.ts).
 * Nothing generated, inpainted or graded. Bottom-anchored: the person reaches
 * the source's bottom edge and that edge sits on the frame's bottom. The face
 * centre at 0.5 W (0.45–0.55 allowed), the face bands and the 216 px face-box
 * floor as variant A, at most 1.0× source pixels. It may overlap the panel's
 * lower half. O6 shadow once on the figure; no cast shadow, glow or outline.
 *
 * Edge quality (the cut-out is skipped if any fails): alpha ≥ 0.9 across the
 * whole face box; a 1–1.5 px feather at output size; no halo (in a 4 px band
 * outside the alpha edge, ≤ 2 % of pixels within ΔE 10 of the source's own
 * background colour, measured beside the person); and the person never sliced
 * in mid-air by the photo's own edge.
 *
 * Formats: 9:16 master; 4:5 its centre crop; 1:1 the 4:5 arrangement at 0.8×
 * with the Background re-covering the square.
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
import type { PersonMask } from "./segment.ts";

export const CUTOUT = {
  panel: { width: 0.81, top: 0.17 },
  faceCentre: { min: 0.45, max: 0.55 },
  faceAlpha: 0.9,
  /** Target 10–90 % edge width at output size; σ of a blurred step = width / 2.563. */
  featherPx: 1.25,
  feather: { min: 1, max: 1.5 },
  halo: { bandPx: 4, deltaE: 10, maxShare: 0.02, ringFrom: 8, ringTo: 30 },
  /** The person reaches the source's bottom edge: mask pixels on its last row, at least this share of the row. */
  bottomShare: 0.01,
  /** Mask pixels along a photo edge that sits inside the frame before it counts as a slice. */
  sliceMinPixels: 3,
} as const;

export const CUTOUT_DISCLOSURE = "artist cut out onto the poster background";

export type CutoutPlan = {
  scale: number;
  eyes: number;
  headTop: number;
  chin: number;
  faceWidthPx: number;
  /** Face centre on the frame, fraction of W. */
  faceCentreX: number;
  /** The scaled photo's rectangle on the frame (may run past it). */
  rect: { left: number; top: number; width: number; height: number };
};

/**
 * The largest bottom-anchored figure the bands allow: with the photo's bottom
 * on the frame's bottom, the eyes sit at 1 − (photo height − eye y) × s / H,
 * so s = (1 − e) H / (photo height − eye y). Eyes from 0.58 up: the largest
 * face whose head, chin and face box pass. Null with the reason when none.
 */
export function planCutout(photo: Size, face: FaceLines & { box: { width: number; x?: number } }, frame: Size = MASTER): CutoutPlan | { blocker: string } {
  const H = frame.height;
  const f = SLOTS.face;
  const below = photo.height - face.eyeY;
  if (below <= 0) return { blocker: "no photo below the eyes" };
  let best: CutoutPlan | null = null;
  let reason = "";
  for (let e = f.eyesMin; e <= f.eyesMax + 1e-9; e += 0.0005) {
    const s = ((1 - e) * H) / below;
    const headTop = e - ((face.eyeY - face.headTopY) * s) / H;
    const chin = e + ((face.chinY - face.eyeY) * s) / H;
    const faceWidthPx = face.box.width * s;
    if (s > PHOTO_RULES.maxScale + 1e-9) {
      reason ||= `bottom-anchored the photo would need ${s.toFixed(3)}× source (max 1.0×)`;
      continue;
    }
    if (headTop < f.headTopMin - 1e-6) {
      reason ||= `head top ${headTop.toFixed(3)} H above ${f.headTopMin}`;
      continue;
    }
    if (chin > f.chinMax + 1e-6) {
      reason ||= `chin ${chin.toFixed(3)} H below ${f.chinMax}`;
      continue;
    }
    if (faceWidthPx < O20.minFaceWidth * frame.width - 0.5) {
      reason = `face box ${Math.round(faceWidthPx)} px (min ${O20.minFaceWidth * frame.width}) at the largest bottom-anchored size the bands allow`;
      continue;
    }
    const faceCx = (face.box.x ?? face.eyeX - face.box.width / 2) + face.box.width / 2;
    const width = photo.width * s;
    const height = photo.height * s;
    const left = frame.width / 2 - faceCx * s;
    best = { scale: s, eyes: e, headTop, chin, faceWidthPx, faceCentreX: 0.5, rect: { left, top: H - height, width, height } };
    break;
  }
  return best ?? { blocker: reason || "no eye position in 0.58–0.64 H works bottom-anchored" };
}

/** Mask pixels (alpha > 0.5) on the source's last row, as a share of the row. */
export function bottomReach(mask: PersonMask): number {
  let n = 0;
  const row = (mask.height - 1) * mask.width;
  for (let x = 0; x < mask.width; x += 1) if (mask.alpha[row + x]! > 0.5) n += 1;
  return n / mask.width;
}

/** The photo's own edges that sit inside the frame and cut through the person ("sliced in mid-air"). */
export function slicedEdges(mask: PersonMask, rect: CutoutPlan["rect"], frame: Size = MASTER): ("left" | "right" | "top")[] {
  const out: ("left" | "right" | "top")[] = [];
  const count = (pick: (i: number) => number, n: number) => {
    let c = 0;
    for (let i = 0; i < n; i += 1) if (mask.alpha[pick(i)]! > 0.5) c += 1;
    return c;
  };
  if (rect.left > 0.5 && count((y) => y * mask.width, mask.height) >= CUTOUT.sliceMinPixels) out.push("left");
  if (rect.left + rect.width < frame.width - 0.5 && count((y) => y * mask.width + mask.width - 1, mask.height) >= CUTOUT.sliceMinPixels) out.push("right");
  if (rect.top > 0.5 && count((x) => x, mask.width) >= CUTOUT.sliceMinPixels) out.push("top");
  return out;
}

// ─── Colour ─────────────────────────────────────────────────────────────────

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

export function deltaE(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

/** Chamfer distance (in px, ≈ Euclidean) from every pixel to the nearest pixel where `inside` is true. */
export function distanceOutside(inside: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) d[i] = inside[i] ? 0 : INF;
  const a = 1;
  const b = Math.SQRT2;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (x > 0) d[i] = Math.min(d[i]!, d[i - 1]! + a);
      if (y > 0) {
        d[i] = Math.min(d[i]!, d[i - w]! + a);
        if (x > 0) d[i] = Math.min(d[i]!, d[i - w - 1]! + b);
        if (x < w - 1) d[i] = Math.min(d[i]!, d[i - w + 1]! + b);
      }
    }
  }
  for (let y = h - 1; y >= 0; y -= 1) {
    for (let x = w - 1; x >= 0; x -= 1) {
      const i = y * w + x;
      if (x < w - 1) d[i] = Math.min(d[i]!, d[i + 1]! + a);
      if (y < h - 1) {
        d[i] = Math.min(d[i]!, d[i + w]! + a);
        if (x < w - 1) d[i] = Math.min(d[i]!, d[i + w + 1]! + b);
        if (x > 0) d[i] = Math.min(d[i]!, d[i + w - 1]! + b);
      }
    }
  }
  return d;
}

/**
 * The halo share: of the composite's pixels 0 < d ≤ 4 px outside the alpha
 * edge, the share within ΔE 10 of the source's own background colour.
 */
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

// ─── Rendering ──────────────────────────────────────────────────────────────

type Sharp = typeof import("sharp");
async function sharpLib(): Promise<Sharp> {
  const m = await import("sharp");
  return ((m as unknown as { default: Sharp }).default ?? (m as unknown as Sharp)) as Sharp;
}

export type CutoutRule = { rule: "contrast" | "subject" | "eyes" | "placement" | "bottom" | "slice" | "faceAlpha" | "feather" | "halo"; pass: boolean; detail: string };

export type CutoutInput = {
  photo: Buffer;
  mask: PersonMask;
  face: (FaceLines & { box: { x: number; width: number; height: number; y: number } }) | null;
  eyes?: { ok: boolean; why: string };
  subjects: number;
  name: Piece;
  info: Piece[];
  lockup: Piece | null;
  /** The PSD's Background layer and taped-panel layer, as PNG. */
  background: Buffer;
  panel: Buffer;
};

export type CutoutResult = {
  pass: boolean;
  rules: CutoutRule[];
  plan: CutoutPlan | null;
  contrastShare: number;
  figures: { faceAlphaMin: number | null; featherPx: number; haloShare: number | null; haloBand: number; bottomShare: number; sliced: string[]; panelHeight: number };
  layout: TextLayout;
  layoutCheck: LayoutCheck;
  master: Buffer | null;
  crop45: Buffer | null;
  square: Buffer | null;
  disclosure: string;
};

/** The Background layer covering a frame, centred (never stretched). */
async function coverBackground(background: Buffer, size: Size): Promise<Buffer> {
  const sharp = await sharpLib();
  return sharp(background).resize(size.width, size.height, { fit: "cover", position: "centre" }).removeAlpha().png().toBuffer();
}

export async function renderCutout(input: CutoutInput): Promise<CutoutResult> {
  const sharp = await sharpLib();
  const frame = MASTER;
  const W = frame.width;
  const H = frame.height;
  const rules: CutoutRule[] = [];
  const layout = layoutText({ lockup: input.lockup, name: input.name, info: input.info }, frame);
  const layoutCheck = checkLayout(layout, frame);
  const empty = { faceAlphaMin: null, featherPx: CUTOUT.featherPx, haloShare: null, haloBand: 0, bottomShare: bottomReach(input.mask), sliced: [], panelHeight: 0 };
  const fail = (rule: CutoutRule): CutoutResult => ({ pass: false, rules: [...rules, rule], plan: null, contrastShare: 0, figures: empty, layout, layoutCheck, master: null, crop45: null, square: null, disclosure: CUTOUT_DISCLOSURE });

  rules.push({ rule: "subject", pass: input.subjects === 1, detail: `${input.subjects} face${input.subjects === 1 ? "" : "s"}` });
  if (input.eyes) rules.push({ rule: "eyes", pass: input.eyes.ok, detail: input.eyes.ok ? "measurable" : `not measurable: ${input.eyes.why}` });
  if (!input.face) return fail({ rule: "placement", pass: false, detail: "no face found to place" });
  const bottom = bottomReach(input.mask);
  rules.push({ rule: "bottom", pass: bottom >= CUTOUT.bottomShare, detail: `person on ${(bottom * 100).toFixed(1)} % of the photo's bottom row (min ${CUTOUT.bottomShare * 100} %)` });
  if (bottom < CUTOUT.bottomShare) return fail({ rule: "placement", pass: false, detail: "not bottom-anchored: the person does not reach the photo's bottom edge" });

  const rotated = await sharp(input.photo).rotate().removeAlpha().toBuffer();
  const photo = { width: input.mask.width, height: input.mask.height };
  const planned = planCutout(photo, input.face, frame);
  if ("blocker" in planned) return fail({ rule: "placement", pass: false, detail: planned.blocker });
  const plan = planned;
  rules.push({ rule: "placement", pass: true, detail: `head ${plan.headTop.toFixed(3)} · eyes ${plan.eyes.toFixed(3)} · chin ${plan.chin.toFixed(3)} H · face box ${Math.round(plan.faceWidthPx)} px · face centre ${plan.faceCentreX.toFixed(2)} W · ${plan.scale.toFixed(3)}× source` });
  const sliced = slicedEdges(input.mask, plan.rect, frame);
  rules.push({ rule: "slice", pass: sliced.length === 0, detail: sliced.length ? `the photo's ${sliced.join(" and ")} edge cuts the person inside the frame` : "only the frame cuts the person" });

  // The figure at output size, cut to the frame.
  const pw = Math.max(1, Math.round(plan.rect.width));
  const ph = Math.max(1, Math.round(plan.rect.height));
  const left = Math.round(plan.rect.left);
  const top = H - ph;
  const vx0 = Math.max(0, -left);
  const vy0 = Math.max(0, -top);
  const vx1 = Math.min(pw, W - left);
  const vy1 = Math.min(ph, H - top);
  const vw = vx1 - vx0;
  const vh = vy1 - vy0;
  const region = { left: vx0, top: vy0, width: vw, height: vh };
  const figRgb = await sharp(await sharp(rotated).resize(pw, ph, { fit: "fill" }).png().toBuffer()).extract(region).raw().toBuffer();
  const maskPng = await sharp(Buffer.from(Uint8Array.from(input.mask.alpha, (v) => Math.round(v * 255))), { raw: { width: photo.width, height: photo.height, channels: 1 } })
    .resize(pw, ph, { fit: "fill", kernel: "cubic" })
    .extractChannel(0)
    .png()
    .toBuffer();
  const maskOut = await sharp(maskPng).extract(region).extractChannel(0).raw().toBuffer();
  const binary = Buffer.from(Uint8Array.from(maskOut, (v) => (v > 127 ? 255 : 0)));
  const sigma = CUTOUT.featherPx / 2.563;
  const alpha = await sharp(binary, { raw: { width: vw, height: vh, channels: 1 } }).blur(Math.max(0.3, sigma)).extractChannel(0).raw().toBuffer();
  const figure = await sharp(figRgb, { raw: { width: vw, height: vh, channels: 3 } }).joinChannel(alpha, { raw: { width: vw, height: vh, channels: 1 } }).png().toBuffer();
  const fx = left + vx0;
  const fy = top + vy0;

  // Face box alpha.
  const box = input.face.box;
  const bx0 = Math.max(0, Math.round(box.x * plan.scale) - vx0);
  const by0 = Math.max(0, Math.round(box.y * plan.scale) - vy0);
  const bx1 = Math.min(vw, Math.round((box.x + box.width) * plan.scale) - vx0);
  const by1 = Math.min(vh, Math.round((box.y + box.height) * plan.scale) - vy0);
  let faceAlphaMin = 1;
  for (let y = by0; y < by1; y += 1) for (let x = bx0; x < bx1; x += 1) faceAlphaMin = Math.min(faceAlphaMin, alpha[y * vw + x]! / 255);
  rules.push({ rule: "faceAlpha", pass: faceAlphaMin >= CUTOUT.faceAlpha, detail: `alpha ${faceAlphaMin.toFixed(2)} at its lowest across the face box (min ${CUTOUT.faceAlpha})` });
  rules.push({ rule: "feather", pass: CUTOUT.featherPx >= CUTOUT.feather.min && CUTOUT.featherPx <= CUTOUT.feather.max, detail: `${CUTOUT.featherPx} px (10–90 %) at output size` });

  // Backdrop: Background, panel.
  const bg = await coverBackground(input.background, frame);
  const panelMeta = await sharp(input.panel).metadata();
  const panelW = Math.round(CUTOUT.panel.width * W);
  const panelH = Math.round((panelW * (panelMeta.height ?? 1)) / (panelMeta.width ?? 1));
  const panel = await sharp(input.panel).resize(panelW, panelH, { fit: "fill" }).png().toBuffer();
  const panelTop = Math.round(CUTOUT.panel.top * H);
  const panelLeft = Math.round((W - panelW) / 2);

  // Halo: figure over the backdrop, no shadow, against the colour beside the person in the source.
  const backdrop = await sharp(bg).composite([{ input: panel, left: panelLeft, top: panelTop }]).png().toBuffer();
  const plain = await sharp(backdrop).composite([{ input: figure, left: fx, top: fy }]).raw().toBuffer({ resolveWithObject: true });
  const inside = new Uint8Array(W * H);
  for (let y = 0; y < vh; y += 1) for (let x = 0; x < vw; x += 1) if (binary[y * vw + x]! > 0) inside[(y + fy) * W + (x + fx)] = 1;
  const distFig = distanceOutside(Uint8Array.from(binary, (v) => (v > 0 ? 1 : 0)), vw, vh);
  const ringLab: number[][] = [];
  for (let i = 0; i < vw * vh; i += 3) {
    if (distFig[i]! >= CUTOUT.halo.ringFrom && distFig[i]! <= CUTOUT.halo.ringTo) ringLab.push(rgbToLab(figRgb[i * 3]!, figRgb[i * 3 + 1]!, figRgb[i * 3 + 2]!));
  }
  const median = (k: number) => {
    const v = ringLab.map((c) => c[k]!).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)]! : 0;
  };
  const bgLab = [median(0), median(1), median(2)];
  const halo = haloShare(plain.data, plain.info.channels, inside, W, H, bgLab);
  rules.push({ rule: "halo", pass: halo.share <= CUTOUT.halo.maxShare, detail: `${(halo.share * 100).toFixed(2)} % of ${halo.band} band px within ΔE ${CUTOUT.halo.deltaE} of the source background (max ${CUTOUT.halo.maxShare * 100} %)` });

  // Figure shadow (O6), then the figure.
  const shadowAlpha = Buffer.from(Uint8Array.from(alpha, (v) => Math.round(v * KIT_SHADOW.opacity)));
  const blurPx = KIT_SHADOW.blur * W;
  const pad = Math.ceil(blurPx * 3);
  const shadowRaw = await sharp(Buffer.alloc(vw * vh * 3), { raw: { width: vw, height: vh, channels: 3 } })
    .joinChannel(shadowAlpha, { raw: { width: vw, height: vh, channels: 1 } })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .blur(Math.max(0.3, blurPx / 2))
    .png()
    .toBuffer();
  const fgLayer = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: panel, left: panelLeft, top: panelTop },
      { input: shadowRaw, left: fx - pad, top: fy - pad + Math.round(KIT_SHADOW.dy * W) },
      { input: figure, left: fx, top: fy },
    ])
    .png()
    .toBuffer();
  const pictured = await sharp(bg).composite([{ input: fgLayer, left: 0, top: 0 }]).png().toBuffer();
  const raw = await sharp(pictured).raw().toBuffer({ resolveWithObject: true });
  const contrastShare = lowContrastShare(raw.data, raw.info.width, raw.info.channels, textBoxRect(frame));
  rules.unshift({ rule: "contrast", pass: contrastShare <= PHOTO_RULES.maxLowContrastShare, detail: `${(contrastShare * 100).toFixed(1)} % of the text box below 3:1 (max ${PHOTO_RULES.maxLowContrastShare * 100} %)` });

  const pieces = [...(input.lockup ? [input.lockup] : []), input.name, ...input.info];
  const overlay = await textOverlay(pieces, layout.all, frame, { k: 1, dx: 0, dy: 0 }, KIT_SHADOW);
  const master = await sharp(pictured).composite([{ input: overlay, left: 0, top: 0 }]).png().toBuffer();
  const crop45 = await sharp(master).extract({ left: 0, top: RECT_45.top, width: W, height: RECT_45.bottom - RECT_45.top }).png().toBuffer();

  // 1:1: the Background re-covers the square; the 4:5 arrangement at 0.8×, centred.
  const side = 1080;
  const k = 0.8;
  const dx = (side - W * k) / 2;
  const bg11 = await coverBackground(input.background, { width: side, height: side });
  const band = await sharp(fgLayer).extract({ left: 0, top: RECT_45.top, width: W, height: RECT_45.bottom - RECT_45.top }).png().toBuffer();
  const band08 = await sharp(band).resize(Math.round(W * k), side).png().toBuffer();
  const overlay11 = await textOverlay(pieces, layout.all, { width: side, height: side }, { k, dx, dy: -RECT_45.top * k }, KIT_SHADOW);
  const square = await sharp(bg11)
    .composite([
      { input: band08, left: Math.round(dx), top: 0 },
      { input: overlay11, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();

  const pass = rules.every((r) => r.pass) && layoutCheck.insideSafe && layoutCheck.insideTextBox;
  return {
    pass,
    rules,
    plan,
    contrastShare,
    figures: { faceAlphaMin, featherPx: CUTOUT.featherPx, haloShare: halo.share, haloBand: halo.band, bottomShare: bottom, sliced, panelHeight: panelH },
    layout,
    layoutCheck,
    master,
    crop45,
    square,
    disclosure: CUTOUT_DISCLOSURE,
  };
}

/** O21's order: A when every rule passes, else B when the cut-out passes, else skip. */
export function chooseVariant(a: { pass: boolean }, b: { pass: boolean } | null): "A" | "B" | "skip" {
  if (a.pass) return "A";
  if (b?.pass) return "B";
  return "skip";
}
