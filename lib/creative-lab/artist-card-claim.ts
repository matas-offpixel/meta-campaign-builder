/**
 * The artist card with its claim (overlay-templates issue 3: O23 claim slot,
 * O25 gradient bands, O19 as amended). A separate composer from
 * artist-card.ts's renderCard, which stays as O18 drew it: the face band's
 * chin moves to 0.72 H here, the photo gate runs with the bands on, and the
 * claim joins the text group under one O6 shadow.
 *
 * Kept in its own file while cursor/artist-card-lab (#1153) has artist-card.ts
 * open (CLAUDE.md rule 3). The band-aware placement below mirrors
 * planFaceCrop / extensionCandidates / judgePhoto with the chin as a
 * parameter; fold it back into artist-card.ts once #1153 has merged.
 *
 * Every text pixel is the kit's own face, read in place from the font index;
 * a missing or trial face holds the card. A card without an approved claim
 * carries its watermark and can't be filed or exported (claim-approval.ts).
 */

import {
  KIT_SHADOW,
  MASTER,
  O20,
  PHOTO_RULES,
  PLAIN_EDGE_STDEV,
  RECT_45,
  SLOTS,
  extendCanvas,
  extensionLabel,
  layoutText,
  lowContrastShare,
  measureHeadTop,
  planFaceCrop,
  relativeLuminance,
  seamP95,
  stripColourTests,
  stripStats,
  textBoxRect,
  textOverlay,
  type CropPlan,
  type Edge,
  type Extension,
  type FaceBand,
  type FaceLines,
  type Piece,
  type Placement,
  type Rect,
  type Size,
  type StripStats,
} from "./artist-card.ts";
import { CARD_CLAIM, KIT_RED, KIT_WHITE, inKitCase, isRollCall, planCardClaim, renderCardLine, rollCallStates, type CardClaimPlan } from "./claim-slot.ts";
import { requireFont, type FontEntry } from "./kit-font.ts";
import { renderGradientShadow, type GradientShadow } from "./overlay-gradient.ts";
import { maskTouches, type PersonMask } from "./segment.ts";

export const CLAIM_FACE_BAND: FaceBand = { ...SLOTS.face, chinMax: CARD_CLAIM.chinMax };

// ─── Contrast (O19 amended) ─────────────────────────────────────────────────

/** WCAG contrast ratio of two relative luminances. */
export function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const RED_LUMINANCE = relativeLuminance(0xfe, 0x32, 0x32);

/** The claim box: 0.07–0.93 W, from the claim's cap top to 0.812 H. */
export function claimBoxRect(blockTop: number, frame: Size = MASTER): Rect {
  const left = CARD_CLAIM.box.left * frame.width;
  return { left, top: blockTop, width: CARD_CLAIM.box.right * frame.width - left, height: CARD_CLAIM.bottom - blockTop };
}

/** Share of a region's pixels below `minRatio`:1 against a luminance (the kit red's, for the red line). */
export function lowContrastAgainst(data: Uint8Array | Buffer, width: number, channels: number, rect: Rect, againstLuminance: number, minRatio: number): number {
  let low = 0;
  let total = 0;
  for (let y = Math.max(0, Math.round(rect.top)); y < Math.round(rect.top + rect.height); y += 1) {
    for (let x = Math.max(0, Math.round(rect.left)); x < Math.min(width, Math.round(rect.left + rect.width)); x += 1) {
      const i = (y * width + x) * channels;
      total += 1;
      if (contrastRatio(relativeLuminance(data[i]!, data[i + 1]!, data[i + 2]!), againstLuminance) < minRatio) low += 1;
    }
  }
  return total ? low / total : 0;
}

/**
 * The red-line test, on the line's own ink box (amended before #1155 merged):
 * its width + 24 px each side, its cap + 12 px above and below, centred as the
 * line is; ≤ 25 % of those pixels below 2:1 against #FE3232. Failing, the line
 * renders white.
 */
export function redInkBox(line: { capTop: number; capPx: number; widthPx: number }, frame: Size = MASTER): Rect {
  const { padX, padY } = CARD_CLAIM.redInk;
  return { left: (frame.width - line.widthPx) / 2 - padX, top: line.capTop - padY, width: line.widthPx + 2 * padX, height: line.capPx + 2 * padY };
}

