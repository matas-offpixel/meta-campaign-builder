/**
 * Draft artist card: a press photo filling the frame on a face-aware crop,
 * with the artwork's own pieces on top — the artist's name large, the date /
 * venue / city small, the brand logo. Prototype for design to judge; it never
 * enters a Lab round and never goes to Meta.
 *
 * Layout is T1 (artist clip) of the floating kit, per the overlay-templates
 * record (docs/design-record/2026-11-08-overlay-templates.html): an artist
 * card is a T1 with its claim set (O10). Composed once at 9:16 1080×1920; the
 * 4:5 is a pure centre crop of that master (O1), so every slot and the face
 * sit inside the 4:5 rectangle (y 285–1635).
 *
 *   name     cap 0.1146 H, centre 0.232 H, max 0.80 W, steps down to 0.06 H (O3)
 *   details  block 0.3036–0.4391 H, centre 0.371 H, max 0.328 W, cap 0.031 H (O3, T1 row)
 *   face     between the details box and the claim box: 0.4391–0.7536 H
 *            (O3's own boxes; O3 calls the middle 0.44–0.70 H text-free)
 *   logo     no claim on a card, so the logo takes the claim slot: centre
 *            0.7732 H, 0.15 W wide (T2's logo width) — invented, see INVENTED
 *   edge     pieces from the PSD carry no layer effects, so each gets the
 *            kit's shadow once: straight down 0.007 W, blur 0.009 W, 25 % black (O6)
 *
 * Pieces are placed by their ink box at a uniform scale, never stretched,
 * never scaled up past their own pixels (a piece that would need it is
 * reported, not enlarged). No text is rendered here.
 */

import type { FaceBox } from "./face-detect.ts";

// ─── Slots ──────────────────────────────────────────────────────────────────

export const MASTER = { width: 1080, height: 1920 } as const;
export const RECT_45 = { top: 285, bottom: 1635 } as const;

export const SLOTS = {
  name: { centreY: 0.232, cap: 0.1146, floorCap: 0.06, maxWidth: 0.8, box: [0.175, 0.2891] as const },
  details: { centreY: 0.371, cap: 0.031, maxWidth: 0.328, box: [0.3036, 0.4391] as const },
  face: { top: 0.4391, bottom: 0.7536 },
  logo: { centreY: 0.7732, width: 0.15 },
  sideMargin: 0.07,
} as const;

export const KIT_SHADOW = { dy: 0.007, blur: 0.009, opacity: 0.25 } as const;

/** Values on the card that no asset, PSD or record gives. */
export const INVENTED = [
  "logo in the claim slot (centre 0.7732 H): T1 has no logo slot. Its size is T2's logo width (0.15 W) given to the PUZZLE wordmark; the PSD's wordmark and \"4th Birthday\" script are one layer, so the whole lockup is placed",
  "face target: centred on the gap between the details and claim boxes (0.596 H), face height 0.13 H when the photo allows (the detector's box, brow to chin)",
  "details lines stacked at 1.45× their cap height when the PSD gives separate line pieces",
] as const;

// ─── Photo crop ─────────────────────────────────────────────────────────────

export type Size = { width: number; height: number };
export type Rect = { left: number; top: number; width: number; height: number };

export type CropPlan = {
  /** Scale from source pixels to output pixels. */
  scale: number;
  /** Top-left of the output frame in scaled-source pixels. */
  left: number;
  top: number;
  /** The face in output pixels. */
  face: Rect;
  /** The face could not reach its target (the photo ran out on that side). */
  clamped: { x: boolean; y: boolean };
  /** Output pixels per source pixel above 1 means the photo is enlarged. */
  upscaled: boolean;
};

export type FaceTarget = { centreX: number; centreY: number; faceHeight: number };
export const FACE_TARGET: FaceTarget = { centreX: 0.5, centreY: (SLOTS.face.top + SLOTS.face.bottom) / 2, faceHeight: 0.13 };

/**
 * Cover the frame with the photo, scaled so the face reaches the target height
 * (never below cover), then shifted so the face centre lands on the target,
 * clamped so the photo still covers the frame. When the photo runs out on one
 * side (a face high in a portrait shot), zoom in further until the face centre
 * can reach the target, but never past a face as tall as the face band
 * (0.3145 H). Without a face: cover, centred.
 */
