/**
 * Draft artist card: a press photo filling the frame, the artwork's own
 * pieces on top — the "PUZZLE 4th Birthday" lockup, the artist's name large,
 * the date / venue / time lines small. Prototype for design to judge; it never
 * enters a Lab round and never goes to Meta.
 *
 * Slot table (design fix round 1 on PR #1147, Matas, 9 Nov 2026), on the
 * 1080×1920 master; the 4:5 is the band y 285–1635 and every element keeps a
 * 76 px (7 % W) inset from its top and bottom, so nothing sits above y 361 or
 * below y 1559 (0.812 H):
 *
 *   lockup   centred, 0.28 W wide (302 px), top at y 361, height from its aspect
 *   name     cap 0.1146 H (220 px), top 28 px under the lockup; O3's steps:
 *            down until it fits 0.80 W, floor 0.06 H, never condensed
 *   info     the PSD's three lines, cap 0.031 H (60 px), pitch 0.043 H (83 px),
 *            first line 36 px under the name; the block ends ~0.512 H
 *   text box 0.188–0.512 H: no face, head or hand inside it
 *   face     top of head ≥ 0.53 H, eyes 0.58–0.64 H, chin ≤ 0.76 H
 *   edge     the kit's shadow once on the whole text group: straight down
 *            0.007 W, blur 0.009 W, 25 % black (O6)
 *
 * Formats: the 9:16 master; the 4:5 as its pure centre crop; the 1:1 as O1's
 * re-sit — the 4:5 arrangement at 0.8× (864×1080 centred) with the photo
 * extended at the sides, rendered from the same props.
 *
 * Photo rules (a photo that fails one is skipped, never covered with a scrim):
 *   contrast  in the text box, at most 10 % of the photo's pixels below 3:1
 *             contrast with white (relative luminance above 0.30)
 *   subject   one face
 *   scale     at most 1.0× source pixels (no upscaling)
 *   face      the bands above, and the face box at least 0.25 W (270 px)
 *   eyes      measurable (face-detect's eyesMeasurable)
 *
 * Extension (O20, fix round 2): a photo that cannot meet the bands on its
 * own may be extended at the top (≤ 0.30 H) and sides (≤ 0.12 W each),
 * never the bottom, only where the 48 px strip along that edge passes the
 * plainness tests (stripStats), clear of the subject, filled from the
 * strip's own colours with its grain (extendCanvas). Each card reports
 * "photo extended … by N px" (extensionLabel).
 *
 * Pieces are placed by their ink box at a uniform scale, never stretched and
 * never enlarged past their own pixels. No text is rendered here.
 */

// ─── Slots ──────────────────────────────────────────────────────────────────

export const MASTER = { width: 1080, height: 1920 } as const;
export const RECT_45 = { top: 285, bottom: 1635 } as const;
/** 7 % W: the inset from the 4:5 rectangle's top and bottom edges. */
export const INSET = 76;
export const SAFE = { top: RECT_45.top + INSET, bottom: RECT_45.bottom - INSET } as const; // 361, 1559 (0.812 H)

export const SLOTS = {
  lockup: { width: 0.28, top: SAFE.top },
  name: { cap: 0.1146, gapAbove: 28, maxWidth: 0.8, floorCap: 0.06 },
  info: { cap: 0.031, pitch: 0.043, gapAbove: 36, maxWidth: 0.8 },
  textBox: { top: 0.188, bottom: 0.512 },
  face: { headTopMin: 0.53, eyesMin: 0.58, eyesMax: 0.64, chinMax: 0.76 },
} as const;

export const KIT_SHADOW = { dy: 0.007, blur: 0.009, opacity: 0.25 } as const;

export const PHOTO_RULES = {
  /** At most this share of text-box pixels below 3:1 against white. */
  maxLowContrastShare: 0.1,
  /** Relative luminance above which a pixel is below 3:1 against white: 1.05 / (L + 0.05) < 3. */
  lowContrastLuminance: 0.3,
  maxScale: 1.0,
  subjects: 1,
} as const;

/** Values on the card that no asset, PSD, record or ruling gives. */
export const INVENTED = [
  "top of the head: measured on a plain backdrop (first 3 rows above the brows where 95 % of the face's width matches the photo's top edge within 40); otherwise estimated as brow − 0.6 × (chin − brow), calibrated by eye on Luke (cap), Enzo and Reeshy, erring high on hair",
  "the face is placed as large as the bands allow, eyes on the mid-point the bands leave free; the text box is the full width between the 76 px side insets",
  "one subject = one detected face at least 0.4× the main face's height (detector at 0.3 confidence)",
  "O20 reading: the 31 px Gaussian is 31 taps (sigma 5); the Sobel is the 3×3 kernel on 0–255 luminance, unnormalised; the fill is blurred along the edge with sigma 6 px; the grain is monochrome Gaussian noise at the strip's detail stdev, seeded",
  "O20 person mask: estimated (head from its top down; body as a column 1.8 face-box widths either side of the eyes), not segmented; hands outside that column are not seen by code",
  "O20 eyes measurable: detector confidence ≥ 0.5, both eye centroids inside the face box, ≥ 0.25 box widths apart, between brows and chin",
] as const;

// ─── Text layout ────────────────────────────────────────────────────────────

export type Size = { width: number; height: number };
export type Rect = { left: number; top: number; width: number; height: number };

export type Piece = {
  /** PNG bytes, trimmed to the ink box. */
  png: Buffer;
  width: number;
  height: number;
  /** The cap height of the piece's text in its own pixels (the ink height for an all-caps line). */
  capPx: number;
  label: string;
};

export type Placement = Rect & {
  label: string;
  scale: number;
  /** The piece would have to be enlarged to reach the slot's size; it was placed at 1:1 instead. */
  short: boolean;
  /** The size stepped down to fit the slot's width. */
  stepped: boolean;
  /** Stepped below the slot's floor (O3 breaks the name onto two lines there). */
  belowFloor: boolean;
};

