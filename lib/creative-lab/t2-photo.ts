/**
 * T2 on the photo ground (overlay templates issue 11, O76–O83): the
 * promoter's own photo or clip, full-bleed, no panel. The experience line is
 * centred with the optional claim under it; the lineup is top right, the
 * details bottom left, the logo bottom right; three dark bands sit behind
 * them. Every slot is white Bootzy (the kit's face) except the roll-call's red
 * line and the coral ">"; no stroke, no shadow (O5).
 *
 * Pure planning and judging: sizes, positions in each format, the bands,
 * the contrast ladder, faces, resolution, timing and the caption rule. The
 * pixels are drawn by t2-photo-render.ts (stills) and T1OnClip (clips: the
 * same layers — bands and type from frame 0, the claim fading in at 1.5 s).
 *
 * The panel ground (issues 4–5) is unchanged and lives in t2-render.ts.
 * Values no record gives are in T2P_INVENTED.
 */

import { MASTER, RECT_45, type Rect, type Size } from "./artist-card.ts";
import { applyDrop } from "./claim-slot.ts";
import { checkExperienceLine, experienceDisplay, EXPERIENCE_LINES, typedLines } from "./experience-line.ts";
import type { FootageOwner } from "./footage-owner.ts";
import { J2_FALL, knotAt } from "./overlay-gradient.ts";
import { PUZZLE_FLOATING_T2, type T2Kit } from "./overlay-kits.ts";
import { bestSplit, claimKind, inCase, isFinalTickets, planDetails, planLineup, planLogo, type CornerLine, type MeasureLine } from "./t2-message.ts";
import { FORMAT_SIZE, claimOpacity, footageWindow, type VideoFormat } from "./t1-video-frame.ts";
import { T1V_FACE, VIDEO_SAFE, claimAllowed, countedFaces, formatTooSmall, insideVideoSafe, judgeFaceOverTime, upperFace, type FaceSample, type FaceVerdict } from "./t1-video.ts";

export type PhotoGround = "still" | "clip";
export type PhotoFormat = VideoFormat;

/** Issue 11's measures (ratios of the 9:16 master unless px). */
export const T2P = {
  /** O78: the claim's cap as a share of the experience line's cap at its step. */
  claimCap: 0.55,
  /** O78: the experience line's last baseline to the claim's first cap top, at step 0; scaled with the step. */
  claimGap: 0.025,
  /** O78: the width limit on a still (0.07–0.93 W) and on a 9:16 clip (O43). */
  stillWidth: 0.86,
  clipWidthPx: 840,
  /** O80, the 9:16 clip: the lineup's first cap top and right edge, the details' left edge and last baseline, the logo's right edge. */
  clip: { lineupCapTop: 0.15, right: 0.889, left: 0.111, detailsBaseline: 0.65 },
  /** O1: the 1:1 re-sit. */
  square: { k: 0.8, side: 1080 },
  /** O81: the three bands (fractions of the 9:16 H, scaled with the format's k). */
  bands: {
    opacity: 0.2,
    /** O57's steps, added to each band's opacities: 20 → 30 → 40 %. */
    steps: [0, 0.1, 0.2],
    top: { gap: 0.02, fade: 0.09 },
    centre: { pad: 0.02, fade: 0.06 },
    /** As O55's bottom band, anchored on the details' first cap top: 0 at −0.06 H, 20 % at −0.01 H, 30 % at +0.07 H. */
    bottom: { zero: -0.06, full: -0.01, ramp: 0.07, rampOpacity: 0.3 },
  },
  /** O81's limits (O19, O40, O61): share of the box below 3:1 (the red line: below 2:1). */
  limits: { lineup: 0.1, details: 0.1, block: 0.15, logo: 0.15, red: 0.25 },
} as const;

