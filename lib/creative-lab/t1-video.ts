/**
 * T1 on a clip (overlay templates issue 6: O37–O48). Pure rules only: the
 * claim's entrance, the video claim's slot and steps, the face and contrast
 * judged over the clip, the crop windows, the safe area, the caption-or-T1
 * rule and the event's release names. The composition is
 * src/remotion/compositions/T1OnClip.tsx; the bands are video-bands.ts; the
 * kit-font delivery (issue 7, O52) is t1-lambda.ts.
 *
 * Matas, 10 Nov: statics never run in Reels, so the 9:16 static claim stays
 * where O23 puts it. Everything here is for video only.
 */

import { MASTER, RECT_45, type Piece, type Placement, type Rect, type Size } from "./artist-card.ts";
import { J2_FALL, type GradientShadow } from "./overlay-gradient.ts";
import { DROP_ORDER, applyDrop, breakAllowed, isRollCall, rollCallStates, type Drop } from "./claim-slot.ts";
import { FORMAT_SIZE, T1V_TIMING, claimOn, claimOpacity, footageWindow, type VideoFormat } from "./t1-video-frame.ts";
import { faceRunLine, faceShareLine, T1V_FACE, type FaceVerdict } from "./t1-face.ts";

export { countedFaces, judgeFaceOverTime, T1V_FACE, upperFace, type FaceSample, type FaceVerdict } from "./t1-face.ts";

export { FORMAT_SIZE, T1V_TIMING, claimOn, claimOpacity, footageWindow, type VideoFormat };

// ─── O37: the claim's entrance ──────────────────────────────────────────────

/** A clip shorter than this takes no claim: 1.5 + 0.25 + 3.0. */
export const MIN_CLAIM_CLIP_S = T1V_TIMING.claimInS + T1V_TIMING.fadeS + T1V_TIMING.minOnS;

export const T1V_LINES = {
  tooShort: "Clip too short for a claim — needs 4.75 s",
  /** O71: with no claim, the share is over the clip's length. */
  face: faceShareLine,
  redToWhite: "claim line 1 in white — red unreadable on this clip",
  captionAndT1: "A clip takes a UGC caption or T1, never both",
  tooBright: (what: "name" | "claim") => `Too bright behind the ${what} — choose another clip`,
  bands: (n: number) => `bands +${n}`,
  backed: (pct: number) => `red line backed ${pct} %`,
  tooSmall: (format: string, w: number) => `Clip too small for ${format} — ${Math.round(w)} px wide in the crop, needs 675`,
  run: faceRunLine,
} as const;

/** O37: does a clip of this length take a claim? It can still run as T1 without one. */
export function claimAllowed(durationS: number): { ok: true } | { ok: false; line: string } {
  return durationS + 1e-9 >= MIN_CLAIM_CLIP_S ? { ok: true } : { ok: false, line: T1V_LINES.tooShort };
}

// ─── O43: the video safe area and the claim ─────────────────────────────────

/** The 9:16 video safe area (Reels / TikTok, the larger margin of the two), master px. */
export const VIDEO_SAFE = { left: 120, right: 960, top: 269, bottom: 1248 } as const;

export const T1V_CLAIM = {
  /** The claim's last line sits on this (its baseline), fraction of H: y 1238 (O97, was 0.65 H / 1248), so a comma or descender still ends by 1248. */
  bottom: 1238 / 1920,
  /** Each line within 840 px (0.778 W), centred. */
  maxWidthPx: 840,
  /** O8's steps on a clip: one line at 4 % H, two lines at 4 % H, two lines at 3.4 % H; never a third line. */
  steps: [
    { lines: 1, cap: 0.04 },
    { lines: 2, cap: 0.04 },
    { lines: 2, cap: 0.034 },
  ],
  /** Two equal-cap lines: cap top to cap top, O4's pitch ratio at 4 % H (0.0583 H), scaled with the cap. */
  pitchAt4: 0.0583,
  /** The roll-call keeps its lockup (O12, O23): line 1 at 0.625 of line 2's cap, 0.29 of line 2's cap apart. */
  rollCall: { line1: 0.217 / 0.347, gap: 22 / 76 },
} as const;

export type VideoClaimLine = { text: string; approvedText: string; color: "red" | "white"; capPx: number; capTop: number; widthPx: number };
export type VideoClaimPlan = { step: number; lines: VideoClaimLine[]; dropped: Drop[]; blockTop: number; bottom: number; widest: number };