/** The slot's cap, stepped down to the max width, never above 1 (no enlargement). */
export function pieceScale(piece: Pick<Piece, "width" | "capPx">, slot: { cap: number; maxWidth: number; floorCap?: number }, frame: Size = MASTER): { scale: number; short: boolean; stepped: boolean; belowFloor: boolean } {
  let scale = (slot.cap * frame.height) / piece.capPx;
  let stepped = false;
  const maxW = slot.maxWidth * frame.width;
  if (piece.width * scale > maxW) {
    scale = maxW / piece.width;
    stepped = true;
  }
  const belowFloor = slot.floorCap != null && piece.capPx * scale < slot.floorCap * frame.height - 0.5;
  return { scale: Math.min(scale, 1), short: scale > 1.0001, stepped, belowFloor };
}

function centred(piece: Pick<Piece, "width" | "height" | "label">, scale: number, top: number, frame: Size, flags: Pick<Placement, "short" | "stepped" | "belowFloor">): Placement {
  const width = Math.round(piece.width * scale);
  const height = Math.round(piece.height * scale);
  return { label: piece.label, left: Math.round((frame.width - width) / 2), top: Math.round(top), width, height, scale, ...flags };
}

export type TextLayout = { lockup: Placement | null; name: Placement; info: Placement[]; all: Placement[]; block: Rect };

/** Lockup, then the name 28 px under it, then the info lines 36 px under the name. */
export function layoutText(input: { lockup: Piece | null; name: Piece; info: readonly Piece[] }, frame: Size = MASTER): TextLayout {
  let y: number = SLOTS.lockup.top;
  let lockup: Placement | null = null;
  if (input.lockup) {
    const want = (SLOTS.lockup.width * frame.width) / input.lockup.width;
    lockup = centred(input.lockup, Math.min(want, 1), y, frame, { short: want > 1.0001, stepped: false, belowFloor: false });
    y = lockup.top + lockup.height + SLOTS.name.gapAbove;
  }
  const nameFit = pieceScale(input.name, SLOTS.name, frame);
  const name = centred(input.name, nameFit.scale, y, frame, nameFit);
  y = name.top + name.height + SLOTS.info.gapAbove;
  const info: Placement[] = [];
  if (input.info.length) {
    const capPx = Math.max(...input.info.map((l) => l.capPx));
    const widest = Math.max(...input.info.map((l) => l.width));
    const fit = pieceScale({ width: widest, capPx }, SLOTS.info, frame);
    const pitch = SLOTS.info.pitch * frame.height * (fit.stepped || fit.short ? (capPx * fit.scale) / (SLOTS.info.cap * frame.height) : 1);
    input.info.forEach((line, i) => {
      // Lines sit on a common cap line: each piece's bottom is its baseline.
      const p = centred(line, fit.scale, 0, frame, fit);
      const capTop = y + pitch * i;
      info.push({ ...p, top: Math.round(capTop + capPx * fit.scale - p.height) });
    });
  }
  const all = [lockup, name, ...info].filter((p): p is Placement => p != null);
  return { lockup, name, info, all, block: unionRect(all) };
}

export type LayoutCheck = {
  /** Every element inside y 361–1559 (the 4:5 with its 76 px insets). */
  insideSafe: boolean;
  /** The text block inside the text box 0.188–0.512 H. */
  insideTextBox: boolean;
  outside: string[];
};

export function checkLayout(layout: TextLayout, frame: Size = MASTER): LayoutCheck {
  const outside = layout.all.filter((p) => p.top < SAFE.top - 0.5 || p.top + p.height > SAFE.bottom + 0.5).map((p) => p.label);
  const b = layout.block;
  return {
    insideSafe: outside.length === 0,
    insideTextBox: b.top >= SLOTS.textBox.top * frame.height - 1 && b.top + b.height <= SLOTS.textBox.bottom * frame.height + 1,
    outside,
  };
}

// ─── Photo crop ─────────────────────────────────────────────────────────────

/** A face in source pixels: the eye centre, the top of the head and the chin (brow and box width when known). */
export type FaceLines = { eyeX: number; eyeY: number; headTopY: number; chinY: number; browY?: number; box?: { width: number } };

/**
 * On a plain backdrop the top of the head can be measured instead of
 * estimated: scanning up from the brows over the face's width, the first run
 * of 3 rows where at least 95 % of pixels are within 40 (RGB distance) of the
 * photo's own top edge in that column is backdrop; the head ends just below.
 * Kept only between 0.25 and 1.0 × (chin − brow) above the brow; otherwise null.
 */
export function measureHeadTop(rgb: Uint8Array | Buffer, width: number, height: number, channels: number, face: Required<Pick<FaceLines, "eyeX" | "chinY" | "browY" | "box">>): number | null {
  const edgeRows = Math.max(1, Math.round(height * 0.02));
  const ref: number[][] = [];
  for (let x = 0; x < width; x += 1) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let y = 0; y < edgeRows; y += 1) {
      const i = (y * width + x) * channels;
      r += rgb[i]!;
      g += rgb[i + 1]!;
      b += rgb[i + 2]!;
    }
    ref.push([r / edgeRows, g / edgeRows, b / edgeRows]);
  }
  const span = face.chinY - face.browY;
  const x0 = Math.max(0, Math.round(face.eyeX - face.box.width / 2));
  const x1 = Math.min(width - 1, Math.round(face.eyeX + face.box.width / 2));
  let run = 0;
  for (let y = Math.round(face.browY); y >= 0; y -= 1) {
    let match = 0;
    for (let x = x0; x <= x1; x += 1) {
      const i = (y * width + x) * channels;
      const t = ref[x]!;
      if (Math.hypot(rgb[i]! - t[0]!, rgb[i + 1]! - t[1]!, rgb[i + 2]! - t[2]!) < 40) match += 1;
    }
    run = match / (x1 - x0 + 1) >= 0.95 ? run + 1 : 0;
    if (run === 3) {
      const top = y + 3;
      const above = face.browY - top;
      return above >= 0.25 * span && above <= 1.0 * span ? top : null;
    }
  }
  return null;
}