export function redLineVerdict(data: Uint8Array | Buffer, width: number, channels: number, line: { capTop: number; capPx: number; widthPx: number }, frame: Size = MASTER): { share: number; red: boolean } {
  const share = lowContrastAgainst(data, width, channels, redInkBox(line, frame), RED_LUMINANCE, 2);
  return { share, red: share <= CARD_CLAIM.redInk.max };
}

// ─── One subject (O19 amended) ──────────────────────────────────────────────

export type SourceFace = { x: number; y: number; width: number; height: number };

/**
 * Only faces at least half the width of the largest count, and that count
 * must be 1; a face of any size inside the text box or the claim box fails.
 */
export function subjectVerdict(faces: readonly SourceFace[], place: { scale: number; left: number; top: number }, claimBlockTop: number | null, frame: Size = MASTER, main?: { index: number; chinY: number }): { pass: boolean; counted: number; inBox: number; detail: string } {
  if (!faces.length) return { pass: false, counted: 0, inBox: 0, detail: "no face" };
  const widest = Math.max(...faces.map((f) => f.width));
  const counted = faces.filter((f) => f.width >= 0.5 * widest).length;
  const tb = textBoxRect(frame);
  const boxes = [tb, ...(claimBlockTop != null ? [claimBoxRect(claimBlockTop, frame)] : [])];
  const inBox = faces.filter((f, i) => {
    // The placed face ends at its chin landmark (O23's 31 px clearance is measured from it); the detector's box runs lower.
    const bottom = main && i === main.index ? Math.min(f.y + f.height, main.chinY) : f.y + f.height;
    const r = { left: f.x * place.scale - place.left, top: f.y * place.scale - place.top, width: f.width * place.scale, height: (bottom - f.y) * place.scale };
    return boxes.some((b) => r.left < b.left + b.width && r.left + r.width > b.left && r.top < b.top + b.height && r.top + r.height > b.top);
  }).length;
  const pass = counted === 1 && inBox === 0;
  return { pass, counted, inBox, detail: `${counted} face${counted === 1 ? "" : "s"} ≥ ½ the largest's width${inBox ? `; ${inBox} inside the text or claim box` : ""}` };
}

// ─── Placement with the claim's face band ───────────────────────────────────

export function bandPlacementOk(p: CropPlan, band: FaceBand, faceFloorPx: number = O20.minFaceWidth * MASTER.width): boolean {
  return p.headTop >= band.headTopMin - 1e-3 && p.eyes >= band.eyesMin - 1e-3 && p.eyes <= band.eyesMax + 1e-3 && p.chin <= band.chinMax + 1e-3 && (p.faceWidthPx === 0 || p.faceWidthPx >= faceFloorPx - 0.5);
}

/** The O20 limits a placement works within: with a claim the face floor is 200 px and the top may reach 634 px. */
export type PlacementLimits = { faceFloorPx: number; maxTopPx: number };
export const NO_CLAIM_LIMITS: PlacementLimits = { faceFloorPx: O20.minFaceWidth * MASTER.width, maxTopPx: O20.maxTop };
export const CLAIM_LIMITS: PlacementLimits = { faceFloorPx: CARD_CLAIM.faceFloorPx, maxTopPx: CARD_CLAIM.maxTopPx };

type Candidate = { scale: number; eyes: number; headTop: number; chin: number; extend: Extension; left: number; top: number; faceWidthPx: number };