/** A line's ink width (px) at a cap, in the kit face (the caller measures). */
export type MeasureCap = (text: string, capPx: number) => number;

/** The most even measured break among O28's allowed breaks (O48: the event's own release names hold together). */
function measuredSplit(text: string, capPx: number, measure: MeasureCap, releaseNames: readonly string[]): [string, string] | null {
  const words = text.trim().split(/\s+/);
  let best: [string, string] | null = null;
  let widest = Infinity;
  for (let i = 1; i < words.length; i += 1) {
    if (!breakAllowed(words, i, releaseNames)) continue;
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const w = Math.max(measure(a, capPx), measure(b, capPx));
    if (w < widest) {
      widest = w;
      best = [a, b];
    }
  }
  return best;
}

/**
 * O43 + O8 on a clip: the claim bottom-anchored on 0.65 H, each line within
 * 840 px. Steps 0 → 2 on the approved words, then O8's drops (O35; a
 * roll-call's line 2 only, O27), each retrying the steps. Kit case is
 * capitals. Null with the reason when nothing fits.
 */
export function planVideoClaim(approved: string, measure: MeasureCap, opts: { releaseNames?: readonly string[]; frame?: Size } = {}): VideoClaimPlan | { held: string } {
  const frame = opts.frame ?? MASTER;
  const names = opts.releaseNames ?? [];
  const approvedLines = approved.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!approvedLines.length) return { held: "no claim" };
  if (approvedLines.length > 2) return { held: "A claim takes two lines at most" };
  const shown = approvedLines.map((l) => l.toUpperCase());
  const roll = isRollCall(shown);
  const red = !roll && shown.length === 1 && /^FINAL\s+\d[\d,]*\s+TICKETS$/.test(shown[0]!);
  const states: { lines: string[]; dropped: Drop[] }[] = roll
    ? rollCallStates(shown[0]!, shown[1]!).map((s) => ({ lines: [s.line1, s.line2], dropped: s.dropped }))
    : (() => {
        const out: { lines: string[]; dropped: Drop[] }[] = [{ lines: shown, dropped: [] }];
        let cur = shown;
        const dropped: Drop[] = [];
        for (const d of DROP_ORDER) {
          const next = applyDrop(cur, d);
          if (!next) continue;
          cur = next;
          dropped.push(d);
          out.push({ lines: cur, dropped: [...dropped] });
        }
        return out;
      })();
  const bottomPx = T1V_CLAIM.bottom * frame.height;
  let widestSeen = 0;
  for (const st of states) {
    for (let step = 0; step < T1V_CLAIM.steps.length; step += 1) {
      const s = T1V_CLAIM.steps[step]!;
      const C = s.cap * frame.height;
      let lines: string[] | null = st.lines;
      if (lines.length === 1 && s.lines === 2 && !roll) lines = measuredSplit(lines[0]!, C, measure, names);
      if (!lines || (lines.length === 2 && s.lines === 1)) continue;
      const caps = roll ? [C * T1V_CLAIM.rollCall.line1, C] : lines.map(() => C);
      const widths = lines.map((t, i) => measure(t, caps[i]!));
      widestSeen = Math.max(widestSeen, ...widths);
      if (!widths.every((w) => w <= T1V_CLAIM.maxWidthPx + 0.5)) continue;
      // Bottom-anchored: the last line's baseline on 1238 (O97); equal-cap lines one pitch apart, a roll-call 0.29 × line 2's cap apart.
      const pitch = (T1V_CLAIM.pitchAt4 * (s.cap / 0.04)) * frame.height;
      const tops: number[] = [];
      tops[lines.length - 1] = bottomPx - caps[lines.length - 1]!;
      if (lines.length === 2) tops[0] = roll ? tops[1]! - T1V_CLAIM.rollCall.gap * C - caps[0]! : tops[1]! - pitch;
      const out: VideoClaimLine[] = lines.map((text, i) => ({
        text,
        approvedText: approvedLines.length === lines!.length ? approvedLines[i]! : approvedLines.join(" "),
        color: roll ? (i === 0 ? "red" : "white") : red ? "red" : "white",
        capPx: caps[i]!,
        capTop: tops[i]!,
        widthPx: widths[i]!,
      }));
      return { step, lines: out, dropped: st.dropped, blockTop: out[0]!.capTop, bottom: bottomPx, widest: Math.max(...widths) };
    }
  }
  return { held: `${Math.round(widestSeen)} of ${T1V_CLAIM.maxWidthPx} px · can't shorten` };
}