export type CropPlan = {
  /** Output pixels per source pixel. */
  scale: number;
  /** Top-left of the output frame in canvas pixels (the scaled photo plus any extension). */
  left: number;
  top: number;
  /** Positions on the frame as fractions of H. */
  headTop: number;
  eyes: number;
  chin: number;
  /** The photo ran out before the eyes reached their target. */
  clamped: { x: boolean; y: boolean };
  /** Output px added beyond the photo's edges (O20); all 0 when the photo covers the frame. */
  extend: Extension;
  /** The face box's width on the frame, px. */
  faceWidthPx: number;
};

/**
 * The largest face the bands allow: with a = eyes − head top and b = chin −
 * eyes, the scale is capped by (eyes − 0.53 H) / a and (0.76 H − eyes) / b,
 * best when both meet; the eyes stay in 0.58–0.64 H. Never above 1.0×
 * (no upscaling), never below cover. Then the eyes are centred at 0.5 W and
 * the photo is clamped to cover the frame. No extension: see extensionCandidates.
 */
export function planFaceCrop(photo: Size, face: FaceLines, frame: Size = MASTER): CropPlan {
  const H = frame.height;
  const f = SLOTS.face;
  const a = Math.max(1, face.eyeY - face.headTopY);
  const b = Math.max(1, face.chinY - face.eyeY);
  const cover = Math.max(frame.width / photo.width, frame.height / photo.height);
  const best = clampNum((f.headTopMin * b + f.chinMax * a) / (a + b), f.eyesMin, f.eyesMax);
  let scale = Math.min(((best - f.headTopMin) * H) / a, ((f.chinMax - best) * H) / b);
  scale = Math.max(cover, Math.min(scale, PHOTO_RULES.maxScale));
  // Eyes on the middle of what the bands leave free at this scale.
  const lo = Math.max(f.eyesMin, f.headTopMin + (a * scale) / H);
  const hi = Math.min(f.eyesMax, f.chinMax - (b * scale) / H);
  const eyes = lo <= hi ? (lo + hi) / 2 : best;
  const wantLeft = face.eyeX * scale - 0.5 * frame.width;
  const wantTop = face.eyeY * scale - eyes * H;
  const left = clampNum(wantLeft, 0, photo.width * scale - frame.width);
  const top = clampNum(wantTop, 0, photo.height * scale - frame.height);
  const at = (y: number) => (y * scale - top) / H;
  return {
    scale,
    left,
    top,
    headTop: at(face.headTopY),
    eyes: at(face.eyeY),
    chin: at(face.chinY),
    clamped: { x: Math.abs(left - wantLeft) > 1, y: Math.abs(top - wantTop) > 1 },
    extend: NO_EXTENSION,
    faceWidthPx: (face.box?.width ?? 0) * scale,
  };
}

/** Cover, centred: for a photo with no face to place. */
export function planCover(photo: Size, frame: Size = MASTER): Omit<CropPlan, "headTop" | "eyes" | "chin"> {
  const scale = Math.max(frame.width / photo.width, frame.height / photo.height);
  return { scale, left: (photo.width * scale - frame.width) / 2, top: (photo.height * scale - frame.height) / 2, clamped: { x: false, y: false }, extend: NO_EXTENSION, faceWidthPx: 0 };
}

/**
 * The top edge is plain enough to measure the head against it (measureHeadTop):
 * luminance stdev over its top 2 % of rows under this, 0–255.
 */
export const PLAIN_EDGE_STDEV = 12;

// ─── Extension (O20, design ruling on PR #1147 fix round 2) ────────────────

export type Edge = "top" | "left" | "right";
export type Extension = { top: number; left: number; right: number };
export const NO_EXTENSION: Extension = { top: 0, left: 0, right: 0 };

export const O20 = {
  /** The strip along the edge of the placed photo, output px. */
  strip: 48,
  /** Gaussian blur taps for the detail test (sigma = (taps − 1) / 6 = 5). */
  blurTaps: 31,
  maxDetailStdev: 4,
  sobelThreshold: 20,
  maxSobelShare: 0.02,
  /** Gaps to the head's top, fractions of H. */
  headGap: 0.05,
  maxTop: 576,
  /** Per side, in the 9:16 and 4:5: 0.12 W. */
  maxSide: Math.round(0.12 * 1080),
  /** The face box at least 0.25 W (270 px) wide. */
  minFaceWidth: 0.25,
  /**
   * The person mask is estimated, not segmented: the head from its top down,
   * and the body as a column 1.8 face-box widths either side of the eyes from
   * the head's top to the bottom of the photo (shoulders, arms, hands at the
   * sides). A side strip inside that column touches the person.
   */
  bodyHalfWidth: 1.8,
} as const;

/** "photo extended top by 319 px", "photo extended top by 319 px and sides by 40 px", "" when none. */
export function extensionLabel(e: Extension): string {
  const parts: string[] = [];
  if (e.top > 0) parts.push(`top by ${e.top} px`);
  if (e.left > 0 || e.right > 0) parts.push(e.left === e.right ? `sides by ${e.left} px` : `sides by ${e.left} px (left) / ${e.right} px (right)`);
  return parts.length ? `photo extended ${parts.join(" and ")}` : "";
}

export function gaussianKernel(taps: number): number[] {
  const sigma = (taps - 1) / 6;
  const r = (taps - 1) / 2;
  const k: number[] = [];
  for (let i = -r; i <= r; i += 1) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = k.reduce((acc, v) => acc + v, 0);
  return k.map((v) => v / sum);
}