export function planPhotoCrop(photo: Size, face: Pick<FaceBox, "x" | "y" | "width" | "height"> | null, frame: Size, target: FaceTarget = FACE_TARGET): CropPlan {
  const cover = Math.max(frame.width / photo.width, frame.height / photo.height);
  if (!face || face.height <= 0) return place(photo, null, frame, target, cover);
  const maxScale = Math.max(cover, ((SLOTS.face.bottom - SLOTS.face.top) * frame.height) / face.height);
  let scale = Math.min(maxScale, Math.max(cover, (target.faceHeight * frame.height) / face.height));
  const fcx = face.x + face.width / 2;
  const fcy = face.y + face.height / 2;
  // Scale at which the face centre can reach the target with the photo still covering each edge.
  const needs = [
    (target.centreY * frame.height) / fcy, // top edge at 0
    ((1 - target.centreY) * frame.height) / (photo.height - fcy), // bottom edge at the frame's bottom
    (target.centreX * frame.width) / fcx,
    ((1 - target.centreX) * frame.width) / (photo.width - fcx),
  ].filter((v) => Number.isFinite(v) && v > 0);
  scale = Math.min(maxScale, Math.max(scale, ...needs));
  return place(photo, face, frame, target, scale);
}

function place(photo: Size, face: Pick<FaceBox, "x" | "y" | "width" | "height"> | null, frame: Size, target: FaceTarget, scale: number): CropPlan {
  const faceBox = face ?? { x: photo.width / 2, y: photo.height / 2, width: 0, height: 0 };
  const scaledW = photo.width * scale;
  const scaledH = photo.height * scale;
  const fcx = (faceBox.x + faceBox.width / 2) * scale;
  const fcy = (faceBox.y + faceBox.height / 2) * scale;
  const wantLeft = fcx - target.centreX * frame.width;
  const wantTop = fcy - target.centreY * frame.height;
  const left = clamp(wantLeft, 0, scaledW - frame.width);
  const top = clamp(wantTop, 0, scaledH - frame.height);
  return {
    scale,
    left,
    top,
    face: { left: faceBox.x * scale - left, top: faceBox.y * scale - top, width: faceBox.width * scale, height: faceBox.height * scale },
    clamped: { x: Math.abs(left - wantLeft) > 1, y: Math.abs(top - wantTop) > 1 },
    upscaled: scale > 1.0001,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

// ─── Piece placement ────────────────────────────────────────────────────────

export type Piece = {
  /** PNG bytes, trimmed to the ink box. */
  png: Buffer;
  width: number;
  height: number;
  /** The cap height of the piece's text in its own pixels (≈ the ink height for an all-caps line). */
  capPx: number;
  label: string;
};

export type Placement = {
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
  /** The piece would have to be enlarged to reach the slot's size; it was placed at 1:1 instead. */
  short: boolean;
  /** The size stepped down to fit the slot's width. */
  stepped: boolean;
  /** Stepped below the slot's floor (the name should break onto two lines; the piece is one line). */
  belowFloor: boolean;
};

/**
 * Scale for a piece in a slot: the slot's cap, stepped down to the max width,
 * capped at 1 (no enlargement).
 */
export function pieceScale(piece: Pick<Piece, "width" | "capPx">, slot: { cap: number; maxWidth: number; floorCap?: number }, frame: Size): { scale: number; short: boolean; stepped: boolean; belowFloor: boolean } {
  const wantCap = slot.cap * frame.height;
  let scale = wantCap / piece.capPx;
  let stepped = false;
  const maxW = slot.maxWidth * frame.width;
  if (piece.width * scale > maxW) {
    scale = maxW / piece.width;
    stepped = true;
  }
  const belowFloor = slot.floorCap != null && piece.capPx * scale < slot.floorCap * frame.height - 0.5;
  const short = scale > 1.0001;
  return { scale: Math.min(scale, 1), short, stepped, belowFloor };
}

export function placeCentred(piece: Pick<Piece, "width" | "height" | "label">, scale: number, centreY: number, frame: Size, flags: Pick<Placement, "short" | "stepped" | "belowFloor">): Placement {
  const width = Math.round(piece.width * scale);
  const height = Math.round(piece.height * scale);
  return {
    label: piece.label,
    left: Math.round((frame.width - width) / 2),
    top: Math.round(centreY - height / 2),
    width,
    height,
    scale,
    ...flags,
  };
}

/**
 * The details block: line pieces stacked centred at a common scale (the slot's
 * cap on the tallest cap, stepped to the slot width), pitch 1.45 × cap.
 */
export function placeDetails(lines: readonly Piece[], frame: Size): Placement[] {
  if (!lines.length) return [];
  const capPx = Math.max(...lines.map((l) => l.capPx));
  const widest = Math.max(...lines.map((l) => l.width));
  const fit = pieceScale({ width: widest, capPx }, SLOTS.details, frame);
  const pitch = capPx * fit.scale * 1.45;
  const heights = lines.map((l) => l.height * fit.scale);
  const total = pitch * (lines.length - 1) + heights.at(-1)!;
  const top0 = SLOTS.details.centreY * frame.height - total / 2;
  return lines.map((line, i) => {
    const p = placeCentred(line, fit.scale, 0, frame, fit);
    return { ...p, top: Math.round(top0 + pitch * i) };
  });
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

export type CardCheck = {
  faceInFaceBand: boolean;
  faceInside45: boolean;
  faceCovered: string[];
  outside45: string[];
  tooCloseToEdge: string[];
};

/** Is the face clear of every piece, and is every key piece inside the 4:5 rectangle? */
export function checkCard(face: Rect | null, placements: readonly Placement[], frame: Size = MASTER): CardCheck {
  const marginPx = SLOTS.sideMargin * frame.width;
  const faceCovered = face ? placements.filter((p) => overlaps(face, p)).map((p) => p.label) : [];
  return {
    faceInFaceBand: face ? face.top >= SLOTS.face.top * frame.height - 1 && face.top + face.height <= SLOTS.face.bottom * frame.height + 1 : false,
    faceInside45: face ? face.top >= RECT_45.top && face.top + face.height <= RECT_45.bottom : false,
    faceCovered,
    outside45: placements.filter((p) => p.top < RECT_45.top || p.top + p.height > RECT_45.bottom).map((p) => p.label),
    tooCloseToEdge: placements.filter((p) => p.left < marginPx - 0.5 || p.left + p.width > frame.width - marginPx + 0.5).map((p) => p.label),
  };
}

// ─── Rendering (sharp) ──────────────────────────────────────────────────────

type Sharp = typeof import("sharp");
let sharpModule: Promise<Sharp> | null = null;
async function sharpLib(): Promise<Sharp> {
  sharpModule ??= import("sharp").then((m) => (m as unknown as { default: Sharp }).default ?? (m as unknown as Sharp));
  return sharpModule;
}

/** Trim a PNG to its ink box (alpha > 8). Returns the trimmed bytes and size. */
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

/** The piece's shadow: its alpha in black at `opacity`, blurred, on a padded canvas. */
async function shadowOf(png: Buffer, width: number, height: number, blurPx: number, opacity: number): Promise<{ png: Buffer; pad: number }> {
  const sharp = await sharpLib();
  const pad = Math.ceil(blurPx * 3);
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc((width + pad * 2) * (height + pad * 2) * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = data[(y * width + x) * 4 + 3]!;
      out[((y + pad) * (width + pad * 2) + (x + pad)) * 4 + 3] = Math.round(a * opacity);
    }
  }
  const sigma = Math.max(0.3, blurPx / 2);
  const blurred = await sharp(out, { raw: { width: width + pad * 2, height: height + pad * 2, channels: 4 } }).blur(sigma).png().toBuffer();
  return { png: blurred, pad };
}

export type RenderInput = {
  photo: Buffer;
  face: FaceBox | null;
  name: Piece;
  details: Piece[];
  logo: Piece | null;
  /** The logo piece's width as a fraction of W (default SLOTS.logo.width). */
  logoWidth?: number;
  /** Override the kit shadow (e.g. the PSD layer's own drop shadow), as fractions of W. */
  shadow?: { dy: number; blur: number; opacity: number };
};

export type RenderResult = {
  master: Buffer;
  crop45: Buffer;
  plan: CropPlan;
  placements: Placement[];
  check: CardCheck;
  /** Mean luminance (0–255) of the photo under the name and details boxes, before the pieces. */
  backdrop: { name: number; details: number };
};

/** Compose the 9:16 master and its 4:5 centre crop. */
export async function renderCard(input: RenderInput): Promise<RenderResult> {
  const sharp = await sharpLib();
  const frame = MASTER;
  const rotated = await sharp(input.photo).rotate().toBuffer();
  const meta = await sharp(rotated).metadata();
  const photo = { width: meta.width ?? 0, height: meta.height ?? 0 };
  const plan = planPhotoCrop(photo, input.face, frame);
  const base = await sharp(rotated)
    .resize(Math.round(photo.width * plan.scale), Math.round(photo.height * plan.scale))
    .extract({ left: Math.round(plan.left), top: Math.round(plan.top), width: frame.width, height: frame.height })
    .removeAlpha()
    .png()
    .toBuffer();

  const nameFit = pieceScale(input.name, SLOTS.name, frame);
  const placements: Placement[] = [placeCentred(input.name, nameFit.scale, SLOTS.name.centreY * frame.height, frame, nameFit)];
  const detailPlacements = placeDetails(input.details, frame);
  placements.push(...detailPlacements);
  if (input.logo) {
    const want = ((input.logoWidth ?? SLOTS.logo.width) * frame.width) / input.logo.width;
    placements.push(placeCentred(input.logo, Math.min(want, 1), SLOTS.logo.centreY * frame.height, frame, { short: want > 1.0001, stepped: false, belowFloor: false }));
  }

  const backdrop = {
    name: await meanLuma(base, frame, placements[0]!),
    details: detailPlacements.length ? await meanLuma(base, frame, unionRect(detailPlacements)) : 0,
  };

  const shadow = input.shadow ?? KIT_SHADOW;
  const pieces = [input.name, ...input.details, ...(input.logo ? [input.logo] : [])];
  const layers: { input: Buffer; left: number; top: number }[] = [];
  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i]!;
    const at = placements[i]!;
    const scaled = await sharp(piece.png).resize(at.width, at.height, { kernel: "lanczos3" }).png().toBuffer();
    const sh = await shadowOf(scaled, at.width, at.height, shadow.blur * frame.width, shadow.opacity);
    layers.push({ input: sh.png, left: at.left - sh.pad, top: Math.round(at.top + shadow.dy * frame.width) - sh.pad });
    layers.push({ input: scaled, left: at.left, top: at.top });
  }
  const master = await sharp(base).composite(layers).png().toBuffer();
  const crop45 = await sharp(master).extract({ left: 0, top: RECT_45.top, width: frame.width, height: RECT_45.bottom - RECT_45.top }).png().toBuffer();
  return { master, crop45, plan, placements, check: checkCard(plan.face, placements, frame), backdrop };
}