/** extensionCandidates with the band as a parameter (the same O20 limits). */
export function bandExtensionCandidates(photo: Size, face: FaceLines & { box: { width: number } }, band: FaceBand, frame: Size = MASTER, why?: { blocker: string }, limits: PlacementLimits = NO_CLAIM_LIMITS): Candidate[] {
  const H = frame.height;
  const W = frame.width;
  const f = band;
  const a = Math.max(1, face.eyeY - face.headTopY);
  const b = Math.max(1, face.chinY - face.eyeY);
  const sHi = Math.min(PHOTO_RULES.maxScale, ((f.chinMax - f.headTopMin) * H) / (a + b), ((f.eyesMax - f.headTopMin) * H) / a, ((f.chinMax - f.eyesMin) * H) / b);
  const sLo = limits.faceFloorPx / face.box.width;
  if (!(sLo <= sHi)) {
    if (why) why.blocker = `the face box is ${Math.round(face.box.width * sHi)} px wide at the largest size the face bands allow (min ${limits.faceFloorPx} px)`;
    return [];
  }
  const out: Candidate[] = [];
  const rejected = { band: 0, bottom: 0, top: 0, sides: 0, headGap: 0 };
  let needTop = 0;
  const steps = 60;
  for (let i = 0; i <= steps; i += 1) {
    const s = sHi - ((sHi - sLo) * i) / steps;
    const lo = Math.max(f.eyesMin, f.headTopMin + (a * s) / H);
    const hi = Math.min(f.eyesMax, f.chinMax - (b * s) / H);
    if (lo > hi + 1e-9) {
      rejected.band += 1;
      continue;
    }
    const tries = [...new Set([Math.min(hi, Math.max(lo, 0.61)), lo, hi, (lo + hi) / 2].map((v) => Math.round(v * 1e6) / 1e6))];
    for (const e of tries) {
      if ((photo.height - face.eyeY) * s < (1 - e) * H - 0.5) {
        rejected.bottom += 1; // never the bottom
        continue;
      }
      const top = Math.max(0, Math.ceil(e * H - face.eyeY * s));
      const left = Math.max(0, Math.ceil(W / 2 - face.eyeX * s));
      const right = Math.max(0, Math.ceil(W / 2 - (photo.width - face.eyeX) * s));
      if (top > limits.maxTopPx) {
        rejected.top += 1;
        needTop = needTop ? Math.min(needTop, top) : top;
        continue;
      }
      if (left > O20.maxSide || right > O20.maxSide) {
        rejected.sides += 1;
        continue;
      }
      if (top > 0 && face.headTopY * s < O20.strip + O20.headGap * H) {
        rejected.headGap += 1;
        continue;
      }
      out.push({ scale: s, eyes: e, headTop: e - (a * s) / H, chin: e + (b * s) / H, extend: { top, left, right }, left: left + face.eyeX * s - W / 2, top: top + face.eyeY * s - e * H, faceWidthPx: face.box.width * s });
    }
  }
  if (!out.length && why) {
    const parts = [
      rejected.bottom ? `${rejected.bottom} would need the bottom extended (never)` : "",
      rejected.top ? `${rejected.top} need more than ${limits.maxTopPx} px at the top (least ${needTop} px)` : "",
      rejected.sides ? `${rejected.sides} need more than ${O20.maxSide} px at a side` : "",
      rejected.headGap ? `${rejected.headGap} put the head too near the top strip` : "",
    ].filter(Boolean);
    why.blocker = `no extension within O20's limits fits the claim's face band (${parts.join("; ") || "the face band leaves no eye position"})`;
  }
  const total = (c: Candidate) => c.extend.top + c.extend.left + c.extend.right;
  return out.sort((x, y) => Number(total(x) > 0) - Number(total(y) > 0) || y.scale - x.scale || total(x) - total(y) || Math.abs(x.eyes - 0.61) - Math.abs(y.eyes - 0.61));
}