export const T2P_LINES = {
  needOne: EXPERIENCE_LINES.needOne,
  tooLong: EXPERIENCE_LINES.tooLong,
  tooBusy: (what: "lineup" | "experience line" | "details") => `Too busy behind the ${what} — choose another photo or clip`,
  faceStill: "Face in the type — choose another crop or photo",
  photoTooSmall: (format: string, w: number) => `Photo too small for ${format} — ${Math.round(w)} px wide in the crop, needs 1080`,
  /** Invented (issue 11 gives no words): O76 refusing artist footage, and O83's caption rule on T2. */
  artistFootage: "Artist footage takes T1 — T2's photo ground is for the promoter's own photos and clips",
  captionAndT2: "A clip takes a UGC caption or T2, never both",
  claimTooLong: (widest: number, limit: number) => `claim ${Math.round(widest)} of ${Math.round(limit)} px · can't shorten`,
} as const;

// ─── O76: the ground ────────────────────────────────────────────────────────

/** O76: the photo ground takes only footage the promoter owns (W1), promoter clips featuring an artist included (W8). */
export function photoGroundAllowed(clip: { owner: FootageOwner | null }): { ok: true } | { ok: false; line: string } {
  return clip.owner === "promoter" ? { ok: true } : { ok: false, line: T2P_LINES.artistFootage };
}

// ─── O77 / O78: the block ───────────────────────────────────────────────────

export type BlockLine = { text: string; role: "experience" | "claim"; color: "white" | "red"; capPx: number; capTop: number; widthPx: number };

export type PhotoBlock = {
  step: number;
  lines: BlockLine[];
  blockTop: number;
  blockBottom: number;
  experienceCap: number | null;
  claimCap: number | null;
  /** O8's drops applied to the claim (never to the experience line). */
  dropped: string[];
  limitPx: number;
};

export type BlockInput = {
  /** The experience line as stored (typed or a chosen suggestion), or null. */
  experience: string | null;
  /** The claim as approved or held, its lines separated by "\n" as the ladder gives them, or null. */
  claim: string | null;
  releaseNames?: readonly string[];
};

type Fit = { lines: string[]; widths: number[] } | null;

function fitLines(text: string, typed: boolean, capPx: number, limit: number, tracking: number, measure: MeasureLine, releaseNames: readonly string[]): Fit {
  const given = text.split("\n").filter(Boolean);
  const fits = (ls: string[]) => {
    const widths = ls.map((l) => measure(l, capPx, tracking));
    return widths.every((w) => w <= limit + 1e-6) ? { lines: ls, widths } : null;
  };
  if (given.length >= 2 || (typed && given.length > 1)) return given.length <= 2 ? fits(given) : null;
  const one = fits(given);
  if (one) return one;
  const split = bestSplit(given[0]!, capPx, tracking, measure, releaseNames);
  return split ? fits(split) : null;
}

/**
 * O78: the experience line at T2's steps (cap 0.06 / 0.052 / 0.045 H, pitch
 * scaled from O4's 0.0875 H), white and centred, with the claim under it at
 * 0.55 of its cap and 0.025 H below its last baseline (scaled). A roll-call
 * takes O23's sizes at the claim's cap; O8's drops apply to the claim only.
 * The block's lines are placed from y = 0; `placeBlock` centres it.
 */