/** Separable blur of a w×h luminance array, edges clamped. */
export function blurLum(lum: ArrayLike<number>, w: number, h: number, taps: number): Float64Array {
  const k = gaussianKernel(taps);
  const r = (taps - 1) / 2;
  const tmp = new Float64Array(w * h);
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let i = -r; i <= r; i += 1) acc += lum[y * w + clampNum(x + i, 0, w - 1)]! * k[i + r]!;
      tmp[y * w + x] = acc;
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let i = -r; i <= r; i += 1) acc += tmp[clampNum(y + i, 0, h - 1) * w + x]! * k[i + r]!;
      out[y * w + x] = acc;
    }
  }
  return out;
}

export type StripStats = {
  /** Stdev of luminance minus its 31-tap Gaussian blur, 0–255. */
  detailStdev: number;
  /** Share of pixels whose Sobel gradient magnitude is above 20 (3×3 Sobel on 0–255 luminance, interior pixels). */
  sobelShare: number;
  pass: boolean;
};

export function stripStats(lum: ArrayLike<number>, w: number, h: number): StripStats {
  const blurred = blurLum(lum, w, h, O20.blurTaps);
  let sum = 0;
  let sq = 0;
  for (let i = 0; i < w * h; i += 1) {
    const d = lum[i]! - blurred[i]!;
    sum += d;
    sq += d * d;
  }
  const n = w * h;
  const detailStdev = Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2));
  let over = 0;
  let total = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const p = (dx: number, dy: number) => lum[(y + dy) * w + (x + dx)]!;
      const gx = -p(-1, -1) - 2 * p(-1, 0) - p(-1, 1) + p(1, -1) + 2 * p(1, 0) + p(1, 1);
      const gy = -p(-1, -1) - 2 * p(0, -1) - p(1, -1) + p(-1, 1) + 2 * p(0, 1) + p(1, 1);
      total += 1;
      if (Math.hypot(gx, gy) > O20.sobelThreshold) over += 1;
    }
  }
  const sobelShare = total ? over / total : 0;
  return { detailStdev, sobelShare, pass: detailStdev <= O20.maxDetailStdev && sobelShare <= O20.maxSobelShare };
}

export type FaceForExtension = FaceLines & { box: { width: number } };

export type ExtCandidate = {
  scale: number;
  eyes: number;
  headTop: number;
  chin: number;
  extend: Extension;
  /** Frame top-left in canvas px (canvas = extension + scaled photo). */
  left: number;
  top: number;
  faceWidthPx: number;
};

/**
 * Every placement O20 allows, best first: the face bands met, never above
 * 1.0× source, the face box ≥ 0.25 W, the eyes centred, the bottom never
 * extended, the top ≤ 0.30 H with the head's top at least 0.05 H below the
 * top strip, each side ≤ 0.12 W with its strip clear of the body column.
 * Order: no extension, then the larger face, then the smaller extension,
 * then the eyes nearest 0.61 H. The strip tests run on the pixels (renderCard).
 */
export function extensionCandidates(photo: Size, face: FaceForExtension, frame: Size = MASTER, why?: { blocker: string }): ExtCandidate[] {
  const H = frame.height;
  const W = frame.width;
  const f = SLOTS.face;
  const a = Math.max(1, face.eyeY - face.headTopY);
  const b = Math.max(1, face.chinY - face.eyeY);
  // The largest scale any eye position allows: head ≥ 0.53 H with eyes ≤ 0.64 H, chin ≤ 0.76 H with eyes ≥ 0.58 H, and both together.
  const sHi = Math.min(PHOTO_RULES.maxScale, ((f.chinMax - f.headTopMin) * H) / (a + b), ((f.eyesMax - f.headTopMin) * H) / a, ((f.chinMax - f.eyesMin) * H) / b);
  const sLo = (O20.minFaceWidth * W) / face.box.width;
  if (!(sLo <= sHi)) {
    if (why) why.blocker = `the face box is ${Math.round(face.box.width * sHi)} px wide at the largest size the face bands allow (min ${O20.minFaceWidth * W} px)`;
    return [];
  }
  const out: ExtCandidate[] = [];
  const rejected = { band: 0, bottom: 0, top: 0, sides: 0, headGap: 0, body: 0 };
  const steps = 60;
  for (let i = 0; i <= steps; i += 1) {
    const s = sHi - ((sHi - sLo) * i) / steps;
    // The eye positions the bands leave at this scale, exactly: [lo, hi].
    const lo = Math.max(f.eyesMin, f.headTopMin + (a * s) / H);
    const hi = Math.min(f.eyesMax, f.chinMax - (b * s) / H);
    if (lo > hi + 1e-9) {
      rejected.band += 1;
      continue;
    }
    const tries = [...new Set([clampNum(0.61, lo, hi), lo, hi, (lo + hi) / 2].map((v) => Math.round(v * 1e6) / 1e6))];
    for (const e of tries) {
      const headTop = e - (a * s) / H;
      const chin = e + (b * s) / H;
      if ((photo.height - face.eyeY) * s < (1 - e) * H - 0.5) {
        rejected.bottom += 1; // the bottom is never extended
        continue;
      }
      const top = Math.max(0, Math.ceil(e * H - face.eyeY * s));
      const left = Math.max(0, Math.ceil(W / 2 - face.eyeX * s));
      const right = Math.max(0, Math.ceil(W / 2 - (photo.width - face.eyeX) * s));
      if (top > O20.maxTop) {
        rejected.top += 1;
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
      const bodyL = (face.eyeX - O20.bodyHalfWidth * face.box.width) * s;
      const bodyR = (photo.width - face.eyeX - O20.bodyHalfWidth * face.box.width) * s;
      if ((left > 0 && bodyL < O20.strip) || (right > 0 && bodyR < O20.strip)) {
        rejected.body += 1;
        continue;
      }
      out.push({
        scale: s,
        eyes: e,
        headTop,
        chin,
        extend: { top, left, right },
        left: left + face.eyeX * s - W / 2,
        top: top + face.eyeY * s - e * H,
        faceWidthPx: face.box.width * s,
      });
    }
  }
  if (!out.length && why) {
    const names: Record<keyof typeof rejected, string> = {
      band: "the face bands",
      bottom: "the photo would need extending at the bottom (never allowed)",
      top: `the top would need more than ${O20.maxTop} px`,
      sides: `a side would need more than ${O20.maxSide} px`,
      headGap: `the head's top would be under ${O20.strip} px + 0.05 H below the top strip`,
      body: "a side strip would touch the body column",
    };
    const worst = (Object.keys(rejected) as (keyof typeof rejected)[]).filter((k) => k !== "band" && rejected[k] > 0).sort((x, y) => rejected[y] - rejected[x])[0];
    why.blocker = worst ? names[worst] : names.band;
  }
  const total = (c: ExtCandidate) => c.extend.top + c.extend.left + c.extend.right;
  return out.sort((x, y) => Number(total(x) > 0) - Number(total(y) > 0) || y.scale - x.scale || total(x) - total(y) || Math.abs(x.eyes - 0.61) - Math.abs(y.eyes - 0.61));
}

/** A seeded normal sampler (mulberry32 + Box–Muller), so a re-render is identical. */
export function gaussianNoise(seed: number): () => number {
  let t = seed >>> 0;
  const uniform = () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(Math.max(1e-12, uniform()))) * Math.cos(2 * Math.PI * uniform());
}

