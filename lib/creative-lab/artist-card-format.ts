/**
 * The artist card's 4:5 and 1:1, each placed on its own (overlay-templates
 * issue 17: O117–O119, H107–H109). The 9:16 is untouched (artist-card.ts
 * renderCard, artist-card-claim.ts renderClaimCard); both call this for the
 * other two formats from the same photo and pieces.
 *
 *   face    eyes at 0.50 W (± 0.01) and 0.43 H (4:5) / 0.445 H (1:1), head top
 *           ≥ 0.27 / 0.29 H, chin ≤ 0.60 H. The photo is at the 9:16 card's
 *           scale (the 1:1 at O1's 0.8× of it), scaled down only for the face
 *           limits, never below cover, never above 1.0× source.
 *   data    lockup and name above the head; the info lines from 0.03 H under
 *           the chin, never above 0.62 H; the claim's last baseline on 1274 /
 *           1004 px, at least 0.02 H under the info (else O23's steps).
 *   clear   no text pixel inside the face box (head top to chin, ear to ear)
 *           grown 0.02 H on every side; a format that fails isn't made.
 *   bands   O25's top band to 0.30 H, the bottom band from 0.62 H.
 *   photo   to centre the eyes the photo may be extended at either side by
 *           up to 0.12 W under O20's strip tests; never at the bottom (O119).
 *
 * No `@/` imports (node --test).
 */

import {
  FORMAT_FRAME,
  FORMAT_RULES,
  FORMAT_SLOTS,
  INSET,
  O20,
  PHOTO_RULES,
  extendCanvas,
  extensionLabel,
  lowContrastShare,
  pieceScale,
  stripColourTests,
  stripLuminance,
  stripStats,
  textOverlay,
  type CardFrameFormat,
  type Extension,
  type FaceLines,
  type Piece,
  type Placement,
  type Rect,
  type Size,
  type StripStats,
} from "./artist-card.ts";
import { CARD_CLAIM, type CardClaimPlan } from "./claim-slot.ts";
import { J2_FALL, renderGradientShadow, type GradientShadow } from "./overlay-gradient.ts";
import { maskTouches, type PersonMask } from "./segment.ts";
import type { BackingBox } from "./t1-video.ts";

export type { CardFrameFormat };

// ─── Strings (O119, exact) ──────────────────────────────────────────────────

export const formatName = (f: CardFrameFormat): string => f;

/** O119: the eyes can't reach 0.50 W ± 0.01; the card is still made. */
export const offCentreLine = (px: number, side: "left" | "right"): string => `Framed ${px} px off centre: the photo ends at the ${side}`;

/** O119: the photo ends too close under the chin to lift the eyes into the band; that format is skipped. */
export const faceTooLowLine = (format: CardFrameFormat, px: number): string => `Face too low for ${formatName(format)}: the photo ends ${px} px below the chin`;

// ─── Bands (O118: O25 on these two formats) ─────────────────────────────────

/**
 * O25's bands on the 4:5 and the 1:1 (O118): the top band 20 % from the edge,
 * gone at 0.30 H (J2's fade over the last 0.05 H); the bottom band 20 % from
 * 0.62 H (was 0.70), J2's fade upward over 0.06 H as O25's, rising evenly to
 * 30 % at 0.70 H and 30 % to the edge (O25's 0.08 H ramp, moved up with it).
 */
export const FORMAT_BANDS: GradientShadow = {
  blendMode: "normal",
  bands: [
    { edge: "top", plateau: 0.25, extent: 0.3, opacity: 0.2, color: "#000000", knots: J2_FALL },
    { edge: "bottom", plateau: 0.38, extent: 0.44, opacity: 0.2, color: "#000000", knots: J2_FALL, ramp: { opacity: 0.3, at: 0.3 } },
  ],
};

// ─── Photo placement (pure) ─────────────────────────────────────────────────

export type FormatFace = FaceLines & { box: { x: number; y: number; width: number; height: number } };

export type FormatPhotoPlan = {
  format: CardFrameFormat;
  /** Output px per source px. */
  scale: number;
  /** Frame top in scaled-photo px (no top extension on these formats). */
  top: number;
  /** Frame left in scaled-photo px before any side extension; may be negative or past the photo. */
  wantLeft: number;
  /** Positions as fractions of the format's H. */
  eyes: number;
  headTop: number;
  chin: number;
  /** The extension the eyes need at each side, output px (0 when the photo reaches). */
  need: { left: number; right: number };
  /** The format is skipped: why (an O119 line when the photo ends under the chin). */
  skip: string | null;
};