type Sharp = typeof import("sharp");
async function sharpLib(): Promise<Sharp> {
  const m = await import("sharp");
  return ((m as unknown as { default: Sharp }).default ?? (m as unknown as Sharp)) as Sharp;
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The 48 px strip along one edge of the placed photo, at output scale (as artist-card.ts). */
async function stripLuminance(rotated: Buffer, photo: Size, c: Pick<Candidate, "scale" | "left" | "top" | "extend">, edge: Edge, frame: Size): Promise<{ lum: Buffer; w: number; h: number; source: Rect; rgb: Uint8Array; length: number; depth: number } | null> {
  const sharp = await sharpLib();
  const s = c.scale;
  const S = O20.strip;
  if (edge === "top") {
    const px0 = Math.max(0, c.left - c.extend.left);
    const px1 = Math.min(photo.width * s, c.left + frame.width - c.extend.left);
    const x0 = Math.floor(px0 / s);
    const x1 = Math.min(photo.width, Math.ceil(px1 / s));
    const w = Math.round(px1 - px0);
    if (w < 3 || x1 <= x0) return null;
    const source = { left: x0, top: 0, width: x1 - x0, height: Math.min(photo.height, Math.ceil(S / s)) };
    const { data } = await sharp(rotated).extract(source).resize(w, S, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const rgb = await sharp(rotated).extract(source).resize(w, S, { fit: "fill" }).removeAlpha().raw().toBuffer();
    return { lum: data, w, h: S, source, rgb: new Uint8Array(rgb), length: w, depth: S };
  }
  const py0 = Math.max(0, c.top - c.extend.top);
  const py1 = Math.min(photo.height * s, c.top + frame.height - c.extend.top);
  const y0 = Math.floor(py0 / s);
  const y1 = Math.min(photo.height, Math.ceil(py1 / s));
  const h = Math.round(py1 - py0);
  if (h < 3 || y1 <= y0) return null;
  const cols = Math.min(photo.width, Math.ceil(S / s));
  const left = edge === "left" ? 0 : photo.width - cols;
  const source = { left, top: y0, width: cols, height: y1 - y0 };
  const { data } = await sharp(rotated).extract(source).resize(S, h, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const raw = await sharp(rotated).extract(source).resize(S, h, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const rgb = new Uint8Array(S * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const d = edge === "left" ? x : S - 1 - x;
      rgb.set(raw.subarray((y * S + x) * 3, (y * S + x) * 3 + 3), (d * h + y) * 3);
    }
  }
  return { lum: data, w: S, h, source, rgb, length: h, depth: S };
}

// ─── Watermark ──────────────────────────────────────────────────────────────

/** The draft watermark: the words set three times on a diagonal across the card, white at 70 % on a 45 % black band, so every crop shows it. */
export async function watermarkLayer(text: string, size: Size, fontPath: string, family: string): Promise<Buffer> {
  const sharp = await sharpLib();
  const px = Math.round(size.width * 0.075);
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const word = await sharp({ text: { text: `<span foreground="#ffffff">${esc}</span>`, font: `${family} ${px}`, fontfile: fontPath, dpi: 72, rgba: true } }).png().toBuffer();
  const meta = await sharp(word).metadata();
  const pad = Math.round(px * 0.35);
  const bw = (meta.width ?? 0) + 2 * pad;
  const bh = (meta.height ?? 0) + 2 * pad;
  const band = await sharp({ create: { width: bw, height: bh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.45 } } })
    .composite([{ input: await sharp(word).ensureAlpha(0.7).png().toBuffer(), left: pad, top: pad, blend: "over" }])
    .png()
    .toBuffer();
  const rotated = await sharp(band).rotate(-28, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const rm = await sharp(rotated).metadata();
  const placements = [0.3, 0.55, 0.8].map((fy) => ({ input: rotated, left: Math.round((size.width - (rm.width ?? 0)) / 2), top: Math.round(fy * size.height - (rm.height ?? 0) / 2) }));
  return sharp({ create: { width: size.width, height: size.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(placements.map((p) => ({ ...p, left: Math.max(-(rm.width ?? 0), p.left) })).filter((p) => p.left > -(rm.width ?? 0)))
    .png()
    .toBuffer();
}

// ─── Compose ────────────────────────────────────────────────────────────────

export type ClaimCardInput = {
  photo: Buffer;
  face: (FaceLines & { box: { x: number; y: number; width: number; height: number } }) | null;
  eyes?: { ok: boolean; why: string };
  /** Every face found (source pixels), for O19's one-subject rule. */
  faces: readonly SourceFace[];
  mask?: PersonMask;
  name: Piece;
  info: Piece[];
  lockup: Piece | null;
  /** The approved (or sample) claim's words, verbatim; null draws the card without a claim. */
  claimText: string | null;
  /** The face band to place with (CLAIM_FACE_BAND for the drafts). */
  band: FaceBand;
  bands: GradientShadow | null;
  /** The font index (kit-font.ts indexFonts); the claim face is required from it. */
  fonts: readonly FontEntry[];
  /** "DRAFT · …", or null for an approved claim / no claim. */
  watermark: string | null;
  /** A face for the watermark only (not kit text). */
  watermarkFont?: { path: string; family: string } | null;
};

export type ClaimCardRule = { rule: string; pass: boolean; detail: string };

export type ClaimCardResult = {
  pass: boolean;
  /** The face sits in the band (head, eyes, chin), whatever the other rules say; a card that isn't placed is not drawn. */
  placed: boolean;
  held: string | null;
  rules: ClaimCardRule[];
  plan: CropPlan | null;
  claim: CardClaimPlan | null;
  contrast: { textBox: number; claimBox: number | null; redLine: number | null };
  redLineWhite: boolean;
  approvalLines: string[];
  extensionLabel: string;
  master: Buffer | null;
  crop45: Buffer | null;
  square: Buffer | null;
  watermark: string | null;
};

export async function renderClaimCard(input: ClaimCardInput): Promise<ClaimCardResult> {
  const sharp = await sharpLib();
  const frame = MASTER;
  const rules: ClaimCardRule[] = [];
  const approvalLines: string[] = [];
  const base0: Omit<ClaimCardResult, "pass" | "placed"> = { held: null, rules, plan: null, claim: null, contrast: { textBox: 0, claimBox: null, redLine: null }, redLineWhite: false, approvalLines, extensionLabel: "", master: null, crop45: null, square: null, watermark: input.watermark };

  // The claim face first: a missing or trial face holds the card (O24).
  let claimFace: FontEntry | null = null;
  if (input.claimText != null) {
    try {
      claimFace = requireFont("BootzyCondensedTM-Regular", input.fonts);
    } catch (e) {
      return { ...base0, pass: false, placed: false, held: (e as Error).message.replace(/^Claim held — (.+) not installed$/, "Held — $1 not installed") };
    }
  }

  const rotated = await sharp(input.photo).rotate().toBuffer();
  const meta = await sharp(rotated).metadata();
  const photo = { width: meta.width ?? 0, height: meta.height ?? 0 };
  const edgeRows = Math.max(1, Math.round(photo.height * 0.02));
  const edgeStdev = (await sharp(await sharp(rotated).extract({ left: 0, top: 0, width: photo.width, height: edgeRows }).greyscale().png().toBuffer()).stats()).channels[0]!.stdev;
  let face = input.face;
  if (face && edgeStdev < PLAIN_EDGE_STDEV && face.browY != null) {
    const raw = await sharp(rotated).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const measured = measureHeadTop(raw.data, raw.info.width, raw.info.height, raw.info.channels, { eyeX: face.eyeX, chinY: face.chinY, browY: face.browY, box: face.box });
    if (measured != null) face = { ...face, headTopY: measured };
  }
  if (!face) return { ...base0, pass: false, placed: false, held: "no face found to place" };

  // Placement in the claim's band; failing that, the first O20 extension whose strips pass —
  // within O20's 576 px top first, and up to 634 px (0.33 H) only when that finds none and the card has a claim.
  const limits = input.claimText != null ? CLAIM_LIMITS : NO_CLAIM_LIMITS;
  let plan = planFaceCrop(photo, face, frame, input.band);
  const strips: Partial<Record<Edge, StripStats>> = {};
  let extensionNote = "";
  if (!bandPlacementOk(plan, input.band, limits.faceFloorPx)) {
    if (!input.mask) extensionNote = "no person mask, so no extension was tried";
    else {
      const passes: PlacementLimits[] = [{ ...limits, maxTopPx: Math.min(limits.maxTopPx, O20.maxTop) }, ...(limits.maxTopPx > O20.maxTop ? [limits] : [])];
      let found = false;
      let lastWhy = "";
      let anyCandidate = false;
      for (const lim of passes) {
        const why = { blocker: "" };
        const candidates = bandExtensionCandidates(photo, face, input.band, frame, why, lim);
        anyCandidate ||= candidates.length > 0;
        lastWhy = why.blocker;
        for (const c of candidates.slice(0, 160)) {
          const got: Partial<Record<Edge, StripStats>> = {};
          let ok = true;
          for (const edge of (["top", "left", "right"] as const).filter((e) => c.extend[e] > 0)) {
            const strip = await stripLuminance(rotated, photo, c, edge, frame);
            if (!strip) {
              ok = false;
              break;
            }
            const st = stripStats(strip.lum, strip.w, strip.h);
            const maskPixels = maskTouches(input.mask, strip.source, O20.maskThreshold);
            const colour = stripColourTests(strip.rgb, strip.length, strip.depth);
            const full: StripStats = { ...st, maskPixels, columnMaxDeltaE: colour.columnMaxDeltaE, driftP95: colour.driftP95, pass: st.pass && maskPixels === 0 && colour.passColumn && colour.passDrift };
            if (!full.pass) {
              ok = false;
              break;
            }
            got[edge] = full;
          }
          if (ok) {
            plan = { scale: c.scale, left: c.left, top: c.top, headTop: c.headTop, eyes: c.eyes, chin: c.chin, clamped: { x: false, y: false }, extend: c.extend, faceWidthPx: c.faceWidthPx };
            Object.assign(strips, got);
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found) extensionNote = anyCandidate ? "no O20 extension passes the strip tests" : `no O20 extension fits: ${lastWhy}`;
    }
  }
  base0.plan = plan;
  const ext = plan.extend;
  const extended = ext.top + ext.left + ext.right > 0;
  base0.extensionLabel = extensionLabel(ext);

  const canvasAt = async (k: number): Promise<{ png: Buffer; width: number; height: number }> => {
    if (!extended) {
      const w = Math.max(1, Math.round(photo.width * plan.scale * k));
      const h = Math.max(1, Math.round(photo.height * plan.scale * k));
      return { png: await sharp(rotated).resize(w, h).removeAlpha().png().toBuffer(), width: w, height: h };
    }
    const w = Math.max(1, Math.round(photo.width * plan.scale));
    const h = Math.max(1, Math.round(photo.height * plan.scale));
    const raw = await sharp(rotated).resize(w, h).removeAlpha().raw().toBuffer();
    const grain = { top: strips.top?.detailStdev ?? 0, left: strips.left?.detailStdev ?? 0, right: strips.right?.detailStdev ?? 0 };
    const canvas = extendCanvas(raw, w, h, ext, grain);
    let png = await sharp(canvas.data, { raw: { width: canvas.width, height: canvas.height, channels: 3 } }).png().toBuffer();
    if (k === 1) return { png, width: canvas.width, height: canvas.height };
    const cw = Math.round(canvas.width * k);
    const ch = Math.round(canvas.height * k);
    png = await sharp(png).resize(cw, ch).png().toBuffer();
    return { png, width: cw, height: ch };
  };
  const scaled = await canvasAt(1);
  const base = await sharp(scaled.png)
    .extract({ left: clamp(Math.round(plan.left), 0, scaled.width - frame.width), top: clamp(Math.round(plan.top), 0, scaled.height - frame.height), width: frame.width, height: frame.height })
    .png()
    .toBuffer();
  const bandLayer = input.bands ? await sharp(Buffer.from(renderGradientShadow(input.bands, frame.width, frame.height)), { raw: { width: frame.width, height: frame.height, channels: 4 } }).png().toBuffer() : null;
  // O19 amended: the tests read what ships — the placed photo with the bands, before any type.
  const shown = bandLayer ? await sharp(base).composite([{ input: bandLayer, left: 0, top: 0 }]).png().toBuffer() : base;
  const raw = await sharp(shown).removeAlpha().raw().toBuffer({ resolveWithObject: true });

  if (extended) {
    const pw = Math.round(photo.width * plan.scale);
    const ph = Math.round(photo.height * plan.scale);
    const x0 = Math.round(ext.left - plan.left);
    const y0 = Math.round(ext.top - plan.top);
    const seams: string[] = [];
    let ok = true;
    for (const [edge, at, from, to] of [
      ["top", y0, Math.max(0, x0), Math.min(frame.width, x0 + pw)],
      ["left", x0, Math.max(0, y0), Math.min(frame.height, y0 + ph)],
      ["right", x0 + pw, Math.max(0, y0), Math.min(frame.height, y0 + ph)],
    ] as const) {
      if (ext[edge] <= 0) continue;
      const p95 = seamP95(raw.data, raw.info.width, raw.info.height, raw.info.channels, { edge, at, from, to });
      seams.push(`${edge} join ΔE p95 ${p95.toFixed(2)}`);
      if (p95 > O20.maxSeamP95) ok = false;
    }
    rules.push({ rule: "seam", pass: ok, detail: `${seams.join("; ")} (max ${O20.maxSeamP95})` });
  }

  const textBox = lowContrastShare(raw.data, raw.info.width, raw.info.channels, textBoxRect(frame));
  base0.contrast.textBox = textBox;
  rules.push({ rule: "contrast", pass: textBox <= PHOTO_RULES.maxLowContrastShare, detail: `${(textBox * 100).toFixed(1)} % of the text box below 3:1, bands ${input.bands ? "on" : "off"} (max 10 %)` });

  // The claim (O23).
  let claimPlan: CardClaimPlan | null = null;
  const claimPieces: { piece: Piece; at: Placement }[] = [];
  if (input.claimText != null && claimFace) {
    const face0 = claimFace;
    const widths = new Map<string, number>();
    const measure = async (text: string, capPx: number) => (await renderCardLine(text, KIT_WHITE, capPx, face0)).width;
    // planCardClaim measures synchronously: measure each line first at its base cap.
    const lines = input.claimText.replace(/\r\n?/g, "\n").trim().split("\n").map((l) => l.trim()).filter(Boolean);
    const baseCaps = lines.length === 2 ? [CARD_CLAIM.twoLine.line1Cap, CARD_CLAIM.twoLine.line2Cap] : [/^final\s+\d+\s+tickets$/i.test(lines[0] ?? "") ? CARD_CLAIM.oneLine.redCap : CARD_CLAIM.oneLine.whiteCap];
    // The fit is measured on the line as displayed: in the kit's case.
    for (let i = 0; i < Math.min(lines.length, baseCaps.length); i += 1) {
      const shown = inKitCase(lines[i]!);
      widths.set(`${shown}@${baseCaps[i]}`, await measure(shown, baseCaps[i]!));
    }
    // O27: a roll-call's line 2 may take drops; measure every state it can reach.
    const shownLines = lines.map((l) => inKitCase(l));
    if (isRollCall(shownLines)) {
      for (const st of rollCallStates(shownLines[0]!, shownLines[1]!)) {
        const key = `${st.line2}@${baseCaps[1]}`;
        if (!widths.has(key)) widths.set(key, await measure(st.line2, baseCaps[1]!));
      }
    }
    const planned = planCardClaim(input.claimText, (t, cap) => widths.get(`${t}@${cap}`) ?? 0);
    if ("held" in planned) return { ...base0, pass: false, placed: false, held: planned.held };
    claimPlan = planned;
    base0.claim = planned;
    const claimBox = lowContrastShare(raw.data, raw.info.width, raw.info.channels, claimBoxRect(planned.blockTop, frame));
    base0.contrast.claimBox = claimBox;
    rules.push({ rule: "claimContrast", pass: claimBox <= CARD_CLAIM.claimBoxMax, detail: `${(claimBox * 100).toFixed(1)} % of the claim box below 3:1, bands ${input.bands ? "on" : "off"} (max ${CARD_CLAIM.claimBoxMax * 100} %)` });
    for (const line of planned.lines) {
      let colour = line.color === "red" ? KIT_RED : KIT_WHITE;
      if (line.color === "red") {
        const v = redLineVerdict(raw.data, raw.info.width, raw.info.channels, line, frame);
        base0.contrast.redLine = v.share;
        if (!v.red) {
          colour = KIT_WHITE;
          base0.redLineWhite = true;
          approvalLines.push(CARD_CLAIM.redToWhite);
        }
      }
      const p = await renderCardLine(line.text, colour, line.capPx, face0);
      const piece: Piece = { png: p.png, width: p.width, height: p.height, capPx: line.capPx, label: line.text };
      claimPieces.push({ piece, at: { left: Math.round((frame.width - p.width) / 2), top: Math.round(line.capTop - p.capTopRow), width: p.width, height: p.height, label: line.text, scale: 1, short: false, stepped: planned.k < 1, belowFloor: false } });
    }
  }

  const subj = subjectVerdict(input.faces, { scale: plan.scale, left: plan.left - ext.left, top: plan.top - ext.top }, claimPlan?.blockTop ?? null, frame, { index: 0, chinY: face.chinY });
  rules.push({ rule: "subject", pass: subj.pass, detail: subj.detail });
  if (input.eyes) rules.push({ rule: "eyes", pass: input.eyes.ok, detail: input.eyes.ok ? "measurable" : `not measurable: ${input.eyes.why}` });
  rules.push({ rule: "scale", pass: plan.scale <= PHOTO_RULES.maxScale + 1e-9, detail: `${plan.scale.toFixed(3)}× source` });
  const f = input.band;
  const misses = [
    plan.headTop < f.headTopMin - 1e-3 ? `head top ${plan.headTop.toFixed(3)} H above ${f.headTopMin}` : "",
    plan.eyes < f.eyesMin - 1e-3 || plan.eyes > f.eyesMax + 1e-3 ? `eyes ${plan.eyes.toFixed(3)} H outside ${f.eyesMin}–${f.eyesMax}` : "",
    plan.chin > f.chinMax + 1e-3 ? `chin ${plan.chin.toFixed(3)} H below ${f.chinMax}` : "",
    plan.faceWidthPx > 0 && plan.faceWidthPx < limits.faceFloorPx - 0.5 ? `face box ${Math.round(plan.faceWidthPx)} px (min ${limits.faceFloorPx})` : "",
  ].filter(Boolean);
  if (misses.length && extensionNote) misses.push(extensionNote);
  rules.push({ rule: "face", pass: misses.length === 0, detail: misses.length ? misses.join("; ") : `head ${plan.headTop.toFixed(3)} · eyes ${plan.eyes.toFixed(3)} · chin ${plan.chin.toFixed(3)} H · face box ${Math.round(plan.faceWidthPx)} px` });

  // Type: the top block (O18) and the claim (O23), one O6 shadow on the whole group.
  const layout = layoutText({ lockup: input.lockup, name: input.name, info: input.info }, frame);
  const topPieces = [...(input.lockup ? [input.lockup] : []), input.name, ...input.info];
  const pieces = [...topPieces, ...claimPieces.map((c) => c.piece)];
  const placements = [...layout.all, ...claimPieces.map((c) => c.at)];
  const overlay = await textOverlay(pieces, placements, frame, { k: 1, dx: 0, dy: 0 }, KIT_SHADOW);
  const wm = input.watermark ? input.watermarkFont ?? (claimFace ? { path: claimFace.path, family: claimFace.family ?? "Bootzy Condensed TM" } : null) : null;
  const wmMaster = input.watermark && wm ? await watermarkLayer(input.watermark, frame, wm.path, wm.family) : null;
  const master = await sharp(shown).composite([{ input: overlay, left: 0, top: 0 }, ...(wmMaster ? [{ input: wmMaster, left: 0, top: 0 }] : [])]).png().toBuffer();
  const crop45 = await sharp(master).extract({ left: 0, top: RECT_45.top, width: frame.width, height: RECT_45.bottom - RECT_45.top }).png().toBuffer();

  // 1:1 (O1): the 4:5 at 0.8×, photo extended at the sides; the bands and the type carried the same way.
  const k = 0.8;
  const side = 1080;
  const dx = (side - frame.width * k) / 2;
  const kPhoto = Math.max(k, side / scaled.width, side / scaled.height);
  const small = await canvasAt(kPhoto);
  const anchor = { x: frame.width / 2, y: plan.eyes * frame.height };
  const sLeft = clamp(Math.round((plan.left + anchor.x) * kPhoto - (dx + anchor.x * k)), 0, small.width - side);
  const sTop = clamp(Math.round((plan.top + anchor.y) * kPhoto - (anchor.y - RECT_45.top) * k), 0, small.height - side);
  const squareBase = await sharp(small.png).extract({ left: sLeft, top: sTop, width: side, height: side }).png().toBuffer();
  const squareBands = bandLayer ? await sharp(bandLayer).extract({ left: 0, top: RECT_45.top, width: frame.width, height: RECT_45.bottom - RECT_45.top }).resize(side, side, { fit: "fill" }).png().toBuffer() : null;
  const squareOverlay = await textOverlay(pieces, placements, { width: side, height: side }, { k, dx, dy: -RECT_45.top * k }, KIT_SHADOW);
  const wmSquare = input.watermark && wm ? await watermarkLayer(input.watermark, { width: side, height: side }, wm.path, wm.family) : null;
  const square = await sharp(squareBase)
    .composite([...(squareBands ? [{ input: squareBands, left: 0, top: 0 }] : []), { input: squareOverlay, left: 0, top: 0 }, ...(wmSquare ? [{ input: wmSquare, left: 0, top: 0 }] : [])])
    .png()
    .toBuffer();

  const placed = plan.headTop >= f.headTopMin - 1e-3 && plan.eyes >= f.eyesMin - 1e-3 && plan.eyes <= f.eyesMax + 1e-3 && plan.chin <= f.chinMax + 1e-3;
  return { ...base0, pass: rules.every((r) => r.pass), placed, master: placed ? master : null, crop45: placed ? crop45 : null, square: placed ? square : null };
}