/** H41: every type box inside the 9:16 video safe area. */
export function insideVideoSafe(boxes: readonly Rect[]): { ok: boolean; outside: Rect[] } {
  const outside = boxes.filter((b) => b.left < VIDEO_SAFE.left - 0.5 || b.left + b.width > VIDEO_SAFE.right + 0.5 || b.top < VIDEO_SAFE.top - 0.5 || b.top + b.height > VIDEO_SAFE.bottom + 0.5);
  return { ok: outside.length === 0, outside };
}

/** The claim block's box (centred lines, cap top to the last baseline). */
export function claimBlockRect(plan: VideoClaimPlan, frame: Size = MASTER): Rect {
  const w = plan.widest;
  return { left: (frame.width - w) / 2, top: plan.blockTop, width: w, height: plan.bottom - plan.blockTop };
}

// ─── O41, O42: the type stays on the frame (crop windows: t1-video-frame.ts) ─

/**
 * Where the type sits in each format, master px → that format's px. The type
 * is fixed to the output frame: the 4:5 is the master's 4:5 rectangle, the
 * 1:1 the 4:5 at 0.8× re-sit (O1). crop_focus_y never enters this.
 */
export function typeTransform(format: VideoFormat): { k: number; dx: number; dy: number } {
  if (format === "9:16") return { k: 1, dx: 0, dy: 0 };
  if (format === "4:5") return { k: 1, dx: 0, dy: -RECT_45.top };
  const k = 0.8;
  return { k, dx: (1080 - MASTER.width * k) / 2, dy: -RECT_45.top * k };
}

export const moveRect = (r: Rect, t: { k: number; dx: number; dy: number }): Rect => ({ left: r.left * t.k + t.dx, top: r.top * t.k + t.dy, width: r.width * t.k, height: r.height * t.k });

// ─── O54: the clip layout (issue 8) ─────────────────────────────────────────

export type Arrangement = "A" | "B";

/** O54's sizes, fractions of the 9:16 H unless named. */
export const T1C = {
  lockupWidth: 0.25,
  /** O97: the lockup's ink top on 353 (0.184 H), 0.05 of the 4:5 view below Feed's crop edge. O54's top block moved down 75 px as one (was 0.145 H, 278). */
  lockupTop: 353 / 1920,
  nameCap: 0.07,
  /** O97: 469 (0.244 H), was 0.205 H. */
  nameCapTop: 469 / 1920,
  dateCap: 0.0297,
  /** A: the date's cap top. O97: 632 (0.329 H), was 0.29 H. */
  dateCapTopA: 632 / 1920,
  /** B: the date's baseline sits this far above the claim's first cap top. */
  dateGapB: 0.015,
  /** 4:5 and 1:1: the lockup's top and the claim's last baseline, fractions of the rectangle. */
  rect: { lockupTop: 0.05, claimBottom: 0.9 },
  maxWidthPx: 840,
  /** O55: the top band full to the top block's last baseline + 0.02 H, gone 0.09 H later. */
  bandTop: { gap: 0.02, fade: 0.09 },
  /** O55: the bottom band 0 at the bottom block's first cap top − 0.06 H, 20 % at − 0.01 H, 30 % at + 0.07 H. */
  bandBottom: { zero: -0.06, full: -0.01, ramp: 0.07 },
  /** O57: band steps, added to each band's opacities. */
  bandSteps: [0, 0.1, 0.2],
  /** O61: the lockup alone, ≤ 15 % below 3:1 on the p95 sample. */
  lockupMax: 0.15,
} as const;

export type ClipPiece = { piece: Piece; at: Placement };
export type ClipLayout = {
  format: VideoFormat;
  arrangement: Arrangement;
  /** Type scale: 1 in 9:16 and 4:5, 0.8 in 1:1 (O1). */
  k: number;
  size: Size;
  pieces: { lockup: ClipPiece | null; name: ClipPiece; date: ClipPiece };
  claim: VideoClaimLine[];
  boxes: { lockup: Rect | null; top: Rect; date: Rect; claim: Rect | null; bottom: Rect };
  /** The base bands (step 0), anchored to the blocks (O55). */
  anchors: { topFull: number; topGone: number; bottomZero: number; bottomFull: number; bottomRamp: number };
};

const H916 = MASTER.height;
const union = (rs: readonly Rect[]): Rect => {
  const l = Math.min(...rs.map((r) => r.left));
  const t = Math.min(...rs.map((r) => r.top));
  const r = Math.max(...rs.map((x) => x.left + x.width));
  const b = Math.max(...rs.map((x) => x.top + x.height));
  return { left: l, top: t, width: r - l, height: b - t };
};

