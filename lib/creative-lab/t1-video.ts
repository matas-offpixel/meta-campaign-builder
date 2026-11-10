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

import { MASTER, RECT_45, layoutText, type Piece, type Placement, type Rect, type Size, type TextLayout } from "./artist-card.ts";
import { DROP_ORDER, applyDrop, breakAllowed, isRollCall, rollCallStates, type Drop } from "./claim-slot.ts";
import { FORMAT_SIZE, T1V_TIMING, claimOn, claimOpacity, footageWindow, type VideoFormat } from "./t1-video-frame.ts";

export { FORMAT_SIZE, T1V_TIMING, claimOn, claimOpacity, footageWindow, type VideoFormat };

// ─── O37: the claim's entrance ──────────────────────────────────────────────

/** A clip shorter than this takes no claim: 1.5 + 0.25 + 3.0. */
export const MIN_CLAIM_CLIP_S = T1V_TIMING.claimInS + T1V_TIMING.fadeS + T1V_TIMING.minOnS;

export const T1V_LINES = {
  tooShort: "Clip too short for a claim — needs 4.75 s",
  face: (pct: number) => `Face in the type for ${pct} % of the claim's time — choose another crop or clip`,
  redToWhite: "claim line 1 in white — red unreadable on this clip",
  captionAndT1: "A clip takes a UGC caption or T1, never both",
} as const;

/** O37: does a clip of this length take a claim? It can still run as T1 without one. */
export function claimAllowed(durationS: number): { ok: true } | { ok: false; line: string } {
  return durationS + 1e-9 >= MIN_CLAIM_CLIP_S ? { ok: true } : { ok: false, line: T1V_LINES.tooShort };
}

// ─── O43: the video safe area and the claim ─────────────────────────────────

/** The 9:16 video safe area (Reels / TikTok, the larger margin of the two), master px. */
export const VIDEO_SAFE = { left: 120, right: 960, top: 269, bottom: 1248 } as const;

