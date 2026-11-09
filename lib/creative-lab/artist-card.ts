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
 *   face      the bands above
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
  "a face too high in its photo may drop by extending the photo upward with its own top edge (the top 2 % of rows averaged per column, blurred 0.8 % W sideways), only when that edge is plain (luminance stdev < 12 over its top 2 % of rows) and by at most 0.3 H; each card reports it",
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
  /** Top-left of the output frame in scaled-source pixels. */
  left: number;
  top: number;
  /** Positions on the frame as fractions of H. */
  headTop: number;
  eyes: number;
  chin: number;
  /** The photo ran out before the eyes reached their target. */
  clamped: { x: boolean; y: boolean };
  /** Output px of plain top edge extended above the photo so the face could drop into its band (0 when none). */
  extendTop: number;
};

/** At most this much (output px, 0.3 H) of a plain top edge may be repeated above a photo. */
export const MAX_EXTEND_TOP = Math.round(0.3 * 1920);

/**
 * The largest face the bands allow: with a = eyes − head top and b = chin −
 * eyes, the scale is capped by (eyes − 0.53 H) / a and (0.76 H − eyes) / b,
 * best when both meet; the eyes stay in 0.58–0.64 H. Never above 1.0×
 * (no upscaling), never below cover. Then the eyes are centred at 0.5 W and
 * the photo is clamped to cover the frame.
 */
export function planFaceCrop(photo: Size, face: FaceLines, frame: Size = MASTER, opts: { maxExtendTop?: number } = {}): CropPlan {
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
  // A face too high in the photo: repeat its plain top edge above it, when allowed.
  const extendTop = Math.max(0, Math.min(Math.ceil(-(face.eyeY * scale - eyes * H)), opts.maxExtendTop ?? 0));
  const wantTop = face.eyeY * scale + extendTop - eyes * H;
  const left = clampNum(wantLeft, 0, photo.width * scale - frame.width);
  const top = clampNum(wantTop, 0, photo.height * scale + extendTop - frame.height);
  const at = (y: number) => (y * scale + extendTop - top) / H;
  return {
    extendTop,
    scale,
    left,
    top,
    headTop: at(face.headTopY),
    eyes: at(face.eyeY),
    chin: at(face.chinY),
    clamped: { x: Math.abs(left - wantLeft) > 1, y: Math.abs(top - wantTop) > 1 },
  };
}

/** Cover, centred: for a photo with no face to place. */
export function planCover(photo: Size, frame: Size = MASTER): Omit<CropPlan, "headTop" | "eyes" | "chin"> {
  const scale = Math.max(frame.width / photo.width, frame.height / photo.height);
  return { scale, left: (photo.width * scale - frame.width) / 2, top: (photo.height * scale - frame.height) / 2, clamped: { x: false, y: false }, extendTop: 0 };
}

/**
 * Is the photo's top edge plain enough to repeat? The standard deviation of
 * luminance over its top 2 % of rows, in 0–255; under PLAIN_EDGE_STDEV the
 * edge is a backdrop (a wall, a sky gradient) and repeating it reads as more
 * backdrop.
 */
export const PLAIN_EDGE_STDEV = 12;

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

export type RuleResult = { rule: "contrast" | "subject" | "scale" | "face"; pass: boolean; detail: string };