export function planPhotoBlock(input: BlockInput, limitPx: number, measure: MeasureLine, kit: T2Kit = PUZZLE_FLOATING_T2, frame: Size = MASTER): { ok: true; block: PhotoBlock } | { ok: false; line: string } {
  const exp = input.experience ? checkExperienceLine(input.experience) : null;
  if (exp && !exp.ok) return { ok: false, line: exp.line };
  const expText = exp?.ok ? experienceDisplay(exp.text) : null;
  const claimLines0 = input.claim ? input.claim.split("\n").map((l) => inCase(l.trim(), kit)).filter(Boolean) : [];
  if (!expText && !claimLines0.length) return { ok: false, line: T2P_LINES.needOne };
  const names = input.releaseNames ?? [];
  const steps = kit.claim.steps;
  const step0 = steps[0]!;
  const t = kit.tracking.claim;
  let expEverFits = !expText;
  let claimWidest = 0;
  for (let s = 0; s < steps.length; s += 1) {
    const C = steps[s]!.cap * frame.height;
    const pitch = steps[s]!.pitch * frame.height;
    const expFit = expText ? fitLines(typedLines(expText).join("\n"), true, C, limitPx, t, measure, names) : null;
    if (expText && !expFit) continue;
    expEverFits = true;
    const out: Omit<BlockLine, "capTop">[] = (expFit?.lines ?? []).map((text, i) => ({ text, role: "experience", color: "white", capPx: C, widthPx: expFit!.widths[i]! }));
    const gaps: number[] = out.map((_, i) => (i === 0 ? 0 : pitch - C));
    let dropped: string[] = [];
    const Cc = T2P.claimCap * C;
    if (claimLines0.length) {
      const kind = claimKind(claimLines0);
      let placed: Omit<BlockLine, "capTop">[] | null = null;
      let claimGaps: number[] = [];
      let lines = claimLines0;
      const drops = kit.dropOrder;
      for (let d = -1; d < drops.length && !placed; d += 1) {
        if (d >= 0) {
          const target = kind === "roll-call" ? [lines[1]!] : lines;
          const next = applyDrop(target, drops[d]!);
          if (!next) continue;
          lines = kind === "roll-call" ? [lines[0]!, ...next] : next;
          dropped = [...dropped, drops[d]!];
        }
        if (kind === "roll-call") {
          const c1 = Cc * kit.claim.rollCallLine1;
          const w1 = measure(lines[0]!, c1, t);
          const w2 = measure(lines[1]!, Cc, t);
          claimWidest = Math.max(claimWidest, w1, w2);
          if (w1 <= limitPx + 1e-6 && w2 <= limitPx + 1e-6) {
            placed = [
              { text: lines[0]!, role: "claim", color: "red", capPx: c1, widthPx: w1 },
              { text: lines[1]!, role: "claim", color: "white", capPx: Cc, widthPx: w2 },
            ];
            claimGaps = [0, kit.claim.rollCallGap * Cc];
          }
        } else {
          const fit = fitLines(lines.join("\n"), lines.length > 1, Cc, limitPx, t, measure, names);
          if (fit) {
            const red = lines.length === 1 && isFinalTickets(lines[0]!);
            placed = fit.lines.map((text, i) => ({ text, role: "claim" as const, color: red ? ("red" as const) : ("white" as const), capPx: Cc, widthPx: fit.widths[i]! }));
            claimGaps = fit.lines.map((_, i) => (i === 0 ? 0 : (step0.pitch / step0.cap) * Cc - Cc));
          } else claimWidest = Math.max(claimWidest, ...lines.map((l) => measure(l, Cc, t)));
        }
      }
      if (!placed) continue;
      const gapToClaim = out.length ? T2P.claimGap * frame.height * (C / (step0.cap * frame.height)) : 0;
      for (const [i, p] of placed.entries()) {
        out.push(p);
        gaps.push(i === 0 ? gapToClaim : claimGaps[i]!);
      }
    }
    let y = 0;
    const lines: BlockLine[] = out.map((l, i) => {
      y += gaps[i]!;
      const line = { ...l, capTop: y };
      y += l.capPx;
      return line;
    });
    return { ok: true, block: { step: s, lines, blockTop: 0, blockBottom: y, experienceCap: expText ? C : null, claimCap: claimLines0.length ? Cc : null, dropped, limitPx } };
  }
  if (!expEverFits) return { ok: false, line: T2P_LINES.tooLong };
  return { ok: false, line: T2P_LINES.claimTooLong(claimWidest, limitPx) };
}

/** The block moved so its middle (first cap top to last baseline) sits on y. */
export function placeBlock(block: PhotoBlock, centreY: number): PhotoBlock {
  const dy = centreY - (block.blockBottom - block.blockTop) / 2 - block.blockTop;
  return { ...block, lines: block.lines.map((l) => ({ ...l, capTop: l.capTop + dy })), blockTop: block.blockTop + dy, blockBottom: block.blockBottom + dy };
}

// ─── O79 / O80: the slots and positions ─────────────────────────────────────

export type PhotoSlotsInput = BlockInput & {
  /** The event's facts, in order, verbatim. */
  lineup: readonly string[];
  /** O79: true only when the facts say more acts are to be announced. */
  moreToAnnounce: boolean;
  /** The details' two lines (photoDetails). */
  details: readonly string[];
  /** The logo's ink box (the event's lockup, else the wordmark). */
  logoInk: { width: number; height: number };
};

