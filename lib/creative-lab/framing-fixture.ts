/**
 * The fixture behind frames AF-A, AF-B and AF-C (overlay-templates issue 17)
 * and the framing tests. This repository is public, so it holds no press
 * photo and no kit: the photo is a drawn stand-in figure with the face's
 * proportions of the record's measured Luke Dean card (eyes about 0.13 H
 * below the head's top and above the chin in the 4:5), and every piece of
 * type is set in the app's own TikTok Sans (OFL, src/remotion/fonts). The
 * claim face is TikTok Sans indexed under the kit face's name so the real
 * composers run unchanged. The face lines are the drawing's own, not a
 * detector's: no model runs here.
 *
 * Before and after are the code's own output on the same fixture: the 9:16
 * (unchanged), its old 4:5 band and O1's old 1:1 re-sit (legacySquare, kept
 * here for the before frame only), and the new 4:5 and 1:1. AF-C is one
 * frame at 2 s of a drawn clip shot from behind: the head box is the drawn
 * head's (what the person mask's top 0.18 gives on it), and the layout is
 * O120's decision on it.
 *
 * No `@/` imports (node --test).
 */

import { join } from "node:path";

import { KIT_SHADOW, RECT_45, layoutText, textOverlay, trimToInk, type Piece, type Placement, type Rect } from "./artist-card.ts";
import { CLAIM_FACE_BAND, type ClaimCardInput, type ClaimCardResult } from "./artist-card-claim.ts";
import { KIT_RED, KIT_WHITE, renderCardLine } from "./claim-slot.ts";
import { headOf, planHeadCrop, toOutput, type HeadSample } from "./clip-head.ts";
import { indexFonts, type FontEntry } from "./kit-font.ts";
import { DEFAULT_GRADIENT_SHADOW, renderGradientShadow } from "./overlay-gradient.ts";
import { clipBands, footageWindow, judgeFaceOverTime, planClipLayout, planVideoClaim, type ClipLayout, type VideoClaimPlan } from "./t1-video.ts";

export const FIXTURE_ROOT = process.cwd();
const FONT_DIR = () => join(FIXTURE_ROOT, "src", "remotion", "fonts");

/**
 * A selling-fast roll-call (O27's shape, as on P26-BDAY), shortened: TikTok
 * Sans is far wider than the kit's condensed face, and P26's full roll-call
 * would be held as too long in it.
 */
export const FIXTURE_CLAIM = "EARLY BIRD SOLD OUT\nSELLING FAST";

// ─── The photo ──────────────────────────────────────────────────────────────

export const FIXTURE_PHOTO = { width: 1500, height: 2400 } as const;
/** The drawn face, photo px: head top 1250, eyes 1450, chin 1650; the box is ear to ear, brow to chin. */
export const FIXTURE_FACE = {
  eyeX: 750,
  eyeY: 1450,
  headTopY: 1250,
  browY: 1400,
  chinY: 1650,
  box: { x: 615, y: 1330, width: 270, height: 330 },
} as const;

/** A press-photo stand-in: a plain dark backdrop, a figure in a dark jacket, head and shoulders. */
export async function fixturePhoto(): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const { width: W, height: H } = FIXTURE_PHOTO;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c3540"/><stop offset="1" stop-color="#171b22"/></linearGradient>
    <radialGradient id="skin" cx="0.45" cy="0.4" r="0.7"><stop offset="0" stop-color="#d7a27c"/><stop offset="1" stop-color="#a8714f"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <path d="M 190 ${H} C 210 1980 330 1800 560 1760 L 940 1760 C 1170 1800 1290 1980 1310 ${H} Z" fill="#2a2420"/>
  <path d="M 640 1760 L 750 1930 L 860 1760 Z" fill="#4a423b"/>
  <rect x="680" y="1590" width="140" height="190" rx="40" fill="#a8714f"/>
  <ellipse cx="750" cy="1450" rx="135" ry="200" fill="url(#skin)"/>
  <path d="M 612 1400 C 600 1250 680 1238 750 1238 C 830 1238 905 1260 890 1400 C 860 1325 640 1325 612 1400 Z" fill="#2a1d17"/>
  <ellipse cx="700" cy="1450" rx="16" ry="9" fill="#2a1d17"/>
  <ellipse cx="800" cy="1450" rx="16" ry="9" fill="#2a1d17"/>
  <path d="M 712 1570 Q 750 1588 788 1570" stroke="#6e3b2b" stroke-width="7" fill="none"/>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ─── Type ───────────────────────────────────────────────────────────────────