/**
 * O54: the lockup, the name and one date line (no venue or time), with the
 * claim, in arrangement A (date at the top) or B (date above the claim). The
 * 9:16 positions are O54's; the 4:5 and 1:1 keep the 9:16 pixel sizes (×0.8
 * in the 1:1), the lockup's top on 0.05 of the rectangle and the claim's last
 * baseline on 0.90. The claim plan is the 9:16's; its lines are scaled and
 * re-anchored here.
 */
export function planClipLayout(input: { lockup: Piece | null; name: Piece; date: Piece; claim: VideoClaimPlan | null }, format: VideoFormat, arrangement: Arrangement): ClipLayout {
  const size = FORMAT_SIZE[format];
  const k = format === "1:1" ? 0.8 : 1;
  const W = size.width;
  const origin = format === "9:16" ? T1C.lockupTop * H916 : T1C.rect.lockupTop * size.height;
  const claimBottom = format === "9:16" ? T1V_CLAIM.bottom * H916 : T1C.rect.claimBottom * size.height;
  const y = (y916: number) => origin + (y916 - T1C.lockupTop * H916) * k;
  const centred = (piece: Piece, scale: number, top: number, label: string): ClipPiece => {
    const w = piece.width * scale;
    const h = piece.height * scale;
    return { piece, at: { label, left: (W - w) / 2, top, width: w, height: h, scale, short: false, stepped: false, belowFloor: false } };
  };
  const fit = (piece: Piece, cap: number) => Math.min((cap * H916) / Math.max(1, piece.capPx), T1C.maxWidthPx / Math.max(1, piece.width)) * k;
  const lockup = input.lockup ? centred(input.lockup, ((T1C.lockupWidth * MASTER.width) / input.lockup.width) * k, origin, "lockup") : null;
  const name = centred(input.name, fit(input.name, T1C.nameCap), y(T1C.nameCapTop * H916), "name");
  const claim: VideoClaimLine[] = (input.claim?.lines ?? []).map((l) => ({ ...l, capPx: l.capPx * k, widthPx: l.widthPx * k, capTop: claimBottom + (l.capTop - input.claim!.bottom) * k }));
  const claimTop = claim.length ? claim[0]!.capTop : claimBottom - T1V_CLAIM.steps[0]!.cap * H916 * k;
  const dateScale = fit(input.date, T1C.dateCap);
  const dateCapPx = input.date.capPx * dateScale;
  const dateTop = arrangement === "A" ? y(T1C.dateCapTopA * H916) : claimTop - T1C.dateGapB * H916 * k - dateCapPx;
  const date = centred(input.date, dateScale, dateTop, "date");
  const claimRect = claim.length ? { left: (W - T1V_CLAIM.maxWidthPx * k) / 2, top: claimTop, width: T1V_CLAIM.maxWidthPx * k, height: claimBottom - claimTop } : null;
  const topParts = [lockup?.at, name.at, arrangement === "A" ? date.at : null].filter((r): r is Placement => !!r);
  const top = union(topParts);
  const bottomParts = [claimRect ?? { left: (W - T1V_CLAIM.maxWidthPx * k) / 2, top: claimTop, width: T1V_CLAIM.maxWidthPx * k, height: claimBottom - claimTop }, arrangement === "B" ? date.at : null].filter((r): r is Rect => !!r);
  const bottom = union(bottomParts);
  // O55: the top band from the top block's last baseline; the bottom band from the bottom block's first cap top.
  const lastBaseline = arrangement === "A" ? date.at.top + dateCapPx : name.at.top + input.name.capPx * name.at.scale;
  const firstCap = arrangement === "B" ? date.at.top : claimTop;
  const topFull = lastBaseline + T1C.bandTop.gap * H916 * k;
  return {
    format,
    arrangement,
    k,
    size,
    pieces: { lockup, name, date },
    claim,
    boxes: { lockup: lockup?.at ?? null, top, date: date.at, claim: claimRect, bottom },
    anchors: {
      topFull,
      topGone: topFull + T1C.bandTop.fade * H916 * k,
      bottomZero: firstCap + T1C.bandBottom.zero * H916 * k,
      bottomFull: firstCap + T1C.bandBottom.full * H916 * k,
      bottomRamp: firstCap + T1C.bandBottom.ramp * H916 * k,
    },
  };
}