export type PhotoBoxes = { lineup: Rect; experience: Rect | null; claim: Rect | null; block: Rect; details: Rect; logo: Rect };

export type PhotoLayout = {
  ground: PhotoGround;
  format: PhotoFormat;
  /** The type's scale against the 9:16 master (1 in 9:16 and 4:5, 0.8 in the 1:1). */
  k: number;
  size: Size;
  block: PhotoBlock;
  lineup: CornerLine[];
  details: CornerLine[];
  logo: Rect;
  boxes: PhotoBoxes;
};

const union = (rs: readonly Rect[]): Rect => {
  const l = Math.min(...rs.map((r) => r.left));
  const t = Math.min(...rs.map((r) => r.top));
  const r = Math.max(...rs.map((x) => x.left + x.width));
  const b = Math.max(...rs.map((x) => x.top + x.height));
  return { left: l, top: t, width: r - l, height: b - t };
};
const cornerRect = (lines: readonly CornerLine[]): Rect => union(lines.map((l) => ({ left: l.left, top: l.capTop, width: l.widthPx, height: l.capPx })));
const blockRect = (lines: readonly BlockLine[], frameWidth: number): Rect | null =>
  lines.length ? union(lines.map((l) => ({ left: (frameWidth - l.widthPx) / 2, top: l.capTop, width: l.widthPx, height: l.capPx }))) : null;

/**
 * O79: the details' two lines. The kit's live layer verbatim where the event
 * has one; otherwise "{EEE} {d} {MMM}" and the venue's name.
 */
export function photoDetails(input: { liveLayer?: readonly string[] | null; date: string | null; venue: string | null }): string[] {
  if (input.liveLayer?.length) return [...input.liveLayer];
  const out: string[] = [];
  if (input.date) {
    const d = new Date(`${input.date.slice(0, 10)}T12:00:00Z`);
    const day = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getUTCDay()]!;
    const mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getUTCMonth()]!;
    out.push(`${day} ${d.getUTCDate()} ${mon}`);
  }
  if (input.venue) out.push(input.venue.toUpperCase());
  return out;
}

/** O79: the lineup's lines. "& MORE" only from the facts' flag; never added to cut a long list (six names at most without it). */
export function photoLineupNames(names: readonly string[], moreToAnnounce: boolean, kit: T2Kit = PUZZLE_FLOATING_T2): { names: string[]; more: boolean } {
  const list = names.map((n) => n.trim()).filter(Boolean);
  const max = kit.lineup.maxLines;
  return moreToAnnounce ? { names: list.slice(0, max - 1), more: true } : { names: list.slice(0, max), more: false };
}

/** The 9:16 master layout on a ground: the still's (Stories) or the clip's (Reels / TikTok, O43's safe area). */
export function planPhotoMaster(input: PhotoSlotsInput, ground: PhotoGround, measure: MeasureLine, kit: T2Kit = PUZZLE_FLOATING_T2): { ok: true; layout: PhotoLayout } | { ok: false; line: string } {
  const frame = MASTER;
  const W = frame.width;
  const H = frame.height;
  const k2: T2Kit =
    ground === "clip"
      ? { ...kit, lineup: { ...kit.lineup, capTop: T2P.clip.lineupCapTop, rightInset: 1 - T2P.clip.right }, details: { ...kit.details, leftInset: T2P.clip.left }, logo: { ...kit.logo, rightInset: 1 - T2P.clip.right } }
      : kit;
  const ln = photoLineupNames(input.lineup, input.moreToAnnounce, kit);
  const lineup = planLineup(ln.names, measure, { more: ln.more }, k2, frame);
  let details = planDetails(input.details, measure, k2, frame);
  if (ground === "clip" && details.length) {
    const last = details[details.length - 1]!;
    const dy = T2P.clip.detailsBaseline * H - (last.capTop + last.capPx);
    details = details.map((d) => ({ ...d, capTop: d.capTop + dy }));
  }
  const detailsBox = cornerRect(details);
  const logo0 = planLogo(input.logoInk, k2, frame);
  const detailsCentre = detailsBox.top + detailsBox.height / 2;
  const logo = { ...logo0, top: detailsCentre - logo0.height / 2 };
  const limit = ground === "clip" ? T2P.clipWidthPx : T2P.stillWidth * W;
  const planned = planPhotoBlock(input, limit, measure, kit, frame);
  if (!planned.ok) return planned;
  const lineupBox = cornerRect(lineup);
  const centreY = ground === "clip" ? (lineupBox.top + lineupBox.height + detailsBox.top) / 2 : kit.claim.centre * H;
  const block = placeBlock(planned.block, centreY);
  const experience = blockRect(block.lines.filter((l) => l.role === "experience"), W);
  const claim = blockRect(block.lines.filter((l) => l.role === "claim"), W);
  return {
    ok: true,
    layout: { ground, format: "9:16", k: 1, size: frame, block, lineup, details, logo, boxes: { lineup: lineupBox, experience, claim, block: blockRect(block.lines, W)!, details: detailsBox, logo } },
  };
}

