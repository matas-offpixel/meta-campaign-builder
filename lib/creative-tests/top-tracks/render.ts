/**
 * Top tracks, the render's Node side (HK1, docs/design-record/2026-11-18-creative-lab-top-tracks.html):
 * type set from the kit face with sharp, as T1 sets it (O52: the browser and
 * the Lambda site never see a font), the two bands as one dithered PNG
 * (O46), the press shot's placement from its face (TK7), the contrast steps
 * (TK8), the face test on every piece in every state, and the composition's
 * props. The composition is src/remotion/compositions/TopTracks.tsx.
 */

import sharp from "sharp";

import { renderCardLine } from "../../creative-lab/claim-slot.ts";
import type { FontEntry } from "../../creative-lab/kit-font.ts";
import { blueNoise } from "../../creative-lab/video-bands.ts";
import type { TopTracksProps, TTImage, TTRow } from "../../../src/remotion/compositions/TopTracks.tsx";
import {
  bandAlpha,
  judgeContrast,
  layoutEndCard,
  lineBox,
  p95Luminance,
  placeStill,
  relativeLuminance,
  textClearOfHead,
  insideBand,
  type EndCardLayout,
  type Rect,
} from "./layout.ts";
import type { ReelTimeline } from "./frame.ts";
import { TOP_TRACKS, type ListSide, type Measure, type PlacedLine, type ReelLayout } from "./reel.ts";

const W = TOP_TRACKS.width;
const H = TOP_TRACKS.height;

export type SetLine = { png: Buffer; width: number; height: number; capTopRow: number };

/** One line of type in the kit face at a cap height (claim-slot.ts renderCardLine: Puzzle's tracking, ink-trimmed sideways). */
export async function setLine(text: string, colour: string, capPx: number, face: FontEntry): Promise<SetLine> {
  const p = await renderCardLine(text, colour, capPx, face);
  return { png: p.png, width: p.width, height: p.height, capTopRow: p.capTopRow };
}

/**
 * A measure for layoutReel: every word (and a space) set once at cap 100,
 * then widths scale with the cap (tracking scales with size too). Words are
 * summed with the space between; a 2 % margin covers the kerning that the
 * sum leaves out, and the pieces are measured exactly once set.
 */
export async function wordMeasure(texts: readonly string[], face: FontEntry): Promise<Measure> {
  const words = new Set<string>();
  for (const t of texts) for (const w of t.split(/\s+/).filter(Boolean)) words.add(w);
  const widths = new Map<string, number>();
  for (const w of words) widths.set(w, (await setLine(w, "#FFFFFF", 100, face)).width);
  const hh = (await setLine("H H", "#FFFFFF", 100, face)).width;
  const h = (await setLine("H", "#FFFFFF", 100, face)).width;
  const space = Math.max(0, hh - 2 * h);
  return (text, capPx) => {
    const parts = text.split(/\s+/).filter(Boolean);
    const at100 = parts.reduce((s, w) => s + (widths.get(w) ?? w.length * 45), 0) + space * Math.max(0, parts.length - 1);
    return (at100 * capPx * 1.02) / 100;
  };
}

/** The bands at a side-band step as one 1080 × 1920 RGBA PNG, black with straight alpha, dithered with the fixed blue-noise map (O46). */
export async function bandsPng(side: ListSide, step: number): Promise<Buffer> {
  const noise = blueNoise(32, 1.5);
  const data = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const a16 = Math.round(bandAlpha(x, y, side, step) * 65535);
      data[(y * W + x) * 4 + 3] = Math.min(255, Math.floor(a16 / 257 + noise[(y % 32) * 32 + (x % 32)]!));
    }
  }
  return sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

export const dataUri = (png: Buffer, mime = "image/png") => `data:${mime};base64,${png.toString("base64")}`;

/** A placed line as an image the composition places: the cap top on the line's cap top. */
export async function pieceFor(line: PlacedLine, colour: string, face: FontEntry): Promise<{ img: TTImage; box: Rect }> {
  const s = await setLine(line.text, colour, line.capPx, face);
  return { img: { url: dataUri(s.png), left: Math.round(line.left), top: Math.round(line.capTop - s.capTopRow), width: s.width, height: s.height }, box: { left: line.left, top: line.capTop, width: s.width, height: line.capPx } };
}