/** O55 + O57: the clip's bands at its band steps (added to each band's opacities). */
export function clipBands(layout: ClipLayout, steps: { top: number; bottom: number } = { top: 0, bottom: 0 }): GradientShadow {
  const Hr = layout.size.height;
  const a = layout.anchors;
  return {
    blendMode: "normal",
    bands: [
      { edge: "top", plateau: a.topFull / Hr, extent: a.topGone / Hr, opacity: 0.2 + steps.top, color: "#000000", knots: J2_FALL },
      { edge: "bottom", plateau: (Hr - a.bottomFull) / Hr, extent: (Hr - a.bottomZero) / Hr, opacity: 0.2 + steps.bottom, color: "#000000", knots: J2_FALL, ramp: { opacity: 0.3 + steps.bottom, at: (Hr - a.bottomRamp) / Hr } },
    ],
  };
}

/**
 * O55's stops for a layout (fraction of the format's height → alpha %): the
 * top band 20 % at its plateau's end with 18 % just inside the fade (the
 * knee pair, 0.00025 H), 0 where it's gone; the bottom band 0, then 18 % and
 * 20 % at its knee, 30 % at its ramp and to the edge.
 */
export function clipBandStops(layout: ClipLayout, steps: { top: number; bottom: number } = { top: 0, bottom: 0 }): (readonly [number, number])[] {
  const Hr = layout.size.height;
  const a = layout.anchors;
  const knee = 0.00025 * H916 * layout.k;
  const t = (0.2 + steps.top) * 100;
  const b = (0.2 + steps.bottom) * 100;
  const r = (0.3 + steps.bottom) * 100;
  return [
    [a.topFull / Hr, t],
    [(a.topFull + knee) / Hr, t * 0.9],
    [a.topGone / Hr, 0],
    [a.bottomZero / Hr, 0],
    [(a.bottomFull - knee) / Hr, b * 0.9],
    [a.bottomFull / Hr, b],
    [a.bottomRamp / Hr, r],
    [(Hr - 20) / Hr, r],
  ];
}

/** O57: the first band step at which a figure passes its limit, or null (refused). p95ByStep is in T1C.bandSteps order. */
export function chooseStep(p95ByStep: readonly number[], limit: number): number | null {
  const i = p95ByStep.findIndex((v) => v <= limit + 1e-9);
  return i < 0 ? null : i;
}

/** O58: the red line's backing steps, after the band steps. */
export const RED_BACKING = { steps: [0.4, 0.6, 0.8], padY: 0.5, padX: 1, feather: 1, minPad: 0.25, minFeather: 0.25, minFeatherPx: 12, gapPad: 0.25, clearCaps: 1.5, minX: 0.07, maxX: 0.93 } as const;

export type RedVerdict = { backing: number | null; white: boolean; line: string | null };

/**
 * O58: the red line stays #FE3232. p95ByBacking is [no backing, 40 %, 60 %,
 * 80 %]; the first that passes the ink-box test (≤ 25 % below 2:1) is used.
 * White only past 80 %, with the approval line.
 */
export function chooseBacking(p95ByBacking: readonly number[], what: "clip" | "photo" = "clip"): RedVerdict {
  const i = p95ByBacking.findIndex((v) => v <= T1V_CONTRAST.redInk + 1e-9);
  if (i === 0) return { backing: null, white: false, line: null };
  if (i > 0) return { backing: RED_BACKING.steps[i - 1]!, white: false, line: T1V_LINES.backed(Math.round(RED_BACKING.steps[i - 1]! * 100)) };
  return { backing: null, white: true, line: `claim line 1 in white — red unreadable on this ${what}` };
}

/** O66 / O70: the backing's full-opacity core, and how far its smoothstep feather runs outward from each side of it to 0. */
export type BackingBox = { rect: Rect; feather: { left: number; right: number; top: number; bottom: number } };

/**
 * O66 (amends O58): the backing for line 1, format px. The core is line 1's
 * ink box padded 1 cap left and right; above and below, by the smaller of
 * 0.5 cap and a quarter of the gap to the neighbouring type (line 2's cap top
 * below, the type's baseline above), or 0.5 cap when no type is within 1.5
 * cap. The feather runs outward, vertically over the smaller of 1 cap and
 * what is left of the gap, so it reaches 0 exactly at the neighbour's ink;
 * horizontally over 1 cap, ending at 0.07 / 0.93 W at the latest. Where that
 * would squeeze the horizontal feather under 0.25 cap, the padding shrinks
 * first, never under 0.25 cap. No hard edge, never under other type.
 * O70: a feather is never shorter than 12 px. Where a gap can't hold the
 * padding plus 12 px, the padding shrinks first, down to 0; a gap under
 * 12 px is all feather.
 */