function blur1D(values: number[], sigma: number): number[] {
  if (sigma <= 0) return values;
  const r = Math.ceil(sigma * 3);
  const k: number[] = [];
  for (let i = -r; i <= r; i += 1) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = k.reduce((acc, v) => acc + v, 0);
  return values.map((_, x) => {
    let acc = 0;
    for (let i = -r; i <= r; i += 1) acc += values[clampNum(x + i, 0, values.length - 1)]! * k[i + r]!;
    return acc / sum;
  });
}

/**
 * The extended canvas (O20 rule 5): the scaled photo, and beyond each edge
 * the strip's own colours — each strip averaged across its 48 px, stretched
 * along the extension, blurred along the edge, with the strip's measured
 * grain (its detail stdev) added back as monochrome noise. Never mirrored,
 * cloned or generated. The corners above a side take the top fill's end colour.
 */
export function extendCanvas(rgb: Uint8Array | Buffer, w: number, h: number, ext: Extension, grain: { top: number; left: number; right: number }, seed = 1): { data: Buffer; width: number; height: number } {
  const S = O20.strip;
  const W = ext.left + w + ext.right;
  const Hc = ext.top + h;
  const out = Buffer.alloc(W * Hc * 3);
  for (let y = 0; y < h; y += 1) out.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), ((y + ext.top) * W + ext.left) * 3);
  const noise = gaussianNoise(seed);
  const put = (x: number, y: number, c: number[], sigma: number) => {
    const n = sigma > 0 ? noise() * sigma : 0;
    for (let ch = 0; ch < 3; ch += 1) out[(y * W + x) * 3 + ch] = clampNum(Math.round(c[ch]! + n), 0, 255);
  };
  // Top: per photo column, the mean of the strip's rows.
  let topProfile: number[][] = [];
  if (ext.top > 0) {
    const rows = Math.min(S, h);
    const cols: number[][] = [];
    for (let x = 0; x < w; x += 1) {
      const c = [0, 0, 0];
      for (let y = 0; y < rows; y += 1) for (let ch = 0; ch < 3; ch += 1) c[ch]! += rgb[(y * w + x) * 3 + ch]!;
      cols.push(c.map((v) => v / rows));
    }
    const full = [...Array(ext.left).fill(cols[0]), ...cols, ...Array(ext.right).fill(cols[w - 1])] as number[][];
    topProfile = [0, 1, 2].map((ch) => blur1D(full.map((c) => c[ch]!), 6)).reduce<number[][]>((acc, chan, ch) => {
      chan.forEach((v, x) => ((acc[x] ??= [0, 0, 0])[ch] = v));
      return acc;
    }, []);
    for (let y = 0; y < ext.top; y += 1) for (let x = 0; x < W; x += 1) put(x, y, topProfile[x]!, grain.top);
  }
  const side = (which: "left" | "right") => {
    const n = ext[which];
    if (n <= 0) return;
    const cols = Math.min(S, w);
    const x0 = which === "left" ? 0 : w - cols;
    const rowsColour: number[][] = [];
    for (let y = 0; y < h; y += 1) {
      const c = [0, 0, 0];
      for (let x = x0; x < x0 + cols; x += 1) for (let ch = 0; ch < 3; ch += 1) c[ch]! += rgb[(y * w + x) * 3 + ch]!;
      rowsColour.push(c.map((v) => v / cols));
    }
    const corner = topProfile.length ? topProfile[which === "left" ? ext.left : ext.left + w - 1]! : rowsColour[0]!;
    const full = [...Array(ext.top).fill(corner), ...rowsColour] as number[][];
    const blurred = [0, 1, 2].map((ch) => blur1D(full.map((c) => c[ch]!), 6));
    for (let y = 0; y < Hc; y += 1) {
      const c = [blurred[0]![y]!, blurred[1]![y]!, blurred[2]![y]!];
      for (let i = 0; i < n; i += 1) put(which === "left" ? i : ext.left + w + i, y, c, grain[which]);
    }
  };
  side("left");
  side("right");
  return { data: out, width: W, height: Hc };
}