/** A master box in another format: the 4:5 is the 9:16 still's rectangle (O1), the 1:1 its 0.8× re-sit. */
export function mapToFormat(r: Rect, format: PhotoFormat): Rect {
  if (format === "9:16") return r;
  if (format === "4:5") return { ...r, top: r.top - RECT_45.top };
  const { k, side } = T2P.square;
  const dx = (side - MASTER.width * k) / 2;
  return { left: r.left * k + dx, top: (r.top - RECT_45.top) * k, width: r.width * k, height: r.height * k };
}

const mapY = (y: number, format: PhotoFormat) => mapToFormat({ left: 0, top: y, width: 0, height: 0 }, format).top;

/**
 * The layout in a format. The 9:16 clip has its own positions (O80); the
 * 4:5 and 1:1, still or clip, come from the still's 9:16 (feed: no controls
 * over the media).
 */
export function planPhotoLayout(input: PhotoSlotsInput, ground: PhotoGround, format: PhotoFormat, measure: MeasureLine, kit: T2Kit = PUZZLE_FLOATING_T2): { ok: true; layout: PhotoLayout } | { ok: false; line: string } {
  const masterGround: PhotoGround = format === "9:16" ? ground : "still";
  const m = planPhotoMaster(input, masterGround, measure, kit);
  if (!m.ok || format === "9:16") return m.ok ? { ok: true, layout: { ...m.layout, ground } } : m;
  const L = m.layout;
  const k = format === "1:1" ? T2P.square.k : 1;
  const size = FORMAT_SIZE[format];
  const mapLine = <T extends { capTop: number; capPx: number }>(l: T, left: number, width: number) => {
    const r = mapToFormat({ left, top: l.capTop, width, height: l.capPx }, format);
    return { ...l, capTop: r.top, capPx: r.height, left: r.left, widthPx: r.width };
  };
  const lineup = L.lineup.map((l) => mapLine(l, l.left, l.widthPx));
  const details = L.details.map((l) => mapLine(l, l.left, l.widthPx));
  const blockLines = L.block.lines.map((l) => {
    const r = mapToFormat({ left: (MASTER.width - l.widthPx) / 2, top: l.capTop, width: l.widthPx, height: l.capPx }, format);
    return { ...l, capTop: r.top, capPx: r.height, widthPx: r.width };
  });
  const block: PhotoBlock = { ...L.block, lines: blockLines, blockTop: mapY(L.block.blockTop, format), blockBottom: mapY(L.block.blockBottom, format), limitPx: L.block.limitPx * k };
  const b = L.boxes;
  return {
    ok: true,
    layout: {
      ground,
      format,
      k,
      size,
      block,
      lineup,
      details,
      logo: mapToFormat(L.logo, format),
      boxes: { lineup: mapToFormat(b.lineup, format), experience: b.experience && mapToFormat(b.experience, format), claim: b.claim && mapToFormat(b.claim, format), block: mapToFormat(b.block, format), details: mapToFormat(b.details, format), logo: mapToFormat(b.logo, format) },
    },
  };
}