/**
 * O117 / O119 placement for one format: the scale (the 9:16's × photoK,
 * capped by the face limits at the target eyes and by 1.0×, floored at
 * cover), the eyes on the target height unless the photo ends first, and the
 * horizontal centre the eyes want. Side extension is decided on the pixels
 * (renderFormatCard).
 */
export function planFormatPhoto(photo: Size, face: FaceLines, format: CardFrameFormat, masterScale: number): FormatPhotoPlan {
  const fr = FORMAT_FRAME[format];
  const sl = FORMAT_SLOTS[format].face;
  const H = fr.height;
  const a = Math.max(1, face.eyeY - face.headTopY);
  const b = Math.max(1, face.chinY - face.eyeY);
  const cover = Math.max(fr.width / photo.width, fr.height / photo.height);
  let scale = Math.min(masterScale * FORMAT_SLOTS[format].photoK, PHOTO_RULES.maxScale, ((sl.eyes - sl.headTopMin) * H) / a, ((sl.chinMax - sl.eyes) * H) / b);
  scale = Math.max(scale, cover);
  const wantTop = face.eyeY * scale - sl.eyes * H;
  const maxTop = photo.height * scale - H;
  const top = Math.min(Math.max(0, wantTop), maxTop);
  const at = (y: number) => (y * scale - top) / H;
  const eyes = at(face.eyeY);
  const headTop = at(face.headTopY);
  const chin = at(face.chinY);
  const wantLeft = face.eyeX * scale - 0.5 * fr.width;
  const need = { left: Math.max(0, Math.ceil(-wantLeft)), right: Math.max(0, Math.ceil(wantLeft - (photo.width * scale - fr.width))) };
  const tol = 1e-3;
  const inBand = eyes >= sl.eyesMin - tol && eyes <= sl.eyesMax + tol && headTop >= sl.headTopMin - tol && chin <= sl.chinMax + tol;
  let skip: string | null = null;
  if (!inBand) {
    if (wantTop > maxTop + 0.5 && (eyes > sl.eyesMax + tol || chin > sl.chinMax + tol)) skip = faceTooLowLine(format, Math.max(0, Math.round((photo.height - face.chinY) * scale)));
    else skip = `head ${headTop.toFixed(3)} · eyes ${eyes.toFixed(3)} · chin ${chin.toFixed(3)} H outside ${format}'s face limits (head ≥ ${sl.headTopMin}, eyes ${sl.eyesMin}–${sl.eyesMax}, chin ≤ ${sl.chinMax})`;
  }
  return { format, scale, top, wantLeft, eyes, headTop, chin, need, skip };
}

/**
 * The frame's left edge on the extended canvas and where the eyes land, for a
 * side extension (output px, each ≤ 0.12 W). The canvas is the scaled photo
 * with `ext.left` px added at its left.
 */
export function frameLeft(plan: FormatPhotoPlan, photoWidthPx: number, ext: Extension, faceEyeX: number): { left: number; eyeAt: number; off: number; side: "left" | "right" | null } {
  const W = FORMAT_FRAME[plan.format].width;
  const canvasW = ext.left + photoWidthPx + ext.right;
  const left = Math.min(Math.max(0, plan.wantLeft + ext.left), canvasW - W);
  const eyeAt = faceEyeX * plan.scale + ext.left - left;
  const off = eyeAt - W / 2;
  const side = Math.abs(off) > FORMAT_RULES.centreTolerance * W + 1e-9 ? (off < 0 ? "left" : "right") : null;
  return { left, eyeAt, off, side };
}

// ─── Text (pure) ────────────────────────────────────────────────────────────

export type FormatLayout = { lockup: Placement | null; name: Placement; info: Placement[]; all: Placement[]; infoTop: number | null; infoBottom: number | null };

const centredAt = (piece: Pick<Piece, "width" | "height" | "label">, scale: number, top: number, W: number, flags: Pick<Placement, "short" | "stepped" | "belowFloor">): Placement => {
  const width = Math.round(piece.width * scale);
  const height = Math.round(piece.height * scale);
  return { label: piece.label, left: Math.round((W - width) / 2), top: Math.round(top), width, height, scale, ...flags };
};