function clampNum(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

// ─── Photo rules ────────────────────────────────────────────────────────────

/** WCAG relative luminance of an sRGB pixel. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Share of pixels in an RGB(A) buffer region below 3:1 contrast with white. */
export function lowContrastShare(data: Uint8Array | Buffer, width: number, channels: number, rect: Rect): number {
  let low = 0;
  let total = 0;
  for (let y = Math.max(0, Math.round(rect.top)); y < Math.round(rect.top + rect.height); y += 1) {
    for (let x = Math.max(0, Math.round(rect.left)); x < Math.min(width, Math.round(rect.left + rect.width)); x += 1) {
      const i = (y * width + x) * channels;
      total += 1;
      if (relativeLuminance(data[i]!, data[i + 1]!, data[i + 2]!) > PHOTO_RULES.lowContrastLuminance) low += 1;
    }
  }
  return total ? low / total : 0;
}

/** The text box as a rectangle on the master: 0.188–0.512 H, inside the 76 px side insets. */
export function textBoxRect(frame: Size = MASTER): Rect {
  const top = SLOTS.textBox.top * frame.height;
  return { left: INSET, top, width: frame.width - 2 * INSET, height: SLOTS.textBox.bottom * frame.height - top };
}

export type RuleResult = { rule: "contrast" | "subject" | "eyes" | "scale" | "face"; pass: boolean; detail: string };

export function judgePhoto(input: { contrastShare: number; subjects: number; plan: CropPlan | null; eyes?: { ok: boolean; why: string }; extensionNote?: string }): RuleResult[] {
  const out: RuleResult[] = [];
  out.push({
    rule: "contrast",
    pass: input.contrastShare <= PHOTO_RULES.maxLowContrastShare,
    detail: `${(input.contrastShare * 100).toFixed(1)} % of the text box below 3:1 (max ${PHOTO_RULES.maxLowContrastShare * 100} %)`,
  });
  out.push({ rule: "subject", pass: input.subjects === PHOTO_RULES.subjects, detail: `${input.subjects} face${input.subjects === 1 ? "" : "s"}` });
  if (!input.plan) {
    out.push({ rule: "face", pass: false, detail: "no face found to place" });
    return out;
  }
  if (input.eyes) out.push({ rule: "eyes", pass: input.eyes.ok, detail: input.eyes.ok ? `measurable (${input.eyes.why})` : `not measurable: ${input.eyes.why}` });
  const p = input.plan;
  out.push({ rule: "scale", pass: p.scale <= PHOTO_RULES.maxScale + 1e-9, detail: `${p.scale.toFixed(3)}× source` });
  const f = SLOTS.face;
  const minFace = O20.minFaceWidth * MASTER.width;
  const misses = [
    p.headTop < f.headTopMin - 1e-3 ? `head top ${p.headTop.toFixed(3)} H above ${f.headTopMin}` : "",
    p.eyes < f.eyesMin - 1e-3 || p.eyes > f.eyesMax + 1e-3 ? `eyes ${p.eyes.toFixed(3)} H outside ${f.eyesMin}–${f.eyesMax}` : "",
    p.chin > f.chinMax + 1e-3 ? `chin ${p.chin.toFixed(3)} H below ${f.chinMax}` : "",
    p.faceWidthPx > 0 && p.faceWidthPx < minFace - 0.5 ? `face box ${Math.round(p.faceWidthPx)} px wide (min ${minFace})` : "",
  ].filter(Boolean);
  if (misses.length && input.extensionNote) misses.push(input.extensionNote);
  out.push({
    rule: "face",
    pass: misses.length === 0,
    detail: misses.length ? misses.join("; ") : `head ${p.headTop.toFixed(3)} · eyes ${p.eyes.toFixed(3)} · chin ${p.chin.toFixed(3)} H · face box ${Math.round(p.faceWidthPx)} px`,
  });
  return out;
}

/** The bands and the face-width floor, without the photo-level rules. */
export function placementOk(p: CropPlan): boolean {
  const f = SLOTS.face;
  return (
    p.headTop >= f.headTopMin - 1e-3 &&
    p.eyes >= f.eyesMin - 1e-3 &&
    p.eyes <= f.eyesMax + 1e-3 &&
    p.chin <= f.chinMax + 1e-3 &&
    (p.faceWidthPx === 0 || p.faceWidthPx >= O20.minFaceWidth * MASTER.width - 0.5)
  );
}

// ─── Rendering (sharp) ──────────────────────────────────────────────────────

type Sharp = typeof import("sharp");
let sharpModule: Promise<Sharp> | null = null;
async function sharpLib(): Promise<Sharp> {
  sharpModule ??= import("sharp").then((m) => (m as unknown as { default: Sharp }).default ?? (m as unknown as Sharp));
  return sharpModule;
}

/** Trim a PNG to its ink box (alpha > 8). */
export async function trimToInk(png: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  const sharp = await sharpLib();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3]! > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return { png, width: info.width, height: info.height };
  const width = right - left + 1;
  const height = bottom - top + 1;
  const out = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).extract({ left, top, width, height }).png().toBuffer();
  return { png: out, width, height };
}

type Transform = { k: number; dx: number; dy: number };

/** The text group on a transparent canvas, with the kit shadow once on the whole group. */
async function textOverlay(pieces: readonly Piece[], placements: readonly Placement[], size: Size, t: Transform, shadow: { dy: number; blur: number; opacity: number }): Promise<Buffer> {
  const sharp = await sharpLib();
  const layers: { input: Buffer; left: number; top: number }[] = [];
  for (let i = 0; i < pieces.length; i += 1) {
    const at = placements[i]!;
    const width = Math.max(1, Math.round(at.width * t.k));
    const height = Math.max(1, Math.round(at.height * t.k));
    layers.push({ input: await sharp(pieces[i]!.png).resize(width, height, { kernel: "lanczos3" }).png().toBuffer(), left: Math.round(at.left * t.k + t.dx), top: Math.round(at.top * t.k + t.dy) });
  }
  const blank = { width: size.width, height: size.height, channels: 4 as const, background: { r: 0, g: 0, b: 0, alpha: 0 } };
  const text = await sharp({ create: blank }).composite(layers).png().toBuffer();
  const { data } = await sharp(text).raw().toBuffer({ resolveWithObject: true });
  const dark = Buffer.alloc(size.width * size.height * 4);
  for (let i = 3; i < data.length; i += 4) dark[i] = Math.round(data[i]! * shadow.opacity);
  const blurPx = shadow.blur * MASTER.width * t.k;
  const shadowPng = await sharp(dark, { raw: { width: size.width, height: size.height, channels: 4 } }).blur(Math.max(0.3, blurPx / 2)).png().toBuffer();
  const offset = Math.round(shadow.dy * MASTER.width * t.k);
  const shadowShifted = await sharp({ create: blank }).composite([{ input: shadowPng, left: 0, top: offset }]).png().toBuffer();
  return sharp(shadowShifted).composite([{ input: text, left: 0, top: 0 }]).png().toBuffer();
}