/** An image piece (the kit's lockup or date line) scaled to a width, at a top-left. */
export async function imagePiece(png: Buffer, at: { left: number; top: number; width: number }): Promise<{ img: TTImage; box: Rect; height: number }> {
  const meta = await sharp(png).metadata();
  const height = Math.round(((meta.height ?? 1) * at.width) / (meta.width ?? 1));
  const resized = await sharp(png).resize({ width: Math.round(at.width), height }).png().toBuffer();
  return { img: { url: dataUri(resized), left: Math.round(at.left), top: Math.round(at.top), width: Math.round(at.width), height }, box: { left: at.left, top: at.top, width: at.width, height }, height };
}

export type StillVerdict =
  | { ok: true; placed: { scale: number; left: number; top: number; push: boolean }; head: Rect; pushOrigin: { x: number; y: number }; rgb: { data: Uint8Array; width: number; height: number; channels: number } }
  | { ok: false; refusal: "cant_clear"; side: "left" | "right" }
  | { ok: false; refusal: "head_on_list" }
  | { ok: false; refusal: "no_face" };

/** TK7: the press shot placed from its main face (the largest), with the face box as the head and the frame's pixels for TK8. */
export async function placePressShot(photo: Buffer, face: { box: { x: number; y: number; width: number; height: number }; eyeY: number; headTopY: number; chinY: number } | null, list: ListSide): Promise<StillVerdict> {
  if (!face) return { ok: false, refusal: "no_face" };
  const meta = await sharp(photo).metadata();
  const size = { width: meta.width ?? 0, height: meta.height ?? 0 };
  const placed = placeStill(size, { box: { left: face.box.x, top: face.box.y, width: face.box.width, height: face.box.height }, eyesY: face.eyeY }, list);
  if ("refused" in placed) return placed.refused === "cant_clear" ? { ok: false, refusal: "cant_clear", side: placed.side } : { ok: false, refusal: "head_on_list" };
  const k = placed.scale;
  // The head: from the head's top to the chin, the face box's width, on the frame.
  const head: Rect = { left: placed.left + face.box.x * k, top: placed.top + Math.min(face.headTopY, face.box.y) * k, width: face.box.width * k, height: (Math.max(face.chinY, face.box.y + face.box.height) - Math.min(face.headTopY, face.box.y)) * k };
  // The frame as the reel shows it at its largest push (1.04), for the contrast and face tests.
  const sw = Math.round(size.width * k);
  const sh = Math.round(size.height * k);
  // The part of the scaled photo inside the frame (a side extension leaves black, O119).
  const x0 = Math.max(0, -Math.round(placed.left));
  const y0 = Math.max(0, -Math.round(placed.top));
  const cw = Math.min(sw - x0, W - Math.max(0, Math.round(placed.left)));
  const ch = Math.min(sh - y0, H - Math.max(0, Math.round(placed.top)));
  const visible = await sharp(photo).rotate().resize({ width: sw, height: sh }).extract({ left: x0, top: y0, width: cw, height: ch }).toBuffer();
  const frame = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: visible, left: Math.max(0, Math.round(placed.left)), top: Math.max(0, Math.round(placed.top)) }])
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { ok: true, placed, head, pushOrigin: { x: head.left + head.width / 2, y: head.top + head.height / 2 }, rgb: { data: new Uint8Array(frame.data), width: frame.info.width, height: frame.info.height, channels: frame.info.channels } };
}

/** The head box at the push's end: scaled 1.04 about the push origin. */
export function pushedHead(head: Rect, origin: { x: number; y: number }, k = 1.04): Rect {
  return { left: origin.x + (head.left - origin.x) * k, top: origin.y + (head.top - origin.y) * k, width: head.width * k, height: head.height * k };
}

export type Verdicts = { step: number; accentWhite: boolean; faceOk: boolean; bandOk: boolean; p95ByStep: number[] };

/** TK7 + TK8 over every text piece: the face test (still: O118, at the push's start and end) and the contrast steps. */
export function judgeStill(boxes: readonly Rect[], still: Extract<StillVerdict, { ok: true }>, list: ListSide, accentHex: string): Verdicts | { refused: "busy"; p95ByStep: number[] } {
  const p95ByStep = [0, 1, 2].map((s) => p95Luminance(still.rgb, boxes, list, s));
  const hex = accentHex.replace("#", "");
  const accent = relativeLuminance(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16));
  const c = judgeContrast(p95ByStep, accent);
  if ("refused" in c) return { refused: "busy", p95ByStep: p95ByStep.map((x) => Math.round(x * 1000) / 1000) };
  const faceOk = textClearOfHead(boxes, still.head) && (!still.placed.push || textClearOfHead(boxes, pushedHead(still.head, still.pushOrigin)));
  return { step: c.step, accentWhite: c.accentWhite, faceOk, bandOk: insideBand(boxes), p95ByStep: p95ByStep.map((x) => Math.round(x * 1000) / 1000) };
}