/** TikTok Sans from the repo, indexed under the kit claim face's name (a stand-in: no kit font in a public repo). */
export function fixtureFonts(): FontEntry[] {
  const [tt] = indexFonts(FONT_DIR()).filter((e) => /tiktok/i.test(e.family ?? e.file));
  if (!tt) throw new Error("TikTok Sans is missing from src/remotion/fonts");
  return [{ ...tt, postscriptName: "BootzyCondensedTM-Regular", trial: false }];
}

async function textPiece(text: string, sizePx: number, label: string, colour = "#ffffff", weight = "bold"): Promise<Piece> {
  const sharp = (await import("sharp")).default;
  const font = fixtureFonts()[0]!;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const img = await sharp({ text: { text: `<span foreground="${colour}" font_weight="${weight}">${esc(text)}</span>`, font: `${font.family ?? "TikTok Sans"} ${sizePx}`, fontfile: font.path, dpi: 72, rgba: true } }).png().toBuffer();
  const t = await trimToInk(img);
  return { png: t.png, width: t.width, height: t.height, capPx: t.height, label };
}

export type FixturePieces = { lockup: Piece; name: Piece; info: Piece[] };

/** Stand-ins for the kit's lockup, the artist's name and the PSD's three info lines. */
export async function fixturePieces(): Promise<FixturePieces> {
  const sharp = (await import("sharp")).default;
  const top = await textPiece("PUZZLE", 150, "lockup");
  const sub = await textPiece("4th Birthday", 70, "lockup sub", "#ffffff", "normal");
  const w = Math.max(top.width, sub.width);
  const h = top.height + 18 + sub.height;
  const lockupPng = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: top.png, left: Math.round((w - top.width) / 2), top: 0 },
      { input: sub.png, left: Math.round((w - sub.width) / 2), top: top.height + 18 },
    ])
    .png()
    .toBuffer();
  const lockup: Piece = { png: lockupPng, width: w, height: h, capPx: top.height, label: "lockup" };
  const name = await textPiece("LUKE DEAN", 260, "name");
  const info = [await textPiece("SUNDAY 27TH DECEMBER", 80, "info 1"), await textPiece("FIXTURE HALL · LONDON", 80, "info 2"), await textPiece("2PM – 11PM", 80, "info 3")];
  return { lockup, name, info };
}

/** The card's input, as cta-drafts.mts builds it, on the fixture (bands on, the roll-call claim, no watermark). */
export async function fixtureCardInput(): Promise<ClaimCardInput> {
  const p = await fixturePieces();
  return {
    photo: await fixturePhoto(),
    face: { ...FIXTURE_FACE, box: { ...FIXTURE_FACE.box } },
    eyes: { ok: true, why: "fixture: the drawing's own eyes" },
    faces: [{ ...FIXTURE_FACE.box }],
    name: p.name,
    info: p.info,
    lockup: p.lockup,
    claimText: FIXTURE_CLAIM,
    band: CLAIM_FACE_BAND,
    bands: DEFAULT_GRADIENT_SHADOW,
    fonts: fixtureFonts(),
    watermark: null,
  };
}

/**
 * O1's 1:1 as it was before issue 17, for the before frame only: the 4:5
 * arrangement at 0.8×, centred, over the photo at 0.8× the 9:16's scale,
 * anchored on the eyes, with the 9:16's bands' 4:5 band stretched to the
 * square. The fixture needs no extension and no red-line backing, so neither
 * is drawn.
 */