export type RenderInput = {
  photo: Buffer;
  face: FaceLines | null;
  /** O20 rule 7, from face-detect's eyesMeasurable. */
  eyes?: { ok: boolean; why: string };
  /** Faces counted for the one-subject rule. */
  subjects: number;
  name: Piece;
  info: Piece[];
  lockup: Piece | null;
  shadow?: { dy: number; blur: number; opacity: number };
};

export type RenderResult = {
  master: Buffer;
  crop45: Buffer;
  square: Buffer;
  plan: CropPlan | null;
  layout: TextLayout;
  layoutCheck: LayoutCheck;
  rules: RuleResult[];
  pass: boolean;
  contrastShare: number;
  /** "photo extended top by N px …", "" when the photo covers the frame (O20 rule 8). */
  extensionLabel: string;
  /** The strip tests behind each extended edge. */
  strips: Partial<Record<Edge, StripStats>>;
  /** How far the 1:1's photo window had to shift sideways to stay inside the photo (px), 0 when it fit. */
  squareShift: number;
  /** The 1:1's photo scale relative to the master (0.8 unless the photo is too narrow to extend at the sides). */
  squarePhotoScale: number;
  headTopSource: "estimated" | "measured";
  /** Luminance stdev of the photo's top edge (0–255); under PLAIN_EDGE_STDEV the head top is measured on it. */
  edgeStdev: number;
};