function unionRect(rects: readonly Rect[]): Rect {
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.left + r.width));
  const bottom = Math.max(...rects.map((r) => r.top + r.height));
  return { left, top, width: right - left, height: bottom - top };
}

async function meanLuma(image: Buffer, frame: Size, rect: Rect): Promise<number> {
  const sharp = await sharpLib();
  const left = clamp(Math.round(rect.left), 0, frame.width - 1);
  const top = clamp(Math.round(rect.top), 0, frame.height - 1);
  const width = clamp(Math.round(rect.width), 1, frame.width - left);
  const height = clamp(Math.round(rect.height), 1, frame.height - top);
  // stats() reads its input, not the pipeline, so the region is cut out first.
  const region = await sharp(image).extract({ left, top, width, height }).greyscale().png().toBuffer();
  const stats = await sharp(region).stats();
  return Math.round(stats.channels[0]!.mean);
}

// ─── Drive routing and names ────────────────────────────────────────────────

export type CardStage = "presale" | "on-sale";

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

/** P26-BDAY_enzo-siragusa_artist-card-1_on-sale_9x16.png */
export function cardFileName(input: { eventCode: string | null; artistSlug: string; pick: number; stage: CardStage; format: "9x16" | "4x5" }): string {
  const body = `${input.artistSlug}_artist-card-${input.pick}_${input.stage}_${input.format}.png`;
  return input.eventCode ? `${input.eventCode}_${body}` : body;
}