export async function legacySquare(input: ClaimCardInput, res: ClaimCardResult): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const plan = res.plan!;
  const frame = { width: 1080, height: 1920 };
  const k = 0.8;
  const side = 1080;
  const dx = (side - frame.width * k) / 2;
  const photo = await sharp(input.photo).rotate().toBuffer();
  const meta = await sharp(photo).metadata();
  const sw = Math.round((meta.width ?? 0) * plan.scale);
  const sh = Math.round((meta.height ?? 0) * plan.scale);
  const kPhoto = Math.max(k, side / sw, side / sh);
  const small = { width: Math.round(sw * kPhoto), height: Math.round(sh * kPhoto) };
  const smallPng = await sharp(photo).resize(small.width, small.height).removeAlpha().png().toBuffer();
  const anchor = { x: frame.width / 2, y: plan.eyes * frame.height };
  const clampN = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const sLeft = clampN(Math.round((plan.left + anchor.x) * kPhoto - (dx + anchor.x * k)), 0, small.width - side);
  const sTop = clampN(Math.round((plan.top + anchor.y) * kPhoto - (anchor.y - RECT_45.top) * k), 0, small.height - side);
  const base = await sharp(smallPng).extract({ left: sLeft, top: sTop, width: side, height: side }).png().toBuffer();
  const bandLayer = await sharp(Buffer.from(renderGradientShadow(input.bands!, frame.width, frame.height)), { raw: { width: frame.width, height: frame.height, channels: 4 } }).png().toBuffer();
  const squareBands = await sharp(bandLayer).extract({ left: 0, top: RECT_45.top, width: frame.width, height: RECT_45.bottom - RECT_45.top }).resize(side, side, { fit: "fill" }).png().toBuffer();
  const layout = layoutText({ lockup: input.lockup, name: input.name, info: input.info }, frame);
  const claimPieces: Piece[] = [];
  const claimAt: Placement[] = [];
  const face = input.fonts[0]!;
  for (const line of res.claim?.lines ?? []) {
    const p = await renderCardLine(line.text, line.color === "red" && !res.redLineWhite ? KIT_RED : KIT_WHITE, line.capPx, face);
    claimPieces.push({ png: p.png, width: p.width, height: p.height, capPx: line.capPx, label: line.text });
    claimAt.push({ left: Math.round((frame.width - p.width) / 2), top: Math.round(line.capTop - p.capTopRow), width: p.width, height: p.height, label: line.text, scale: 1, short: false, stepped: false, belowFloor: false });
  }
  const pieces = [...(input.lockup ? [input.lockup] : []), input.name, ...input.info, ...claimPieces];
  const overlay = await textOverlay(pieces, [...layout.all, ...claimAt], { width: side, height: side }, { k, dx, dy: -RECT_45.top * k }, KIT_SHADOW);
  return sharp(base).composite([{ input: squareBands, left: 0, top: 0 }, { input: overlay, left: 0, top: 0 }]).png().toBuffer();
}

// ─── AF-C: a clip shot from behind ──────────────────────────────────────────

export const FIXTURE_CLIP = { width: 1080, height: 1920 } as const;
/** The drawn head (back of the head, no face) at 2 s: centre 0.41 W, 0.53–0.67 H as measured on clip 34. */
export const FIXTURE_CLIP_HEAD: Rect = { left: 0.41 * 1080 - 105, top: 0.53 * 1920, width: 210, height: 0.14 * 1920 };

export async function fixtureClipFrame(): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const { width: W, height: H } = FIXTURE_CLIP;
  const h = FIXTURE_CLIP_HEAD;
  const cx = h.left + h.width / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a1410"/><stop offset="0.45" stop-color="#1c0f12"/><stop offset="1" stop-color="#0d0a0c"/></linearGradient>
    <radialGradient id="lamp" cx="0.78" cy="0.06" r="0.3"><stop offset="0" stop-color="#ffd9a0" stop-opacity="0.9"/><stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#lamp)"/>
  <rect x="0" y="${0.62 * H}" width="${W}" height="${0.06 * H}" fill="#2b2a2e"/>
  <path d="M ${cx - 330} ${H} C ${cx - 320} ${0.76 * H} ${cx - 220} ${0.68 * H} ${cx - 110} ${0.665 * H} L ${cx + 110} ${0.665 * H} C ${cx + 220} ${0.68 * H} ${cx + 320} ${0.76 * H} ${cx + 330} ${H} Z" fill="#b78a63"/>
  <ellipse cx="${cx}" cy="${h.top + h.height * 0.5}" rx="${h.width / 2}" ry="${h.height / 2}" fill="#4a3426"/>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export type ClipFixtureFrame = { png: Buffer; layout: ClipLayout; window: Rect; headAt: Rect; line: string | null; claimUp: boolean };

/** Stand-in T1 pieces: the lockup, the name and the date line (O54). */
async function clipPieces(): Promise<{ lockup: Piece; name: Piece; date: Piece }> {
  const p = await fixturePieces();
  return { lockup: p.lockup, name: p.name, date: await textPiece("SUNDAY 27TH DECEMBER", 80, "date") };
}

/** The claim on the clip, measured as the drafts script measures it (widths at a reference cap, scaled). */
async function clipClaim(): Promise<VideoClaimPlan> {
  const face = fixtureFonts()[0]!;
  const REF = 100;
  const cache = new Map<string, number>();
  for (let pass = 0; pass < 8; pass += 1) {
    const missing = new Set<string>();
    const measure = (t: string, cap: number) => {
      const w = cache.get(t);
      if (w == null) {
        missing.add(t);
        return t.length * 0.35 * cap;
      }
      return (w * cap) / REF;
    };
    const plan = planVideoClaim(FIXTURE_CLAIM, measure, { releaseNames: ["Early bird", "1st release", "2nd release", "3rd release"] });
    if (!missing.size) {
      if ("held" in plan) throw new Error(`fixture claim held: ${plan.held}`);
      return plan;
    }
    for (const t of missing) cache.set(t, (await renderCardLine(t, KIT_WHITE, REF, face)).width);
  }
  throw new Error("fixture claim: widths did not settle");
}