/** The rows as the composition wants them, set from the kit face: white markers and their accent copies, titles, "with" lines. */
export async function setRows(layout: ReelLayout, face: FontEntry, accentHex: string): Promise<{ rows: TTRow[]; boxes: Rect[] }> {
  const rows: TTRow[] = [];
  const boxes: Rect[] = [];
  for (const r of layout.rows) {
    const marker = r.marker ? await pieceFor(r.marker, "#FFFFFF", face) : null;
    const markerAccent = r.marker ? await pieceFor(r.marker, accentHex, face) : null;
    const title = await Promise.all(r.title.map((l) => pieceFor(l, "#FFFFFF", face)));
    const withLine = await Promise.all(r.withLine.map((l) => pieceFor(l, "#FFFFFF", face)));
    // The title slides 24 px in from the list's outer side: its box covers the slide.
    for (const p of [...title, ...withLine]) boxes.push({ ...p.box, left: p.box.left - 24, width: p.box.width + 24 });
    if (marker) boxes.push(marker.box);
    const all = [...title, ...withLine, ...(marker ? [marker] : [])].map((p) => p.box);
    const top = Math.min(...all.map((b) => b.top));
    const bottom = Math.max(...all.map((b) => b.top + b.height));
    const lastTitle = r.title[r.title.length - 1]!;
    rows.push({ marker: marker?.img ?? null, markerAccent: markerAccent?.img ?? null, title: title.map((p) => p.img), withLine: withLine.map((p) => p.img), top, bottom, ruleTop: Math.round(lastTitle.capTop + lastTitle.capPx) });
  }
  return { rows, boxes };
}

/** TK9's date end in the list's column: the kit's lockup and date line as images (O54, verbatim), the name and claim set. */
export async function setEndCard(input: { layout: EndCardLayout; lockupPng: Buffer | null; datePng: Buffer | null; face: FontEntry }): Promise<{ pieces: TTImage[]; boxes: Rect[] }> {
  const pieces: TTImage[] = [];
  const boxes: Rect[] = [];
  const { layout } = input;
  if (input.lockupPng) {
    const p = await imagePiece(input.lockupPng, layout.lockup);
    pieces.push(p.img);
    boxes.push(p.box);
  }
  for (const l of layout.name) {
    const p = await pieceFor(l, "#FFFFFF", input.face);
    pieces.push(p.img);
    boxes.push(p.box);
  }
  if (layout.date) {
    if (input.datePng) {
      const meta = await sharp(input.datePng).metadata();
      const scale = layout.date.capPx / Math.max(1, (meta.height ?? 1) * 0.72);
      const p = await imagePiece(input.datePng, { left: layout.date.left, top: layout.date.capTop, width: Math.min((meta.width ?? 1) * scale, layout.lockup.width * 3) });
      pieces.push(p.img);
      boxes.push(p.box);
    } else {
      const p = await pieceFor(layout.date, "#FFFFFF", input.face);
      pieces.push(p.img);
      boxes.push(p.box);
    }
  }
  for (const l of layout.claim) {
    const p = await pieceFor(l, "#FFFFFF", input.face);
    pieces.push(p.img);
    boxes.push(p.box);
  }
  return { pieces, boxes };
}

export { layoutEndCard, lineBox };

export type PropsInput = {
  durationS: number;
  background: TopTracksProps["background"];
  bandsPng: Buffer;
  headline: TTImage[];
  rows: TTRow[];
  playRows: number[];
  timeline: ReelTimeline;
  rowsAppear: TopTracksProps["rowsAppear"];
  end: TopTracksProps["end"];
  list: ListSide;
  barColour: string;
  column: { left: number; right: number };
  endCard: TTImage[] | null;
  stamp: TTImage | null;
};

export function topTracksProps(p: PropsInput): TopTracksProps {
  return {
    fps: TOP_TRACKS.fps,
    durationInSeconds: p.durationS,
    background: p.background,
    bandsUrl: dataUri(p.bandsPng),
    headline: p.headline,
    rows: p.rows,
    playRows: p.playRows,
    timeline: p.timeline,
    rowsAppear: p.rowsAppear,
    end: p.end,
    list: p.list,
    barColour: p.barColour,
    barLeft: p.list === "left" ? TOP_TRACKS.band.left : TOP_TRACKS.band.right - 6,
    column: { left: p.column.left, width: p.column.right - p.column.left },
    endCard: p.endCard,
    stamp: p.stamp,
  };
}