/** O118's slot table: lockup and name above the head, the info lines from under the chin (`chin` as a fraction of H). */
export function layoutFormatText(input: { lockup: Piece | null; name: Piece; info: readonly Piece[] }, format: CardFrameFormat, chin: number): FormatLayout {
  const fr = FORMAT_FRAME[format];
  const sl = FORMAT_SLOTS[format];
  let y: number = sl.lockup.top;
  let lockup: Placement | null = null;
  if (input.lockup) {
    const want = (sl.lockup.width * fr.width) / input.lockup.width;
    lockup = centredAt(input.lockup, Math.min(want, 1), y, fr.width, { short: want > 1.0001, stepped: false, belowFloor: false });
    y = lockup.top + lockup.height + sl.name.gapAbove;
  }
  const nameFit = pieceScale(input.name, sl.name, fr);
  const name = centredAt(input.name, nameFit.scale, y, fr.width, nameFit);
  const info: Placement[] = [];
  let infoTop: number | null = null;
  let infoBottom: number | null = null;
  if (input.info.length) {
    const capPx = Math.max(...input.info.map((l) => l.capPx));
    const widest = Math.max(...input.info.map((l) => l.width));
    const fit = pieceScale({ width: widest, capPx }, sl.info, fr);
    const pitch = sl.info.pitch * fr.height * (fit.stepped || fit.short ? (capPx * fit.scale) / (sl.info.cap * fr.height) : 1);
    const first = Math.max(chin + sl.info.underChin, sl.info.floor) * fr.height;
    input.info.forEach((line, i) => {
      const p = centredAt(line, fit.scale, 0, fr.width, fit);
      const capTop = first + pitch * i;
      info.push({ ...p, top: Math.round(capTop + capPx * fit.scale - p.height) });
    });
    infoTop = first;
    infoBottom = first + pitch * (input.info.length - 1) + capPx * fit.scale;
  }
  const all = [lockup, name, ...info].filter((p): p is Placement => p != null);
  return { lockup, name, info, all, infoTop, infoBottom };
}

/** O23's floor for a claim kind, as a share of its base caps (the same floors planCardClaim steps to). */
export function claimFloorK(kind: CardClaimPlan["kind"]): number {
  if (kind === "two-line") return CARD_CLAIM.twoLine.line1Floor / CARD_CLAIM.twoLine.line1Cap;
  if (kind === "final-tickets") return CARD_CLAIM.oneLine.floor / CARD_CLAIM.oneLine.redCap;
  return CARD_CLAIM.oneLine.floor / CARD_CLAIM.oneLine.whiteCap;
}

export type Transform = { k: number; dx: number; dy: number };

/**
 * The 9:16 claim plan carried into a format: scaled by the format's k and
 * bottom-anchored on its baseline; when its top would sit less than 0.02 H
 * under the info, stepped down about that baseline (O23's steps) to the
 * kind's floor, past which the format can't take the claim.
 */
export function claimTransform(plan: CardClaimPlan, format: CardFrameFormat, infoBottom: number | null): { t: Transform; stepped: number } | { held: string } {
  const fr = FORMAT_FRAME[format];
  const sl = FORMAT_SLOTS[format].claim;
  const centreX = fr.width / 2;
  // The 9:16's lines are centred on its 540 px; they stay centred in the format.
  const make = (k: number): Transform => ({ k, dx: centreX - 540 * k, dy: sl.bottom - plan.bottom * k });
  let k = sl.k;
  const topAt = (kk: number) => sl.bottom - (plan.bottom - plan.blockTop) * kk;
  const limit = infoBottom == null ? -Infinity : infoBottom + FORMAT_RULES.claimGap * fr.height;
  let stepped = 1;
  if (topAt(k) < limit - 0.5) {
    stepped = (sl.bottom - limit) / (sl.bottom - topAt(k));
    if (!(stepped > 0) || plan.k * stepped < claimFloorK(plan.kind) - 1e-9) return { held: CARD_CLAIM.tooLong };
    k *= stepped;
  }
  return { t: make(k), stepped };
}

export const moveRect = (r: Rect, t: Transform): Rect => ({ left: r.left * t.k + t.dx, top: r.top * t.k + t.dy, width: r.width * t.k, height: r.height * t.k });

/** O118: the face box (head top to chin, ear to ear) on the format's frame, grown 0.02 H on every side. */
export function faceClearZone(face: FormatFace, scale: number, frame: { left: number; top: number; extLeft: number }, format: CardFrameFormat): Rect {
  const g = FORMAT_RULES.faceClear * FORMAT_FRAME[format].height;
  const left = face.box.x * scale + frame.extLeft - frame.left - g;
  const right = (face.box.x + face.box.width) * scale + frame.extLeft - frame.left + g;
  const top = face.headTopY * scale - frame.top - g;
  const bottom = face.chinY * scale - frame.top + g;
  return { left, top, width: right - left, height: bottom - top };
}