export function backingRect(line: { capTop: number; capPx: number; widthPx: number }, frameWidth: number, neighbours: { above?: number; below?: number } = {}): BackingBox {
  const cap = line.capPx;
  const ink = { left: (frameWidth - line.widthPx) / 2, right: (frameWidth + line.widthPx) / 2, top: line.capTop, bottom: line.capTop + cap };
  const side = (room: number) => {
    // room: from the ink's edge to 0.07 / 0.93 W.
    let pad = RED_BACKING.padX * cap;
    let feather = Math.min(RED_BACKING.feather * cap, room - pad);
    const least = Math.max(RED_BACKING.minFeather * cap, RED_BACKING.minFeatherPx);
    if (feather < least) {
      pad = Math.max(RED_BACKING.minPad * cap, room - least);
      feather = Math.max(0, room - pad);
    }
    return { pad: Math.max(0, Math.min(pad, room)), feather: Math.max(0, feather) };
  };
  const vertical = (gap: number | undefined) => {
    if (gap == null || gap >= RED_BACKING.clearCaps * cap) return { pad: RED_BACKING.padY * cap, feather: RED_BACKING.feather * cap };
    const g = Math.max(0, gap);
    let pad = Math.min(RED_BACKING.padY * cap, RED_BACKING.gapPad * g);
    if (g - pad < RED_BACKING.minFeatherPx) pad = Math.max(0, g - RED_BACKING.minFeatherPx);
    return { pad, feather: Math.min(Math.max(RED_BACKING.feather * cap, RED_BACKING.minFeatherPx), g - pad) };
  };
  const l = side(ink.left - RED_BACKING.minX * frameWidth);
  const r = side(RED_BACKING.maxX * frameWidth - ink.right);
  const t = vertical(neighbours.above != null ? ink.top - neighbours.above : undefined);
  const b = vertical(neighbours.below != null ? neighbours.below - ink.bottom : undefined);
  const rect = { left: ink.left - l.pad, top: ink.top - t.pad, width: ink.right + r.pad - (ink.left - l.pad), height: ink.bottom + b.pad - (ink.top - t.pad) };
  return { rect, feather: { left: l.feather, right: r.feather, top: t.feather, bottom: b.feather } };
}

/**
 * O63 (amends O42 and O62, video only): footage may be scaled up to 1.6×
 * from its crop window. O69 (issue 10): with the renderer's own filter, and
 * no stored upscaled copy; Lanczos stays for O68's render-copy downscale.
 */
export const T1V_SCALE = { maxUp: 1.6, minWindowPx: 675 } as const;

/** O63: the crop window's scale to the output (above 1 is upscaling). */
export function upscaleFactor(source: Size, format: VideoFormat, cropFocusY = 0.5, cropFocusX = 0.5): number {
  return FORMAT_SIZE[format].width / footageWindow(source, format, cropFocusY, cropFocusX).width;
}

/**
 * O63, on every format the 9:16 included: a crop window under 675 px wide
 * (more than 1.6× to 1080) makes no draft of that format. Stills are never
 * upscaled (O19); this is for clips.
 */
export function formatTooSmall(source: Size, format: VideoFormat): string | null {
  const w = footageWindow(source, format).width;
  return w + 1e-9 < T1V_SCALE.minWindowPx ? T1V_LINES.tooSmall(format, w) : null;
}

/**
 * O73: crop candidates that give the same footage window (a source exactly
 * the format's shape can't move) are tried once. Keeps the first of each
 * window, in the given order.
 */