/** O80 / H81: every type box inside O43's safe area on the 9:16 clip. */
export function photoClipSafe(layout: PhotoLayout): { ok: boolean; outside: Rect[] } {
  const b = layout.boxes;
  return insideVideoSafe([b.lineup, b.block, b.details, b.logo]);
}
export { VIDEO_SAFE };

// ─── O81: the bands ─────────────────────────────────────────────────────────

export type BandSteps = { top: number; centre: number; bottom: number };

export type PhotoBandAnchors = { topFull: number; topGone: number; centreFull: [number, number]; centreFade: number; bottomZero: number; bottomFull: number; bottomRamp: number };

/** O81's anchors in a layout's own px. */
export function photoBandAnchors(layout: PhotoLayout): PhotoBandAnchors {
  const H = MASTER.height * layout.k;
  const B = T2P.bands;
  const lastLineup = layout.lineup[layout.lineup.length - 1]!;
  const topFull = lastLineup.capTop + lastLineup.capPx + B.top.gap * H;
  const firstDetails = layout.details[0]!.capTop;
  return {
    topFull,
    topGone: topFull + B.top.fade * H,
    centreFull: [layout.block.blockTop - B.centre.pad * H, layout.block.blockBottom + B.centre.pad * H],
    centreFade: B.centre.fade * H,
    bottomZero: firstDetails + B.bottom.zero * H,
    bottomFull: firstDetails + B.bottom.full * H,
    bottomRamp: firstDetails + B.bottom.ramp * H,
  };
}

/** The three bands' alpha at a row (pixel centre), composited "over" each other; J2's fade on every edge. */
export function photoBandAlphaAt(y: number, a: PhotoBandAnchors, steps: BandSteps): number {
  const yc = y + 0.5;
  const B = T2P.bands;
  const s = (i: number) => B.steps[i] ?? 0;
  const top = (() => {
    const op = B.opacity + s(steps.top);
    if (yc <= a.topFull) return op;
    if (yc >= a.topGone) return 0;
    return op * knotAt(J2_FALL, (yc - a.topFull) / (a.topGone - a.topFull));
  })();
  const centre = (() => {
    const op = B.opacity + s(steps.centre);
    const [t0, t1] = a.centreFull;
    if (yc >= t0 && yc <= t1) return op;
    const d = yc < t0 ? t0 - yc : yc - t1;
    return d >= a.centreFade ? 0 : op * knotAt(J2_FALL, d / a.centreFade);
  })();
  const bottom = (() => {
    const op = B.opacity + s(steps.bottom);
    const ramp = B.bottom.rampOpacity + s(steps.bottom);
    if (yc <= a.bottomZero) return 0;
    if (yc < a.bottomFull) return op * knotAt(J2_FALL, (a.bottomFull - yc) / (a.bottomFull - a.bottomZero));
    if (yc < a.bottomRamp) return op + ((ramp - op) * (yc - a.bottomFull)) / (a.bottomRamp - a.bottomFull);
    return ramp;
  })();
  return [top, centre, bottom].reduce((acc, x) => x + acc * (1 - x), 0);
}

/** The bands as an RGBA layer (black, straight alpha). With `dither`, O46's blue-noise 16 → 8 bit (clips). */
export function renderPhotoBands(size: Size, a: PhotoBandAnchors, steps: BandSteps, opts: { dither?: (x: number, y: number) => number } = {}): Uint8Array {
  const out = new Uint8Array(size.width * size.height * 4);
  for (let y = 0; y < size.height; y += 1) {
    const a16 = Math.round(photoBandAlphaAt(y, a, steps) * 65535);
    for (let x = 0; x < size.width; x += 1) out[(y * size.width + x) * 4 + 3] = Math.min(255, Math.floor(a16 / 257 + (opts.dither ? opts.dither(x, y) : 0.5)));
  }
  return out;
}

export type SlotShares = { lineup: number; block: number; details: number; logo: number };