const overlap = (a: Rect, b: Rect): Rect | null => {
  const l = Math.max(a.left, b.left);
  const t = Math.max(a.top, b.top);
  const r = Math.min(a.left + a.width, b.left + b.width);
  const btm = Math.min(a.top + a.height, b.top + b.height);
  return r > l && btm > t ? { left: l, top: t, width: r - l, height: btm - t } : null;
};

// ─── Compose (sharp) ────────────────────────────────────────────────────────

type Sharp = typeof import("sharp");
let sharpModule: Promise<Sharp> | null = null;
async function sharpLib(): Promise<Sharp> {
  sharpModule ??= import("sharp").then((m) => (m as unknown as { default: Sharp }).default ?? (m as unknown as Sharp));
  return sharpModule;
}

/** Text pixels (alpha > 8) of placed pieces inside a rectangle, counted on each piece as drawn. */
export async function inkInRect(pieces: readonly Piece[], placements: readonly Placement[], rect: Rect): Promise<{ count: number; labels: string[] }> {
  const sharp = await sharpLib();
  let count = 0;
  const labels: string[] = [];
  for (let i = 0; i < pieces.length; i += 1) {
    const at = placements[i]!;
    const hit = overlap(at, rect);
    if (!hit) continue;
    const w = Math.max(1, Math.round(at.width));
    const h = Math.max(1, Math.round(at.height));
    const { data } = await sharp(pieces[i]!.png).resize(w, h, { kernel: "lanczos3", fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let n = 0;
    for (let y = Math.max(0, Math.floor(hit.top - at.top)); y < Math.min(h, Math.ceil(hit.top + hit.height - at.top)); y += 1) {
      for (let x = Math.max(0, Math.floor(hit.left - at.left)); x < Math.min(w, Math.ceil(hit.left + hit.width - at.left)); x += 1) if (data[(y * w + x) * 4 + 3]! > 8) n += 1;
    }
    if (n) {
      count += n;
      labels.push(at.label);
    }
  }
  return { count, labels };
}

export type FormatClaim = {
  plan: CardClaimPlan;
  /** The claim's pieces as placed on the 9:16 (artist-card-claim.ts). */
  pieces: { piece: Piece; at: Placement }[];
  /** O58's backing under the red line, on the 9:16. */
  backing: { box: BackingBox; opacity: number } | null;
};

export type FormatCardInput = {
  /** The photo, EXIF rotation applied. */
  rotated: Buffer;
  photo: Size;
  face: FormatFace;
  format: CardFrameFormat;
  /** The 9:16 card's photo scale (output px per source px). */
  masterScale: number;
  /** Without it no side extension is tried (O20's mask test can't run). */
  mask?: PersonMask;
  lockup: Piece | null;
  name: Piece;
  info: Piece[];
  claim: FormatClaim | null;
  /** O25's bands on (FORMAT_BANDS). */
  bands: boolean;
  shadow: { dy: number; blur: number; opacity: number };
  /** Draws the O58 backing layer for a box and opacity at a size (red-backing.ts), when the claim has one. */
  backingLayer?: (size: Size, box: BackingBox, opacity: number) => Promise<Buffer>;
  /** Draws the draft watermark at a size, clear of the type (artist-card-claim.ts watermarkLayer). */
  watermark?: (size: Size, avoid: readonly Rect[]) => Promise<Buffer | null>;
};

export type FormatRule = { rule: string; pass: boolean; detail: string };

export type FormatCardResult = {
  format: CardFrameFormat;
  /** The format was made (face in its band, no text on the face). */
  made: boolean;
  png: Buffer | null;
  /** Why it wasn't made. */
  skipped: string | null;
  /** O119's report lines (the extension, the off-centre line), then where the eyes landed. */
  notes: string[];
  rules: FormatRule[];
  pass: boolean;
  plan: FormatPhotoPlan;
  extend: Extension;
  /** The eyes' midpoint as a fraction of W. */
  eyeX: number;
  faceZone: Rect | null;
  placements: Placement[];
  claimRect: Rect | null;
  contrast: { top: number; info: number | null; claim: number | null };
};

const NO_EXT: Extension = { top: 0, left: 0, right: 0 };

/** One format, placed on its own (O117–O119). */
export async function renderFormatCard(input: FormatCardInput): Promise<FormatCardResult> {
  const sharp = await sharpLib();
  const fr = FORMAT_FRAME[input.format];
  const plan = planFormatPhoto(input.photo, input.face, input.format, input.masterScale);
  const rules: FormatRule[] = [];
  const notes: string[] = [];
  const base: FormatCardResult = { format: input.format, made: false, png: null, skipped: plan.skip, notes, rules, pass: false, plan, extend: NO_EXT, eyeX: 0.5, faceZone: null, placements: [], claimRect: null, contrast: { top: 0, info: null, claim: null } };
  if (plan.skip) return base;

  // O119: the sides, under O20's strip tests, when the eyes need them.
  const photoW = Math.max(1, Math.round(input.photo.width * plan.scale));
  const photoH = Math.max(1, Math.round(input.photo.height * plan.scale));
  const maxSide = Math.round(FORMAT_RULES.maxSide * fr.width);
  const strips: Partial<Record<"left" | "right", StripStats>> = {};
  const ext: Extension = { top: 0, left: 0, right: 0 };
  for (const edge of ["left", "right"] as const) {
    const need = plan.need[edge];
    if (need <= 0 || !input.mask) continue;
    const c = { scale: plan.scale, left: 0, top: plan.top, extend: { top: 0, left: edge === "left" ? need : 0, right: edge === "right" ? need : 0 } };
    const strip = await stripLuminance(input.rotated, input.photo, c, edge, fr);
    if (!strip) continue;
    const st = stripStats(strip.lum, strip.w, strip.h);
    const maskPixels = maskTouches(input.mask, strip.source, O20.maskThreshold);
    const colour = stripColourTests(strip.rgb, strip.length, strip.depth);
    const full: StripStats = { ...st, maskPixels, columnMaxDeltaE: colour.columnMaxDeltaE, driftP95: colour.driftP95, pass: st.pass && maskPixels === 0 && colour.passColumn && colour.passDrift };
    if (!full.pass) continue;
    strips[edge] = full;
    ext[edge] = Math.min(need, maxSide);
  }
  const at = frameLeft(plan, photoW, ext, input.face.eyeX);
  base.extend = ext;
  base.eyeX = at.eyeAt / fr.width;
  const label = extensionLabel(ext);
  if (label) notes.push(label);
  // Eyes left of centre: the photo's left edge stopped the frame (and the reverse).
  if (at.side) notes.push(offCentreLine(Math.round(Math.abs(at.off)), at.side));

  // The photo layer.
  const scaledRaw = await sharp(input.rotated).resize(photoW, photoH).removeAlpha().raw().toBuffer();
  const canvas = ext.left + ext.right > 0 ? extendCanvas(scaledRaw, photoW, photoH, ext, { top: 0, left: strips.left?.detailStdev ?? 0, right: strips.right?.detailStdev ?? 0 }) : { data: scaledRaw, width: photoW, height: photoH };
  const photoLayer = await sharp(canvas.data, { raw: { width: canvas.width, height: canvas.height, channels: 3 } })
    .extract({ left: Math.round(at.left), top: Math.round(Math.min(plan.top, canvas.height - fr.height)), width: fr.width, height: fr.height })
    .png()
    .toBuffer();
  const bandLayer = input.bands ? await sharp(Buffer.from(renderGradientShadow(FORMAT_BANDS, fr.width, fr.height)), { raw: { width: fr.width, height: fr.height, channels: 4 } }).png().toBuffer() : null;
  const shown = bandLayer ? await sharp(photoLayer).composite([{ input: bandLayer, left: 0, top: 0 }]).png().toBuffer() : photoLayer;
  const raw = await sharp(shown).removeAlpha().raw().toBuffer({ resolveWithObject: true });

  // Type.
  const layout = layoutFormatText({ lockup: input.lockup, name: input.name, info: input.info }, input.format, plan.chin);
  const topPieces = [...(input.lockup ? [input.lockup] : []), input.name, ...input.info];
  let claimPlacements: Placement[] = [];
  let claimRect: Rect | null = null;
  let claimT: Transform | null = null;
  if (input.claim) {
    const ct = claimTransform(input.claim.plan, input.format, layout.infoBottom);
    if ("held" in ct) return { ...base, skipped: ct.held };
    claimT = ct.t;
    if (ct.stepped < 1) notes.push(`claim stepped to ${(input.claim.plan.k * ct.stepped).toFixed(3)} to keep 0.02 H under the info`);
    claimPlacements = input.claim.pieces.map(({ at: p }) => ({ ...p, ...moveRect(p, ct.t), scale: p.scale * ct.t.k }));
    const l = CARD_CLAIM.box.left * fr.width;
    const topY = input.claim.plan.blockTop * ct.t.k + ct.t.dy;
    claimRect = { left: l, top: topY, width: CARD_CLAIM.box.right * fr.width - l, height: FORMAT_SLOTS[input.format].claim.bottom - topY };
  }
  const pieces = [...topPieces, ...(input.claim?.pieces.map((c) => c.piece) ?? [])];
  const placements = [...layout.all, ...claimPlacements];
  base.placements = placements;
  base.claimRect = claimRect;

  // O118: nothing covers the face.
  const zone = faceClearZone(input.face, plan.scale, { left: at.left, top: plan.top, extLeft: ext.left }, input.format);
  base.faceZone = zone;
  const ink = await inkInRect(pieces, placements, zone);
  if (ink.count > 0) return { ...base, skipped: `text inside the face box (+0.02 H): ${ink.labels.join(", ")} (${ink.count} px)` };

  // O19 on both text zones, with the bands on (what ships).
  const topBlock = layout.lockup ? { top: layout.lockup.top, bottom: layout.name.top + layout.name.height } : { top: layout.name.top, bottom: layout.name.top + layout.name.height };
  const topShare = lowContrastShare(raw.data, raw.info.width, raw.info.channels, { left: INSET, top: topBlock.top, width: fr.width - 2 * INSET, height: topBlock.bottom - topBlock.top });
  base.contrast.top = topShare;
  rules.push({ rule: "contrast", pass: topShare <= PHOTO_RULES.maxLowContrastShare, detail: `${(topShare * 100).toFixed(1)} % of the lockup and name zone below 3:1, bands ${input.bands ? "on" : "off"} (max 10 %)` });
  if (layout.infoTop != null && layout.infoBottom != null) {
    const infoShare = lowContrastShare(raw.data, raw.info.width, raw.info.channels, { left: INSET, top: layout.infoTop, width: fr.width - 2 * INSET, height: layout.infoBottom - layout.infoTop });
    base.contrast.info = infoShare;
    rules.push({ rule: "infoContrast", pass: infoShare <= PHOTO_RULES.maxLowContrastShare, detail: `${(infoShare * 100).toFixed(1)} % of the info zone below 3:1 (max 10 %)` });
  }
  if (claimRect) {
    const claimShare = lowContrastShare(raw.data, raw.info.width, raw.info.channels, claimRect);
    base.contrast.claim = claimShare;
    rules.push({ rule: "claimContrast", pass: claimShare <= CARD_CLAIM.claimBoxMax, detail: `${(claimShare * 100).toFixed(1)} % of the claim box below 3:1 (max ${CARD_CLAIM.claimBoxMax * 100} %)` });
  }
  // O19's face-width floor is judged on the card (the 9:16), as before: the 1:1 has always carried O1's 0.8× face.
  notes.push(`eyes ${(at.eyeAt / fr.width).toFixed(3)} W · ${plan.eyes.toFixed(3)} H · face box ${Math.round(input.face.box.width * plan.scale)} px`);

  // Compose: photo, bands, O58 backing, type under one shadow, watermark.
  const overlay = await textOverlay(pieces, placements, fr, { k: 1, dx: 0, dy: 0 }, input.shadow);
  const backing = input.claim?.backing && claimT && input.backingLayer ? await input.backingLayer(fr, moveBacking(input.claim.backing.box, claimT), input.claim.backing.opacity) : null;
  const wm = input.watermark ? await input.watermark(fr, placements) : null;
  const png = await sharp(shown)
    .composite([...(backing ? [{ input: backing, left: 0, top: 0 }] : []), { input: overlay, left: 0, top: 0 }, ...(wm ? [{ input: wm, left: 0, top: 0 }] : [])])
    .png()
    .toBuffer();
  return { ...base, made: true, png, pass: rules.every((r) => r.pass), skipped: null };
}

export function moveBacking(b: BackingBox, t: Transform): BackingBox {
  return { rect: moveRect(b.rect, t), feather: { left: b.feather.left * t.k, right: b.feather.right * t.k, top: b.feather.top * t.k, bottom: b.feather.bottom * t.k } };
}