/** The 48 px strip along one edge of the placed photo, at output scale, as luminance. */
async function stripLuminance(rotated: Buffer, photo: Size, c: Pick<ExtCandidate, "scale" | "left" | "top" | "extend">, edge: Edge, frame: Size): Promise<{ lum: Buffer; w: number; h: number } | null> {
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
    const { data } = await sharp(rotated).extract({ left: x0, top: 0, width: x1 - x0, height: Math.min(photo.height, Math.ceil(S / s)) }).resize(w, S, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    return { lum: data, w, h: S };
  }
  const py0 = Math.max(0, c.top - c.extend.top);
  const py1 = Math.min(photo.height * s, c.top + frame.height - c.extend.top);
  const y0 = Math.floor(py0 / s);
  const y1 = Math.min(photo.height, Math.ceil(py1 / s));
  const h = Math.round(py1 - py0);
  if (h < 3 || y1 <= y0) return null;
  const cols = Math.min(photo.width, Math.ceil(S / s));
  const left = edge === "left" ? 0 : photo.width - cols;
  const { data } = await sharp(rotated).extract({ left, top: y0, width: cols, height: y1 - y0 }).resize(S, h, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { lum: data, w: S, h };
}

/** Plan, judge and compose one card: 9:16 master, its 4:5 centre crop, and the 1:1 re-sit. */
export async function renderCard(input: RenderInput): Promise<RenderResult> {
  const sharp = await sharpLib();
  const frame = MASTER;
  const rotated = await sharp(input.photo).rotate().toBuffer();
  const meta = await sharp(rotated).metadata();
  const photo = { width: meta.width ?? 0, height: meta.height ?? 0 };
  const edgeRows = Math.max(1, Math.round(photo.height * 0.02));
  const edgeStats = await sharp(await sharp(rotated).extract({ left: 0, top: 0, width: photo.width, height: edgeRows }).greyscale().png().toBuffer()).stats();
  const edgeStdev = edgeStats.channels[0]!.stdev;
  let face = input.face;
  let headTopSource: "estimated" | "measured" = "estimated";
  if (face && edgeStdev < PLAIN_EDGE_STDEV && face.browY != null && face.box) {
    const raw = await sharp(rotated).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const measured = measureHeadTop(raw.data, raw.info.width, raw.info.height, raw.info.channels, { eyeX: face.eyeX, chinY: face.chinY, browY: face.browY, box: face.box });
    if (measured != null) {
      face = { ...face, headTopY: measured };
      headTopSource = "measured";
    }
  }

  // Placement: the photo alone when it can; otherwise the first O20 extension whose strips pass.
  let plan: CropPlan | null = null;
  let extensionNote = "";
  const strips: Partial<Record<Edge, StripStats>> = {};
  if (face) {
    const p0 = planFaceCrop(photo, face, frame);
    plan = p0;
    if (!placementOk(p0) && face.box) {
      const why = { blocker: "" };
      const candidates = extensionCandidates(photo, face as FaceForExtension, frame, why);
      const cache = new Map<string, StripStats | null>();
      let firstFail = "";
      let tested = 0;
      for (const c of candidates) {
        const edges = (["top", "left", "right"] as const).filter((e) => c.extend[e] > 0);
        const got: Partial<Record<Edge, StripStats>> = {};
        let ok = true;
        for (const edge of edges) {
          const key = `${edge}:${c.scale.toFixed(5)}:${edge === "top" ? "" : c.eyes.toFixed(4)}`;
          if (!cache.has(key)) {
            tested += 1;
            const strip = await stripLuminance(rotated, photo, c, edge, frame);
            cache.set(key, strip ? stripStats(strip.lum, strip.w, strip.h) : null);
          }
          const st = cache.get(key) ?? null;
          if (!st || !st.pass) {
            ok = false;
            if (!firstFail) firstFail = st ? `${edge} strip detail ${st.detailStdev.toFixed(1)} (max ${O20.maxDetailStdev}), Sobel > ${O20.sobelThreshold} on ${(st.sobelShare * 100).toFixed(1)} % (max ${O20.maxSobelShare * 100} %) at scale ${c.scale.toFixed(3)}` : `${edge} strip not visible`;
            break;
          }
          got[edge] = st;
        }
        if (ok) {
          plan = { scale: c.scale, left: c.left, top: c.top, headTop: c.headTop, eyes: c.eyes, chin: c.chin, clamped: { x: false, y: false }, extend: c.extend, faceWidthPx: c.faceWidthPx };
          Object.assign(strips, got);
          break;
        }
        if (tested >= 160) break;
      }
      if (plan === p0) extensionNote = candidates.length ? `no O20 extension passes the strip tests (first tried: ${firstFail})` : `no O20 extension fits: ${why.blocker}`;
    }
  }
  const crop = plan ?? planCover(photo, frame);
  const ext = crop.extend;
  const extended = ext.top + ext.left + ext.right > 0;

  /** The photo at k × the plan's scale, with the O20 extension when the plan has one. */
  const canvasAt = async (k: number): Promise<{ png: Buffer; width: number; height: number }> => {
    if (!extended) {
      const w = Math.max(1, Math.round(photo.width * crop.scale * k));
      const h = Math.max(1, Math.round(photo.height * crop.scale * k));
      return { png: await sharp(rotated).resize(w, h).removeAlpha().png().toBuffer(), width: w, height: h };
    }
    const w = Math.max(1, Math.round(photo.width * crop.scale));
    const h = Math.max(1, Math.round(photo.height * crop.scale));
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
    .extract({
      left: clampNum(Math.round(crop.left), 0, scaled.width - frame.width),
      top: clampNum(Math.round(crop.top), 0, scaled.height - frame.height),
      width: frame.width,
      height: frame.height,
    })
    .png()
    .toBuffer();
  // Contrast on the final pixels, extension included (O20 rule 6).
  const raw = await sharp(base).raw().toBuffer({ resolveWithObject: true });
  const contrastShare = lowContrastShare(raw.data, raw.info.width, raw.info.channels, textBoxRect(frame));
  const rules = judgePhoto({ contrastShare, subjects: input.subjects, plan, eyes: input.eyes, extensionNote });

  const layout = layoutText({ lockup: input.lockup, name: input.name, info: input.info }, frame);
  const pieces = [...(input.lockup ? [input.lockup] : []), input.name, ...input.info];
  const shadow = input.shadow ?? KIT_SHADOW;

  const overlay = await textOverlay(pieces, layout.all, frame, { k: 1, dx: 0, dy: 0 }, shadow);
  const master = await sharp(base).composite([{ input: overlay, left: 0, top: 0 }]).png().toBuffer();
  const crop45 = await sharp(master).extract({ left: 0, top: RECT_45.top, width: frame.width, height: RECT_45.bottom - RECT_45.top }).png().toBuffer();

  // 1:1 (O1): the 4:5 arrangement at 0.8×, centred, the photo extended at the sides.
  const k = 0.8;
  const side = 1080;
  const dx = (side - frame.width * k) / 2; // 108
  // A canvas too narrow to extend at the sides is scaled just enough to cover the square, anchored on the eyes.
  const kPhoto = Math.max(k, side / scaled.width, side / scaled.height);
  const small = await canvasAt(kPhoto);
  const anchor = { x: frame.width / 2, y: plan ? plan.eyes * frame.height : frame.height / 2 };
  const wantLeft = (crop.left + anchor.x) * kPhoto - (dx + anchor.x * k);
  const wantTop = (crop.top + anchor.y) * kPhoto - (anchor.y - RECT_45.top) * k;
  const sLeft = clampNum(Math.round(wantLeft), 0, small.width - side);
  const sTop = clampNum(Math.round(wantTop), 0, small.height - side);
  const squareBase = await sharp(small.png).extract({ left: sLeft, top: sTop, width: side, height: side }).png().toBuffer();
  const squareOverlay = await textOverlay(pieces, layout.all, { width: side, height: side }, { k, dx, dy: -RECT_45.top * k }, shadow);
  const square = await sharp(squareBase).composite([{ input: squareOverlay, left: 0, top: 0 }]).png().toBuffer();

  const layoutCheck = checkLayout(layout, frame);
  return {
    master,
    crop45,
    square,
    plan,
    layout,
    layoutCheck,
    rules,
    pass: rules.every((r) => r.pass) && layoutCheck.insideSafe && layoutCheck.insideTextBox,
    contrastShare,
    extensionLabel: extensionLabel(ext),
    strips,
    squareShift: Math.round(sLeft - wantLeft),
    squarePhotoScale: kPhoto,
    headTopSource,
    edgeStdev,
  };
}

function unionRect(rects: readonly Rect[]): Rect {
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.left + r.width));
  const bottom = Math.max(...rects.map((r) => r.top + r.height));
  return { left, top, width: right - left, height: bottom - top };
}

// ─── Drive routing and names ────────────────────────────────────────────────

export type CardStage = "presale" | "on-sale";
export type CardFormat = "9x16" | "4x5" | "1x1";

/**
 * Where a card goes in the event's tree (lib/drive/tree.ts keys): show week
 * from its Monday; on sale → the current cycle's Content; otherwise 2 Presale /
 * Presale live.
 */
export function cardFolderKey(input: { stage: CardStage; today: string; eventDate: string | null; cycleKeyFor: (today: string) => string; showWeekMonday: (eventDate: string | null) => string | null }): string {
  const showWeek = input.showWeekMonday(input.eventDate);
  if (showWeek && input.today >= showWeek) return "03/4";
  if (input.stage === "on-sale") return `${input.cycleKeyFor(input.today)}/content`;
  return "03/2/presale-live";
}

/** P26-BDAY_enzo-siragusa_artist-card-1_on-sale_9x16_v3.png (no _v suffix for version 1). */
export function cardFileName(input: { eventCode: string | null; artistSlug: string; pick: number; stage: CardStage; format: CardFormat; version?: number }): string {
  const v = input.version && input.version > 1 ? `_v${input.version}` : "";
  const body = `${input.artistSlug}_artist-card-${input.pick}_${input.stage}_${input.format}${v}.png`;
  return input.eventCode ? `${input.eventCode}_${body}` : body;
}