/**
 * O81 / O57: each band steps up (20 → 30 → 40 %) only for the slot it sits
 * behind, until every limit passes: the top band for the lineup, the centre
 * band for the block, the bottom band for the details and the logo. Past the
 * last step, the line names the slot.
 */
export function choosePhotoBandSteps(measure: (steps: BandSteps) => SlotShares): { ok: true; steps: BandSteps; shares: SlotShares } | { ok: false; steps: BandSteps; shares: SlotShares; line: string } {
  const L = T2P.limits;
  const last = T2P.bands.steps.length - 1;
  const steps: BandSteps = { top: 0, centre: 0, bottom: 0 };
  for (;;) {
    const sh = measure(steps);
    const fails = { top: sh.lineup > L.lineup + 1e-9, centre: sh.block > L.block + 1e-9, bottom: sh.details > L.details + 1e-9 || sh.logo > L.logo + 1e-9 };
    if (!fails.top && !fails.centre && !fails.bottom) return { ok: true, steps: { ...steps }, shares: sh };
    const stuck = (fails.top && steps.top === last) || (fails.centre && steps.centre === last) || (fails.bottom && steps.bottom === last);
    if (stuck) {
      const what = fails.top && steps.top === last ? "lineup" : fails.centre && steps.centre === last ? "experience line" : "details";
      return { ok: false, steps: { ...steps }, shares: sh, line: T2P_LINES.tooBusy(what) };
    }
    if (fails.top) steps.top += 1;
    if (fails.centre) steps.centre += 1;
    if (fails.bottom) steps.bottom += 1;
  }
}

// ─── O82: faces and resolution ──────────────────────────────────────────────

const padRect = (r: Rect, p: number): Rect => ({ left: r.left - p, top: r.top - p, width: r.width + 2 * p, height: r.height + 2 * p });
const touches = (a: Rect, b: Rect) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/** Every type box on the layout (the faces are tested against each, padded 12 px). */
export const photoTypeBoxes = (layout: PhotoLayout): Rect[] => [layout.boxes.lineup, layout.boxes.block, layout.boxes.details, layout.boxes.logo];

/** O82 on a still: no counted face (≥ 0.08 W, its upper 60 %) may touch any type box padded 12 px. */
export function judgeStillFaces(faces: readonly Rect[], layout: PhotoLayout): { ok: true } | { ok: false; line: string; faces: Rect[] } {
  const boxes = photoTypeBoxes(layout).map((b) => padRect(b, T1V_FACE.pad));
  const hit = countedFaces(faces, layout.size.width).map(upperFace).filter((f) => boxes.some((b) => touches(f, b)));
  return hit.length ? { ok: false, line: T2P_LINES.faceStill, faces: hit } : { ok: true };
}

/** O82 on a clip: O56's limits (10 % of samples, 0.5 s in a row), the experience line from frame 0 with the lineup, details and logo; the claim after 1.5 s. */
export function judgeClipFaces(samples: readonly FaceSample[], layout: PhotoLayout): FaceVerdict {
  const b = layout.boxes;
  return judgeFaceOverTime(samples, { always: [b.lineup, ...(b.experience ? [b.experience] : []), b.details, b.logo], claim: b.claim }, { frameWidth: layout.size.width });
}

/**
 * O82: a still is never upscaled. Every format is cut from the 9:16 still
 * (the 4:5 its rectangle, the 1:1 its re-sit on the same ground), so each
 * needs the photo's 9:16 window at least 1080 px wide.
 */
export function photoTooSmall(source: Size, format: PhotoFormat, cropFocusY = 0.5, cropFocusX = 0.5): string | null {
  const w = footageWindow(source, "9:16", cropFocusY, cropFocusX).width;
  return w + 1e-9 < MASTER.width ? T2P_LINES.photoTooSmall(format, w) : null;
}

/** O82: a clip follows T1's limits (O63: up to 1.6× from a window at least 675 px wide). */
export const clipTooSmall = (source: Size, format: PhotoFormat): string | null => formatTooSmall(source, format);

// ─── O83: on a clip ─────────────────────────────────────────────────────────

/**
 * O83: what is on screen when. The bands, lineup, details, logo and the
 * experience line from frame 0; the claim at 1.5 s with the 0.25 s fade, and
 * not at all on a clip under 4.75 s.
 */
