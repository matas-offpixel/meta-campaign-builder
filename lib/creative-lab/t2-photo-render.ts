/**
 * T2 on the photo ground, rendered as stills (overlay templates issue 11,
 * O76–O82): sharp, no Remotion. The ground is the promoter's photo, cropped
 * to the 9:16 window and only ever scaled down (O82). Layers, bottom to top:
 * the photo, O81's three bands, O58's backing under the red line when needed,
 * the type (white Bootzy, coral ">", the red roll-call line; no stroke, no
 * shadow: O5), the logo, and the draft stamp.
 *
 * Formats: the 9:16 master (Stories); the 4:5 is its rectangle (O1), a pure
 * crop; the 1:1 is the master's centre square of ground with the type
 * re-sat at 0.8× (O1). The bands are stepped once per photo (the worst
 * format decides), the crop is the first whose faces clear every type box
 * in every format.
 *
 * The kit face is read as kit-font.ts / t1-lambda.ts deliver it; nothing here
 * copies or uploads a font.
 */


import { MASTER, RECT_45, lowContrastShare, type Rect, type Size } from "./artist-card.ts";
import { redLineVerdict, watermarkLayer } from "./artist-card-claim.ts";
import type { FontEntry } from "./kit-font.ts";
import { PUZZLE_FLOATING_T2, type T2Kit } from "./overlay-kits.ts";
import { applyBacking, backingLayer } from "./red-backing.ts";
import { RED_BACKING, backingRect, chooseBacking, type BackingBox, type RedVerdict } from "./t1-video.ts";
import { footageWindow } from "./t1-video-frame.ts";
import { setRuns, withMeasure } from "./t2-render.ts";
import {
  T2P,
  choosePhotoBandSteps,
  judgeStillFaces,
  photoBandAnchors,
  photoTooSmall,
  planPhotoLayout,
  renderPhotoBands,
  type BandSteps,
  type PhotoFormat,
  type PhotoLayout,
  type PhotoSlotsInput,
  type SlotShares,
} from "./t2-photo.ts";

type SharpFn = typeof import("sharp");
async function sharpLib(): Promise<SharpFn> {
  const m = await import("sharp");
  return ((m as unknown as { default: SharpFn }).default ?? (m as unknown as SharpFn)) as SharpFn;
}

export type PhotoStillInput = {
  /** The promoter's photo (owner = 'promoter', checked by the caller with photoGroundAllowed). */
  photo: Buffer;
  slots: PhotoSlotsInput;
  face: FontEntry;
  logoPng: Buffer;
  /** O77 / O36: the draft stamp, or null when everything on it is approved. */
  stamp: string | null;
  /** Faces on the source photo, source px (the caller runs the detector). */
  faces: readonly Rect[];
  /** Crop candidates, in order (the photo's own focus first). */
  cropFocusY: readonly number[];
  cropFocusX?: number;
  kit?: T2Kit;
};

export type PhotoStillReport = {
  crop: number | null;
  cropX: number | null;
  /** O82: formats whose type a counted face still touches at the chosen crop: drawn as flagged previews, with the line. */
  refused: Partial<Record<PhotoFormat, string>>;
  tried: string[];
  steps: BandSteps | null;
  shares: Partial<Record<"9:16" | "1:1", SlotShares>>;
  red: { verdict: RedVerdict; share: number } | null;
  layouts: Partial<Record<PhotoFormat, PhotoLayout>>;
  scale: number | null;
};

export type PhotoStillResult = { held: string | null; report: PhotoStillReport; images: Partial<Record<PhotoFormat, Buffer>> };

const pad = (r: Rect, p: number): Rect => ({ left: r.left - p, top: r.top - p, width: r.width + 2 * p, height: r.height + 2 * p });
const SQUARE_TOP = (MASTER.height - T2P.square.side) / 2;

/** The bands over a raw RGB(A) ground, in place of a composite (black over: v × (1 − a)). */
function withBands(ground: Buffer, size: Size, channels: number, layout: PhotoLayout, steps: BandSteps): Buffer {
  const band = renderPhotoBands(size, photoBandAnchors(layout), steps);
  const out = Buffer.from(ground);
  for (let i = 0, p = 0; p < size.width * size.height; p += 1, i += channels) {
    const a = band[p * 4 + 3]! / 255;
    if (a <= 0) continue;
    for (let c = 0; c < 3; c += 1) out[i + c] = Math.round(out[i + c]! * (1 - a));
  }
  return out;
}