export function judgePhoto(input: { contrastShare: number; subjects: number; plan: CropPlan | null }): RuleResult[] {
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
  const p = input.plan;
  out.push({ rule: "scale", pass: p.scale <= PHOTO_RULES.maxScale + 1e-9, detail: `${p.scale.toFixed(3)}× source` });
  const f = SLOTS.face;
  const misses = [
    p.headTop < f.headTopMin - 1e-3 ? `head top ${p.headTop.toFixed(3)} H above ${f.headTopMin}` : "",
    p.eyes < f.eyesMin - 1e-3 || p.eyes > f.eyesMax + 1e-3 ? `eyes ${p.eyes.toFixed(3)} H outside ${f.eyesMin}–${f.eyesMax}` : "",
    p.chin > f.chinMax + 1e-3 ? `chin ${p.chin.toFixed(3)} H below ${f.chinMax}` : "",
  ].filter(Boolean);
  out.push({
    rule: "face",
    pass: misses.length === 0,
    detail: misses.length ? misses.join("; ") : `head ${p.headTop.toFixed(3)} · eyes ${p.eyes.toFixed(3)} · chin ${p.chin.toFixed(3)} H`,
  });
  return out;
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
  /** How far the 1:1's photo window had to shift sideways to stay inside the photo (px), 0 when it fit. */
  squareShift: number;
  /** The 1:1's photo scale relative to the master (0.8 unless the photo is too narrow to extend at the sides). */
  squarePhotoScale: number;
  headTopSource: "estimated" | "measured";
  /** Luminance stdev of the photo's top edge (0–255); under PLAIN_EDGE_STDEV it may be repeated. */
  edgeStdev: number;
};

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
  const plain = edgeStdev < PLAIN_EDGE_STDEV;
  let face = input.face;
  let headTopSource: "estimated" | "measured" = "estimated";
  if (face && plain && face.browY != null && face.box) {
    const raw = await sharp(rotated).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const measured = measureHeadTop(raw.data, raw.info.width, raw.info.height, raw.info.channels, { eyeX: face.eyeX, chinY: face.chinY, browY: face.browY, box: face.box });
    if (measured != null) {
      face = { ...face, headTopY: measured };
      headTopSource = "measured";
    }
  }
  const plan = face ? planFaceCrop(photo, face, frame, { maxExtendTop: plain ? MAX_EXTEND_TOP : 0 }) : null;
  const crop = plan ?? planCover(photo, frame);

  const scaledAt = async (k: number) => {
    const w = Math.max(1, Math.round(photo.width * crop.scale * k));
    const h = Math.max(1, Math.round(photo.height * crop.scale * k));
    const ext = Math.round(crop.extendTop * k);
    const img = await sharp(rotated).resize(w, h).removeAlpha().png().toBuffer();
    if (ext <= 0) return { png: img, width: w, height: h };
    // The fill is the photo's top 2 % averaged per column, softened sideways,
    // stretched over the extension: repeating one raw row draws its noise as streaks.
    const strip = await sharp(img).extract({ left: 0, top: 0, width: w, height: Math.max(1, Math.round(h * 0.02)) }).png().toBuffer();
    const row = await sharp(strip).resize(w, 1, { fit: "fill", kernel: "cubic" }).png().toBuffer();
    const fill = await sharp(row).resize(w, ext, { fit: "fill", kernel: "nearest" }).blur(Math.max(1, w * 0.008)).png().toBuffer();
    const extended = await sharp({ create: { width: w, height: h + ext, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .composite([
        { input: fill, left: 0, top: 0 },
        { input: img, left: 0, top: ext },
      ])
      .png()
      .toBuffer();
    return { png: extended, width: w, height: h + ext };
  };
  const scaled = await scaledAt(1);
  const base = await sharp(scaled.png)
    .extract({
      left: clampNum(Math.round(crop.left), 0, scaled.width - frame.width),
      top: clampNum(Math.round(crop.top), 0, scaled.height - frame.height),
      width: frame.width,
      height: frame.height,
    })
    .png()
    .toBuffer();
  const raw = await sharp(base).raw().toBuffer({ resolveWithObject: true });
  const contrastShare = lowContrastShare(raw.data, raw.info.width, raw.info.channels, textBoxRect(frame));
  const rules = judgePhoto({ contrastShare, subjects: input.subjects, plan });

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
  // The photo extends at the sides at 0.8×; a photo too narrow for that is
  // scaled just enough to cover the square, anchored on the eyes.
  const kPhoto = Math.max(k, side / (photo.width * crop.scale), side / (photo.height * crop.scale + crop.extendTop));
  const small = await scaledAt(kPhoto);
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