export function photoClipTiming(durationS: number, hasClaim: boolean): { fromFrame0: ("bands" | "lineup" | "details" | "logo" | "experience")[]; claim: boolean; claimLine: string | null } {
  const allowed = claimAllowed(durationS);
  return { fromFrame0: ["bands", "lineup", "details", "logo", "experience"], claim: hasClaim && allowed.ok, claimLine: hasClaim && !allowed.ok ? allowed.line : null };
}

/** The claim layer's opacity at t (T1's fade, O37). */
export const photoClaimOpacity = (tS: number): number => claimOpacity(tS);

export type TemplateUse = { clipId: string; use: "caption" | "t1" | "t2-photo" };

/** O83 / O44: the clips that would carry both a UGC caption and a template (T1 or T2 on the photo ground). */
export function captionTemplateConflicts(uses: readonly TemplateUse[]): string[] {
  const by = new Map<string, Set<string>>();
  for (const u of uses) by.set(u.clipId, (by.get(u.clipId) ?? new Set()).add(u.use));
  return [...by].filter(([, s]) => s.has("caption") && (s.has("t1") || s.has("t2-photo"))).map(([id]) => id);
}

/** O83 where T2 is assigned to a clip: refuses a clip already in a caption round, and the reverse. */
export function assignPhotoT2(existing: readonly TemplateUse[], next: TemplateUse): { ok: true } | { ok: false; line: string } {
  const other = existing.find((u) => u.clipId === next.clipId && (u.use === "caption") !== (next.use === "caption"));
  if (!other) return { ok: true };
  const template = next.use === "caption" ? other.use : next.use;
  return { ok: false, line: template === "t1" ? "A clip takes a UGC caption or T1, never both" : T2P_LINES.captionAndT2 };
}

// ─── Invented ───────────────────────────────────────────────────────────────

export const T2P_INVENTED: readonly { value: string; ruling: "invented in a record" | "invented here" }[] = [
  { ruling: "invented in a record", value: "issue 11: the clip's 0.15 H and 0.889 W; the block centred between the lineup and the details; the claim at 0.55 of the experience line's cap and the 0.025 H gap; the centre band and its 0.02 / 0.06 H; the 40-character limit, the writer's word bans and every new line; \"& MORE\" from the facts' flag" },
  { ruling: "invented here", value: "the details' last baseline on 0.65 H sets the clip's details; the logo is centred on the details' actual centre line in both grounds" },
  { ruling: "invented here", value: "a typed or ladder-given break is kept on the experience line and the claim; a one-line claim too wide for the limit breaks at O28's most even break at the same step before any drop" },
  { ruling: "invented here", value: "the block steps down as one: a step is used only when the experience line and the claim (after O8's drops) both fit it; a claim that never fits reads \"claim {w} of {limit} px · can't shorten\"" },
  { ruling: "invented here", value: "a plain two-line claim's pitch is O4's pitch-to-cap ratio (0.0875 / 0.06) at the claim's cap" },
  { ruling: "invented here", value: "without the facts' flag, a lineup longer than six shows the first six and no \"& MORE\"; with it, the first five and \"& MORE\"" },
  { ruling: "invented here", value: "the band ladder raises only the band behind the failing slot (top: lineup; centre: block; bottom: details and logo) and names the first stuck slot" },
  { ruling: "invented here", value: "the 1:1 photo ground is the 9:16 still's centre square at full size (as the panel ground's 1:1 re-covers), the type at O1's 0.8× re-sit" },
  { ruling: "invented here", value: "the words for O76's refusal (\"Artist footage takes T1 — …\"), O83's caption rule on T2 (\"A clip takes a UGC caption or T2, never both\"), the emoji line, the empty line, and the stamp when both are held (\"DRAFT · experience line and claim not approved\")" },
  { ruling: "invented here", value: "the writer's bans past the record's five: greatest, largest, ultimate, unrivalled, unmatched, unbeatable, finest, top, leading, legendary, iconic, world-class, most, any -est word; spelled numbers; and the sale words in experience-line.ts" },
];