function shares(data: Buffer, size: Size, channels: number, L: PhotoLayout): SlotShares {
  const b = L.boxes;
  return {
    lineup: lowContrastShare(data, size.width, channels, pad(b.lineup, 12)),
    block: lowContrastShare(data, size.width, channels, b.block),
    details: lowContrastShare(data, size.width, channels, pad(b.details, 12)),
    logo: lowContrastShare(data, size.width, channels, b.logo),
  };
}

const worst = (a: SlotShares, b: SlotShares): SlotShares => ({ lineup: Math.max(a.lineup, b.lineup), block: Math.max(a.block, b.block), details: Math.max(a.details, b.details), logo: Math.max(a.logo, b.logo) });

export async function renderPhotoStill(input: PhotoStillInput): Promise<PhotoStillResult> {
  const sharp = await sharpLib();
  const kit = input.kit ?? PUZZLE_FLOATING_T2;
  const report: PhotoStillReport = { crop: null, cropX: null, refused: {}, tried: [], steps: null, shares: {}, red: null, layouts: {}, scale: null };
  const meta = await sharp(input.photo).metadata();
  const source = { width: meta.width!, height: meta.height! };
  const cx = input.cropFocusX ?? 0.5;

  // O82: never upscaled.
  const small = photoTooSmall(source, "9:16", input.cropFocusY[0] ?? 0.5, cx);
  if (small) return { held: small, report, images: {} };

  const layouts = await withMeasure(input.face, (m) => ({
    "9:16": planPhotoLayout(input.slots, "still", "9:16", m, kit),
    "4:5": planPhotoLayout(input.slots, "still", "4:5", m, kit),
    "1:1": planPhotoLayout(input.slots, "still", "1:1", m, kit),
  }));
  for (const f of ["9:16", "4:5", "1:1"] as const) {
    const l = layouts[f];
    if (!l.ok) return { held: l.line, report, images: {} };
    report.layouts[f] = l.layout;
  }
  const L916 = report.layouts["9:16"]!;
  const L11 = report.layouts["1:1"]!;

  // O82: the crop moves the photo, never the type. Each distinct window (vertical and horizontal focus) is tried once; the
  // first whose counted faces clear every type box in every format is used, else the one that clears the most formats.
  // A format whose type a face still touches is drawn as a flagged preview with the line, never filed.
  const seen = new Set<string>();
  const cands: { cy: number; cx: number }[] = [];
  for (const cy of input.cropFocusY) {
    for (const x of [cx, 0.4, 0.6, 0.3, 0.7]) {
      const w = footageWindow(source, "9:16", cy, x);
      const key = `${Math.round(w.left)}:${Math.round(w.top)}`;
      if (!seen.has(key)) {
        seen.add(key);
        cands.push({ cy, cx: x });
      }
    }
  }
  let best: { cy: number; cx: number; k: number; fails: PhotoFormat[] } | null = null;
  for (const c of cands) {
    const win = footageWindow(source, "9:16", c.cy, c.cx);
    const k = MASTER.width / win.width;
    const onMaster = input.faces.map((f) => ({ left: (f.left - win.left) * k, top: (f.top - win.top) * k, width: f.width * k, height: f.height * k }));
    const verdicts: Record<PhotoFormat, boolean> = {
      "9:16": judgeStillFaces(onMaster, L916).ok,
      "4:5": judgeStillFaces(onMaster.map((f) => ({ ...f, top: f.top - RECT_45.top })), report.layouts["4:5"]!).ok,
      "1:1": judgeStillFaces(onMaster.map((f) => ({ ...f, top: f.top - SQUARE_TOP })), L11).ok,
    };
    const fails = (Object.keys(verdicts) as PhotoFormat[]).filter((f) => !verdicts[f]);
    report.tried.push(`crop y ${c.cy} x ${c.cx}: ${fails.length ? "face in the type" : "faces clear"} (9:16 ${verdicts["9:16"] ? "✓" : "✗"} · 4:5 ${verdicts["4:5"] ? "✓" : "✗"} · 1:1 ${verdicts["1:1"] ? "✓" : "✗"})`);
    if (!best || fails.length < best.fails.length) best = { ...c, k, fails };
    if (!fails.length) break;
  }
  report.crop = best!.cy;
  report.cropX = best!.cx;
  report.scale = best!.k;
  for (const f of best!.fails) report.refused[f] = "Face in the type — choose another crop or photo";

  // The ground: the 9:16 window, scaled down to the master (Lanczos); the 1:1's ground is its centre square at full size.
  const win = footageWindow(source, "9:16", best!.cy, best!.cx);
  const groundMaster = await sharp(input.photo).extract({ left: Math.round(win.left), top: Math.round(win.top), width: Math.round(win.width), height: Math.round(win.height) }).resize(MASTER.width, MASTER.height, { kernel: "lanczos3", fit: "fill" }).removeAlpha().png().toBuffer();
  const groundSquare = await sharp(groundMaster).extract({ left: 0, top: SQUARE_TOP, width: T2P.square.side, height: T2P.square.side }).png().toBuffer();
  const raw916 = await sharp(groundMaster).raw().toBuffer({ resolveWithObject: true });
  const raw11 = await sharp(groundSquare).raw().toBuffer({ resolveWithObject: true });
  const size11 = { width: T2P.square.side, height: T2P.square.side };

  // O81: the band steps, once per photo; the 9:16 and the 1:1 both measured (the 4:5 is the 9:16's crop).
  const bandsFor = (steps: BandSteps) => {
    const m = withBands(raw916.data, MASTER, raw916.info.channels, L916, steps);
    const q = withBands(raw11.data, size11, raw11.info.channels, L11, steps);
    return { m, q };
  };
  const chosen = choosePhotoBandSteps((steps) => {
    const { m, q } = bandsFor(steps);
    const a = shares(m, MASTER, raw916.info.channels, L916);
    const b = shares(q, size11, raw11.info.channels, L11);
    report.shares = { "9:16": a, "1:1": b };
    return worst(a, b);
  });
  report.steps = chosen.steps;
  if (!chosen.ok) return { held: chosen.line, report, images: {} };

  // O58 / O66: the red line (a roll-call's line 1) stays red: no backing, then 40 → 60 → 80 %, white only past 80 %.
  const { m: banded916, q: banded11 } = bandsFor(chosen.steps);
  let red: RedVerdict | null = null;
  const red916 = photoRedLine(L916);
  if (red916) {
    const red11 = photoRedLine(L11)!;
    const box916 = photoBackingFor(L916)!;
    const box11 = photoBackingFor(L11)!;
    const share = (op: number | null) =>
      Math.max(
        redLineVerdict(op == null ? banded916 : applyBacking(banded916, MASTER.width, MASTER.height, raw916.info.channels, box916, op), MASTER.width, raw916.info.channels, red916, MASTER).share,
        redLineVerdict(op == null ? banded11 : applyBacking(banded11, size11.width, size11.height, raw11.info.channels, box11, op), size11.width, raw11.info.channels, red11, size11).share,
      );
    const byStep = [share(null), ...RED_BACKING.steps.map((op) => share(op))];
    red = chooseBacking(byStep, "photo");
    report.red = { verdict: red, share: red.backing != null ? byStep[RED_BACKING.steps.indexOf(red.backing as 0.4 | 0.6 | 0.8) + 1]! : byStep[0]! };
  }

  const compose = async (L: PhotoLayout, groundRaw: { data: Buffer; info: { width: number; height: number; channels: number } }, banded: Buffer): Promise<Buffer> => {
    const layers = await photoTypeLayers(L, { face: input.face, logoPng: input.logoPng, kit, red, stamp: input.stamp });
    const base = await sharp(banded, { raw: { width: groundRaw.info.width, height: groundRaw.info.height, channels: groundRaw.info.channels as 3 | 4 } }).png().toBuffer();
    return sharp(base)
      .composite([...(layers.claim ? [{ input: layers.claim, left: 0, top: 0 }] : []), { input: layers.top, left: 0, top: 0 }])
      .png()
      .toBuffer();
  };
  const master = await compose(L916, raw916, banded916);
  const square = await compose(L11, raw11, banded11);
  const crop45 = await sharp(master).extract({ left: 0, top: RECT_45.top, width: MASTER.width, height: RECT_45.bottom - RECT_45.top }).png().toBuffer();
  return { held: null, report, images: { "9:16": master, "4:5": crop45, "1:1": square } };
}