export function distinctCrops(source: Size, format: VideoFormat, candidates: readonly number[], cropFocusX = 0.5): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  for (const cy of candidates) {
    const w = footageWindow(source, format, cy, cropFocusX);
    const key = `${Math.round(w.left)}:${Math.round(w.top)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cy);
  }
  return out;
}

/** O73: a refused row's arrangement column lists every arrangement tried ("A, B"), not "(A)". */
export function arrangementsTried(tried: readonly ("A" | "B")[]): string {
  return [...new Set(tried)].sort().join(", ");
}

export type ClipListing = { id: string; source: string; clipNo: number };

/**
 * O63's listing rule, for the Clips section and import: within one artist's
 * group, folder and press-kit clips come before Instagram clips, each kind in
 * its own clip order. The Lab doesn't match duplicates.
 */
export function orderArtistClips<T extends ClipListing>(clips: readonly T[]): T[] {
  const rank = (s: string) => (s === "instagram" ? 1 : 0);
  return [...clips].sort((a, b) => rank(a.source) - rank(b.source) || a.clipNo - b.clipNo);
}


/**
 * O39 / O41: try the clip's own crop first, then the others in order; the
 * first that passes is used. None passing: the clip takes no T1, with the
 * line for the crop that came closest.
 */
export function chooseCrop<T>(candidates: readonly T[], judge: (c: T) => FaceVerdict): { crop: T; verdict: FaceVerdict } | { crop: null; verdict: FaceVerdict } {
  let best: { crop: T; verdict: FaceVerdict } | null = null;
  for (const c of candidates) {
    const v = judge(c);
    if (v.ok) return { crop: c, verdict: v };
    if (!best || Math.max(v.topShare, v.claimShare) < Math.max(best.verdict.topShare, best.verdict.claimShare)) best = { crop: c, verdict: v };
  }
  return { crop: null, verdict: best?.verdict ?? { ok: false, topShare: 0, claimShare: 0, longestRunS: 0, line: T1V_LINES.face(0) } };
}

// ─── O40: contrast over the clip ────────────────────────────────────────────

export const T1V_CONTRAST = { topBlock: 0.1, claimBox: 0.15, redInk: 0.25 } as const;

/** The p-th percentile, nearest rank. */
export function nearestRank(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

export type ContrastSample = { tS: number; topBlock: number; claimBox: number | null; redInk: number | null };
export type ContrastVerdict = { topBlockP95: number; claimBoxP95: number | null; redInkP95: number | null; red: boolean; ok: boolean; approvalLines: string[] };

/**
 * O40: O19's shares per sample (bands on, before type); the clip's figure is
 * the nearest-rank p95 over the samples in which that type is on screen. The
 * red line is decided once for the clip: if its p95 fails, line 1 is white
 * for the whole clip and the approval card says so.
 */
export function judgeContrastOverClip(samples: readonly ContrastSample[]): ContrastVerdict {
  const top = nearestRank(samples.map((s) => s.topBlock), 95);
  const onClaim = samples.filter((s) => claimOn(s.tS));
  const claimVals = onClaim.map((s) => s.claimBox).filter((v): v is number => v != null);
  const redVals = onClaim.map((s) => s.redInk).filter((v): v is number => v != null);
  const claim = claimVals.length ? nearestRank(claimVals, 95) : null;
  const redP = redVals.length ? nearestRank(redVals, 95) : null;
  const red = redP == null || redP <= T1V_CONTRAST.redInk + 1e-9;
  const ok = top <= T1V_CONTRAST.topBlock + 1e-9 && (claim == null || claim <= T1V_CONTRAST.claimBox + 1e-9);
  return { topBlockP95: top, claimBoxP95: claim, redInkP95: redP, red, ok, approvalLines: red ? [] : [T1V_LINES.redToWhite] };
}

/** The sample times at 5 a second, from 0 to the clip's end. */
export function sampleTimes(durationS: number, fps: number = T1V_FACE.fps): number[] {
  const out: number[] = [];
  for (let i = 0; i / fps < durationS - 1e-9; i += 1) out.push(i / fps);
  return out;
}

// ─── O44: a caption or T1, never both ───────────────────────────────────────

export type ClipUse = { clipId: string; use: "caption" | "t1" };

/** O44: the clips that would carry both a UGC caption (a round) and T1 (the asset board). */
export function captionT1Conflicts(uses: readonly ClipUse[]): string[] {
  const by = new Map<string, Set<string>>();
  for (const u of uses) by.set(u.clipId, (by.get(u.clipId) ?? new Set()).add(u.use));
  return [...by].filter(([, s]) => s.has("caption") && s.has("t1")).map(([id]) => id);
}

/** O44 where T1 is assigned: refuses a clip already in a caption round, and the reverse. */
export function assignUse(existing: readonly ClipUse[], next: ClipUse): { ok: true } | { ok: false; line: string } {
  const clash = existing.some((u) => u.clipId === next.clipId && u.use !== next.use);
  return clash ? { ok: false, line: T1V_LINES.captionAndT1 } : { ok: true };
}

// ─── O48: the event's release names ─────────────────────────────────────────

/** The event's release names for the break rule, from its event_releases rows, in position order. */
export function releaseNamesOf(rows: readonly { name: string | null; position?: number | null }[]): string[] {
  return [...rows]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((r) => (r.name ?? "").trim())
    .filter(Boolean);
}

/** Every value the T1 clip build chose, with its ruling (issue 8, O62). */
export const T1V_INVENTED: readonly { value: string; ruling: "accepted" | "accepted, amended" | "rejected" | "superseded" | "invented in a record" }[] = [
  { ruling: "accepted", value: "the claim is 'on screen' for O39 and O40 from the first frame after 1.5 s" },
  { ruling: "accepted, amended", value: "O39's counting (the top block over every sample, the claim after 1.5 s, the larger share, 0.2 s samples), under O56 and O64: the upper 60 % of each face at least 0.08 W wide and half the widest" },
  { ruling: "accepted, amended", value: "the widest face as the main face; crops in order: the clip's crop_focus_y, 0.5, then ±0.1 outward, with A then B at each crop (O54, O56)" },
  { ruling: "accepted", value: "the roll-call on a clip: line 1 at 0.625 of line 2's cap, 0.29 of line 2's cap apart" },
  { ruling: "accepted", value: "a one-line claim breaks at the measured most-even break among O28's allowed breaks" },
  { ruling: "accepted", value: "the step-2 pitch scales with the cap: 0.0496 H" },
  { ruling: "accepted", value: "the 4:5 and 1:1 windows: the largest window of that shape at its crop_focus_y" },
  { ruling: "superseded", value: "the scaling rule: O62 rejected upscaling; O63 allows up to 1.6× from a crop window at least 675 px wide, on every format; O69 drops Lanczos for those upscales" },
  { ruling: "accepted", value: "the type set by sharp and drawn as images (O52's delivery)" },
  { ruling: "accepted", value: "drafts muted and cut to 8 s (drafts only)" },
  { ruling: "accepted, amended", value: "the claim box 840 px wide, centred; the top block's box the lockup, name and date (A) or lockup and name (B); the lockup also tested alone (O61)" },
  { ruling: "accepted", value: "the knee pair, 18 % at 0.00025 H on the fade side of every 20 % stop (O55)" },
  { ruling: "accepted", value: "O46 at J2's knee rows: ≤ 3 levels; ≤ 2 across the fades (O55)" },
  { ruling: "accepted", value: "blue noise: void-and-cluster, 32 × 32, sigma 1.5, alpha8 = floor(alpha16 / 257 + threshold)" },
  { ruling: "accepted, amended", value: "the draft stamp in the first free corner, on the top layer, never touching the lockup's ink box" },
  { ruling: "accepted", value: "O52's path {client id}/{PostScript name}.{ext} in kit-fonts, a per-render signed URL to a temporary file" },
  { ruling: "accepted", value: "a name wider than 840 px scaled down about the centre, its top kept" },
  { ruling: "accepted", value: "O56: every counted face is tested (not the widest alone), each by its upper 60 % (O67)" },
  { ruling: "superseded", value: "the backing cut hard at type and at 0.07–0.93 W: O66's core and feather replace it" },
  { ruling: "accepted", value: "O58 on clips: the red line's p95 re-read with the chosen band step, then each backing step, on the same samples (O67)" },
  { ruling: "superseded", value: "O62 on the 4:5 and 1:1 only: O63 covers every format" },
  { ruling: "accepted, amended", value: "with no claim, the bottom band anchored where a one-line claim would sit; in B the date stays above that line (O67)" },
  { ruling: "invented in a record", value: "issue 9: 1.6× and 675 px; Lanczos; folder clips first; the 0.08 W floor; the run line's words; the backing's quarter-gap padding, feather to the neighbour's ink, the 0.25 cap minimums and H66's 6-level check" },
  { ruling: "invented in a record", value: "issue 10: the smoothstep feather, its 12 px minimum and the 1.6× step check (O70); the no-claim line (O71); trying identical windows once and \"A, B\" on refused rows (O73); the renderer's own filter up to 1.6× (O69). O72 is overruled by Matas (10 Nov): footage showing another promoter's or venue's branding is fine and never flagged" },
  { ruling: "accepted", value: "O92 (issue 13) rules O70's check as built (design, #1174): the backing layer dithered with the bands' blue noise (16 → 8 bit, O46), each row's mean level across the core's width, the grey not rounded a second time; read over the feather's rows only, its mean step the drop over the feather's length in rows (fix round 1)" },
  { ruling: "accepted", value: "the render copy (O68) is read from creative_lab_clips.render_asset_id, #1176's 1080 copy (migration 220), else creative_asset_id (render-source.ts; Matas, 10 Nov)" },
];