export const T1V_CLAIM = {
  /** The claim's last line sits on this (its baseline), fraction of H: y 1248. */
  bottom: 0.65,
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
  /** The 4:5 and 1:1 carry the 9:16's arrangement: the claim's last line on 0.713 of the 4:5 rectangle. */
  carried45: (0.65 * MASTER.height - RECT_45.top) / (RECT_45.bottom - RECT_45.top),
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
      // Bottom-anchored: the last line's baseline on 0.65 H; equal-cap lines one pitch apart, a roll-call 0.29 × line 2's cap apart.
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

/**
 * O43: the top block keeps its static slots (O3, O18's 76 px inset) and keeps
 * the name and details within 840 px: a piece the static layout lets reach
 * 864 px (0.8 W) is scaled down about the frame's centre, its top kept; the
 * details lines step down together.
 */
export function videoTopBlock(input: { lockup: Piece | null; name: Piece; info: readonly Piece[] }, frame: Size = MASTER): TextLayout {
  const base = layoutText(input, frame);
  const narrow = (p: Placement, k: number): Placement => (k >= 1 ? p : { ...p, width: p.width * k, height: p.height * k, left: frame.width / 2 - (p.width * k) / 2, scale: p.scale * k, stepped: true });
  const name = narrow(base.name, T1V_CLAIM.maxWidthPx / base.name.width);
  const widestInfo = base.info.length ? Math.max(...base.info.map((p) => p.width)) : 0;
  const kInfo = widestInfo ? T1V_CLAIM.maxWidthPx / widestInfo : 1;
  const info = base.info.map((p) => narrow(p, kInfo));
  const all = [base.lockup, name, ...info].filter((p): p is Placement => p != null);
  const left = Math.min(...all.map((p) => p.left));
  const top = Math.min(...all.map((p) => p.top));
  const right = Math.max(...all.map((p) => p.left + p.width));
  const bottom = Math.max(...all.map((p) => p.top + p.height));
  return { lockup: base.lockup, name, info, all, block: { left, top, width: right - left, height: bottom - top } };
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

// ─── O39: the face over time ────────────────────────────────────────────────

export const T1V_FACE = {
  /** Samples a second. */
  fps: 5,
  /** At most this share of samples with the face in type (while that type is on screen). */
  maxShare: 0.1,
  /** Never longer than this in a row. */
  maxRunS: 0.5,
  /** Each type box padded this much, px of the format. */
  pad: 12,
  /** Faces under this share of the main face's width don't count (O19). */
  minFaceShare: 0.5,
} as const;

export type FaceSample = { tS: number; faces: Rect[] };

const pad = (r: Rect, p: number): Rect => ({ left: r.left - p, top: r.top - p, width: r.width + 2 * p, height: r.height + 2 * p });
const touches = (a: Rect, b: Rect) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/** The main face (the widest) of a sample; faces under half its width are ignored. */
export function mainFace(faces: readonly Rect[]): Rect | null {
  if (!faces.length) return null;
  return [...faces].sort((a, b) => b.width - a.width)[0]!;
}

export type FaceVerdict = { ok: boolean; topShare: number; claimShare: number; longestRunS: number; line: string | null };

/**
 * O39: the face against the top block (from frame 0) and the claim box (while
 * the claim is on screen), each padded 12 px. Shares are over the samples in
 * which that type is on screen; a run counts consecutive samples in which the
 * face touches any on-screen type, a sample standing for 1 / fps seconds.
 */
export function judgeFaceOverTime(samples: readonly FaceSample[], boxes: { top: Rect; claim: Rect | null }, opts: { fps?: number } = {}): FaceVerdict {
  const fps = opts.fps ?? T1V_FACE.fps;
  const top = pad(boxes.top, T1V_FACE.pad);
  const claim = boxes.claim ? pad(boxes.claim, T1V_FACE.pad) : null;
  let topHits = 0;
  let claimHits = 0;
  let claimSamples = 0;
  let run = 0;
  let longest = 0;
  for (const s of samples) {
    const f = mainFace(s.faces);
    const onClaim = !!claim && claimOn(s.tS);
    if (onClaim) claimSamples += 1;
    const hitTop = !!f && touches(f, top);
    const hitClaim = !!f && onClaim && touches(f, claim!);
    if (hitTop) topHits += 1;
    if (hitClaim) claimHits += 1;
    run = hitTop || hitClaim ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const topShare = samples.length ? topHits / samples.length : 0;
  const claimShare = claimSamples ? claimHits / claimSamples : 0;
  const longestRunS = longest / fps;
  const ok = topShare <= T1V_FACE.maxShare + 1e-9 && claimShare <= T1V_FACE.maxShare + 1e-9 && longestRunS <= T1V_FACE.maxRunS + 1e-9;
  const pct = Math.round(Math.max(topShare, claimShare) * 100);
  return { ok, topShare, claimShare, longestRunS, line: ok ? null : T1V_LINES.face(pct) };
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

/** Values no asset, PSD or record gives, from building T1 on a clip. */
export const T1V_INVENTED = [
  "the claim is 'on screen' for O39 and O40 from the first frame after 1.5 s (opacity above 0)",
  "O39: the top block counts over every sample, the claim box over the samples after 1.5 s; the refusal's {n} is the larger of the two shares; a run is consecutive samples touching any on-screen type, each sample 0.2 s",
  "O39: the main face is the widest detected face; the crop candidates are the clip's own crop_focus_y, then 0.5, then ±0.1 steps outward",
  "a roll-call on a clip keeps the artist card's lockup: line 1 at 0.625 of line 2's cap, 0.29 of line 2's cap apart",
  "the one-line claim breaks onto two lines at the measured most-even break among O28's allowed breaks (as T2), not T1's character count",
  "the step-2 pitch scales with the cap: 0.0583 × 3.4 / 4 = 0.0496 H",
  "the 4:5 window is the largest 4:5 inside the source at its crop_focus_y; the 1:1 the largest square; a source narrower than 1080 is scaled up to the output (the window itself is never padded)",
  "the type layers are set by sharp from the kit face and drawn by the composition as images, so the browser never loads a kit font",
  "drafts are muted and cut to their first 8 s from in_s (the contact sheet's last frame is 4.75 s)",
  "the claim box for O40 is 840 px wide, centred, from the claim's first cap top to its 0.65 H baseline; the top block's box is the name, details and lockup's union",
  "the bottom band's knee is tested as a stop pair, as O25 writes its own: 18 % at 0.59975 H (J2's 0.9 knot) beside the 20 % at 0.60 H",
  "O46's 2-level step is checked across the fades, not at J2's two knees (rows 845 and 1152), where the band drops 10 % of its opacity inside one row (about 2.1 and 2.6 levels on mid-grey); those are reported",
  "blue noise: void-and-cluster on a 32 × 32 torus, Gaussian sigma 1.5, seeded start at 10 % density; alpha8 = floor(alpha16 / 257 + threshold)",
  "the draft stamp sits on the top block's layer (on from frame 0), in the first free corner of the 4:5 rectangle",
  "O52 delivery: the face is fetched per render from a signed URL (≤ 1 h) to a temporary file that sharp sets the type from; the composition gets images only, so no font reaches the browser, the Lambda site or its serve URL; the bucket is kit-fonts, the path {client id}/{PostScript name}.{ext}",
  "a top-block piece wider than 840 px is scaled down about the frame's centre with its top kept; the details lines step down together",
] as const;