/** The roll-call's red line on a layout (line 1 of the claim), or null. */
export const photoRedLine = (L: PhotoLayout) => L.block.lines.find((l) => l.color === "red" && l.role === "claim") ?? null;

/** O58 / O66 / O70: the backing under the red line, between the experience line above and the claim's line 2 below. */
export function photoBackingFor(L: PhotoLayout): BackingBox | null {
  const i = L.block.lines.findIndex((l) => l.color === "red" && l.role === "claim");
  if (i < 0) return null;
  const line = L.block.lines[i]!;
  const above = i > 0 ? L.block.lines[i - 1]!.capTop + L.block.lines[i - 1]!.capPx : undefined;
  const below = L.block.lines[i + 1]?.capTop;
  return backingRect(line, L.size.width, { above, below });
}

/**
 * The type as two transparent layers at the layout's size (O83): `top` — the
 * lineup, details, logo, experience line and draft stamp, on from frame 0 on
 * a clip; `claim` — the backing (when the red line takes one) and the
 * claim's lines, which fade in at 1.5 s on a clip. White Bootzy, coral ">",
 * the red roll-call line; no stroke, no shadow (O5, O89).
 */
export async function photoTypeLayers(L: PhotoLayout, opts: { face: FontEntry; logoPng: Buffer; kit?: T2Kit; red: RedVerdict | null; stamp: string | null }): Promise<{ top: Buffer; claim: Buffer | null }> {
  const sharp = await sharpLib();
  const kit = opts.kit ?? PUZZLE_FLOATING_T2;
  const top: { input: Buffer; left: number; top: number }[] = [];
  const claim: { input: Buffer; left: number; top: number }[] = [];
  const put = (to: typeof top, s: { png: Buffer; width: number; capTopRow: number }, left: number, capTop: number) => to.push({ input: s.png, left: Math.round(left), top: Math.round(capTop - s.capTopRow) });
  if (opts.red?.backing != null) {
    const box = photoBackingFor(L)!;
    claim.push({ input: await sharp(Buffer.from(backingLayer(L.size.width, L.size.height, box, opts.red.backing)), { raw: { width: L.size.width, height: L.size.height, channels: 4 } }).png().toBuffer(), left: 0, top: 0 });
  }
  for (const l of L.block.lines) {
    const colour = l.color === "red" && !opts.red?.white ? kit.colours.kitRed : kit.colours.white;
    const s = await setRuns([{ text: l.text, color: colour }], l.capPx, l.role === "experience" ? T2P.tracking.experience : T2P.tracking.claim, opts.face);
    put(l.role === "claim" ? claim : top, s, (L.size.width - s.width) / 2, l.capTop);
  }
  const right = Math.max(...L.lineup.map((l) => l.left + l.widthPx));
  for (const l of L.lineup) {
    const s = await setRuns([{ text: l.text, color: kit.colours.white }], l.capPx, T2P.tracking.lineup, opts.face);
    put(top, s, right - s.width, l.capTop);
  }
  for (const l of L.details) put(top, await setRuns(l.runs.map((r) => ({ text: r.text, color: r.coral ? kit.colours.coral : kit.colours.white })), l.capPx, T2P.tracking.details, opts.face), l.left, l.capTop);
  top.push({ input: await sharp(opts.logoPng).resize(Math.round(L.logo.width), Math.round(L.logo.height), { fit: "fill" }).png().toBuffer(), left: Math.round(L.logo.left), top: Math.round(L.logo.top) });
  const boxes = [L.boxes.lineup, L.boxes.block, L.boxes.details, L.boxes.logo];
  const within = L.format === "9:16" ? { left: 0, top: RECT_45.top, width: MASTER.width, height: RECT_45.bottom - RECT_45.top } : { left: 0, top: 0, width: L.size.width, height: L.size.height };
  if (opts.stamp) top.push({ input: await watermarkLayer(opts.stamp, L.size, opts.face.path, opts.face.family ?? "Bootzy Condensed TM", { avoid: boxes, within }), left: 0, top: 0 });
  const blank = () => sharp({ create: { width: L.size.width, height: L.size.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  return { top: await blank().composite(top).png().toBuffer(), claim: claim.length ? await blank().composite(claim).png().toBuffer() : null };
}