/**
 * AF-C at 2 s: before, the clip's own centred window and A with the claim on
 * its 1238 baseline; after, O120's crop on the head and the first of A, A
 * with the claim up, B whose face-and-head test passes. Feed's centre 4:5
 * (0.148–0.852 H) is drawn as a dashed rectangle.
 */
export async function clipFixtureFrame(after: boolean): Promise<ClipFixtureFrame> {
  const sharp = (await import("sharp")).default;
  const src = FIXTURE_CLIP;
  const pieces = await clipPieces();
  const claim = await clipClaim();
  const headSamples: HeadSample[] = [0, 0.5, 1, 1.5, 2, 2.5, 3].map((tS) => ({ tS, faces: [], maskHead: FIXTURE_CLIP_HEAD }));
  const crop = after ? planHeadCrop(src, FIXTURE_CLIP_HEAD.left + FIXTURE_CLIP_HEAD.width / 2, { cropFocusX: 0.5, cropFocusY: 0.5 }) : null;
  const win = footageWindow(src, "9:16", 0.5, crop?.cropFocusX ?? 0.5, crop && crop.movedPx > 0 ? crop.cropWidth : null);
  let layout = planClipLayout({ lockup: pieces.lockup, name: pieces.name, date: pieces.date, claim }, "9:16", "A");
  if (after) {
    const samples = headSamples.map((s) => ({ tS: s.tS + 0.25, faces: [], heads: [toOutput(headOf(s)!, win)] }));
    for (const t of [{ arr: "A" as const, up: false }, { arr: "A" as const, up: true }, { arr: "B" as const, up: false }]) {
      const l = planClipLayout({ lockup: pieces.lockup, name: pieces.name, date: pieces.date, claim }, "9:16", t.arr, { claimUp: t.up });
      const v = judgeFaceOverTime(samples, { always: t.arr === "A" ? [l.boxes.top] : [l.boxes.top, l.boxes.date], claim: l.boxes.claim });
      layout = l;
      if (v.ok) break;
    }
  }
  const ground = await sharp(await fixtureClipFrame())
    .extract({ left: Math.round(win.left), top: Math.round(win.top), width: Math.round(win.width), height: Math.round(win.height) })
    .resize(1080, 1920)
    .png()
    .toBuffer();
  const bands = await sharp(Buffer.from(renderGradientShadow(clipBands(layout), 1080, 1920)), { raw: { width: 1080, height: 1920, channels: 4 } }).png().toBuffer();
  const lp = layout.pieces;
  const top = [...(lp.lockup ? [lp.lockup] : []), lp.name, lp.date];
  const face = fixtureFonts()[0]!;
  const claimPieces: Piece[] = [];
  const claimAt: Placement[] = [];
  for (const line of layout.claim) {
    const set = await renderCardLine(line.text, line.color === "red" ? KIT_RED : KIT_WHITE, line.capPx, face);
    claimPieces.push({ png: set.png, width: set.width, height: set.height, capPx: line.capPx, label: line.text });
    claimAt.push({ label: line.text, left: Math.round((1080 - set.width) / 2), top: Math.round(line.capTop - set.capTopRow), width: set.width, height: set.height, scale: 1, short: false, stepped: false, belowFloor: false });
  }
  const type = await textOverlay([...top.map((p) => p.piece), ...claimPieces], [...top.map((p) => p.at), ...claimAt], { width: 1080, height: 1920 }, { k: 1, dx: 0, dy: 0 }, KIT_SHADOW);
  const feed = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect x="3" y="${0.148 * 1920}" width="1074" height="${0.704 * 1920}" fill="none" stroke="#ffffff" stroke-opacity="0.7" stroke-width="4" stroke-dasharray="18 12"/></svg>`);
  const png = await sharp(ground).composite([{ input: bands }, { input: type }, { input: feed }]).png().toBuffer();
  const headAt = toOutput(FIXTURE_CLIP_HEAD, win);
  return { png, layout, window: win, headAt, line: crop?.line ?? null, claimUp: layout.claimUp };
}
