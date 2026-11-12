/**
 * Caption and quote placement (C1–C3, C6, Q10–Q12, Q16).
 * The type moves inside O96's band; the crop does not. Lines are wrapped
 * once and kept through the size steps. Contrast is not a pass.
 */

import { captionCharEm, CAPTION_BAND_BOX, VIDEO_BAND } from "./video-band.ts";
import { profile } from "../../src/remotion/caption-style/profile.ts";
import type { Rect } from "./artist-card.ts";

export const PLACEMENT_HOME = profile.verticalCenterPctOfSourceHeight * 1920;
export const PLACEMENT_STEP = 0.02 * 1920;
export const SIZE_LADDER = [1, 0.85, 0.75, 0.65] as const;
export const LONG_LADDER = [0.75, 0.65] as const;
export const PLACEMENT_FLOOR = 0.65;

export const PLACE_REFUSAL = {
  caption: "No place on this clip keeps the caption off the face — choose another clip or in-point.",
  quote: "No place on this clip keeps the quote off the face — choose another clip or in-point.",
} as const;

export const QUOTE_TOO_LONG = "This quote is too long — drop a sentence from the start or end.";
export const OLD_QUOTE_STYLE = "Old quote style — render again";

const BOX = { left: CAPTION_BAND_BOX.left, right: CAPTION_BAND_BOX.right, top: VIDEO_BAND.firstInk, bottom: VIDEO_BAND.lastBaseline };

export function sizeLadder(baseScale: number): readonly number[] {
  if (baseScale <= 0.75 + 1e-9) return LONG_LADDER;
  return SIZE_LADDER;
}

/** C6. A long caption at its own 0.75 says nothing about size. Nothing at today's spot at full size. */
export function placementLine(step: number, scale: number, baseScale: number): string | null {
  const smaller = scale < baseScale - 1e-9 ? ` — ${Math.round(scale * 100)} %` : "";
  if (step === 0 && !smaller) return null;
  if (step === 0) return `Smaller to keep off the face${smaller}`;
  const dir = step < 0 ? "up" : "down";
  return smaller ? `Moved ${dir} and smaller to keep off the face${smaller}` : `Moved ${dir} to keep off the face`;
}

export function placementStep(centre: number, home = PLACEMENT_HOME): number {
  return Math.round((centre - home) / PLACEMENT_STEP);
}

/** The line on a stored render. Null centre or scale is a render from before this: no line. */
export function placementNote(centre: number | null, scale: number | null, baseScale: number, home = PLACEMENT_HOME): string | null {
  if (centre == null || scale == null) return null;
  return placementLine(placementStep(centre, home), scale, baseScale);
}

export function captionBoxesAt(lines: readonly string[], scale: number, centerY: number): Rect[] {
  const fontPx = profile.fontSizePctOfWidth * 1080 * scale;
  const stroke = profile.strokeWidthPctOfFontSize * fontPx;
  const lineHeight = fontPx * profile.lineHeight;
  const centerX = profile.horizontalCenterPctOfWidth * 1080;
  const top = centerY - (lines.length * lineHeight) / 2;
  return lines.map((text, i) => {
    let em = 0;
    for (const char of text) em += captionCharEm(char);
    const width = em * fontPx + 2 * stroke;
    return { left: centerX - width / 2, top: top + i * lineHeight, width, height: lineHeight };
  });
}

/** The block stays inside x 120–944, first ink ≥ 353, last line's box ≤ 1238. */
export function boxesInBand(boxes: readonly Rect[]): boolean {
  if (!boxes.length) return false;
  const last = boxes[boxes.length - 1]!;
  return boxes.every((box) => box.left >= BOX.left - 0.5 && box.left + box.width <= BOX.right + 0.5)
    && boxes[0]!.top >= BOX.top - 0.5
    && last.top + last.height <= BOX.bottom + 0.5;
}

/** 0, −1, +1, −2, +2 … Negative is up. A step outside the band is skipped, not a stop. */
export function placementCentres(lines: readonly string[], scale: number, home = PLACEMENT_HOME): { step: number; centre: number }[] {
  const out: { step: number; centre: number }[] = [];
  for (let n = 0; n <= 30; n += 1) {
    for (const step of n === 0 ? [0] : [-n, n]) {
      const centre = home + step * PLACEMENT_STEP;
      if (boxesInBand(captionBoxesAt(lines, scale, centre))) out.push({ step, centre });
    }
  }
  return out;
}

export type PlaceJudge = (input: {
  scale: number;
  centre: number;
  step: number;
  inS: number;
  boxes: Rect[];
}) => { ok: boolean; topShare: number; longestRunS: number };

export type PlaceHit = {
  ok: true;
  scale: number;
  inS: number;
  step: number;
  centre: number;
  faceShare: number;
  runS: number;
  line: string | null;
  /** O40, stored and never a reason to refuse (C4). Absent when it wasn't measured. */
  contrast?: number | null;
};

export type PlaceMiss = { ok: false; line: string };

/**
 * Largest size first. At a size, the given in-point order, then the nearest
 * place, up before down. The first pass wins.
 */
export function searchPlacement(args: {
  lines: readonly string[];
  baseScale: number;
  inPoints: readonly number[];
  kind: "caption" | "quote";
  judge: PlaceJudge;
  home?: number;
}): PlaceHit | PlaceMiss {
  const home = args.home ?? PLACEMENT_HOME;
  for (const scale of sizeLadder(args.baseScale)) {
    for (const inS of args.inPoints) {
      for (const place of placementCentres(args.lines, scale, home)) {
        const boxes = captionBoxesAt(args.lines, scale, place.centre);
        const verdict = args.judge({ scale, centre: place.centre, step: place.step, inS, boxes });
        if (!verdict.ok) continue;
        return {
          ok: true,
          scale,
          inS,
          step: place.step,
          centre: Math.round(place.centre * 10) / 10,
          faceShare: verdict.topShare,
          runS: verdict.longestRunS,
          line: placementLine(place.step, scale, args.baseScale),
        };
      }
    }
  }
  return { ok: false, line: args.kind === "quote" ? PLACE_REFUSAL.quote : PLACE_REFUSAL.caption };
}

/** The clip's own in-point, then the 4 s grid, skipping a window under 4.75 s. */
export function labInPoints(inS: number, outS: number): number[] {
  const points = [inS];
  for (let t = 0; outS - t >= 4.75 - 1e-6; t += 4) {
    if (!points.some((point) => Math.abs(point - t) < 0.05)) points.push(t);
  }
  return points.filter((point) => outS - point >= 4.75 - 1e-6);
}

function wrapAt(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function linesFit(lines: readonly string[], size: "default" | "long"): boolean {
  return lines.length > 0 && lines.every((line) => {
    const fontPx = (size === "long" ? profile.long.fontSizePctOfWidth : profile.fontSizePctOfWidth) * 1080;
    const stroke = profile.strokeWidthPctOfFontSize * fontPx;
    let em = 0;
    for (const char of line) em += captionCharEm(char);
    return em * fontPx + 2 * stroke <= CAPTION_BAND_BOX.width + 1e-6;
  });
}

export type QuoteFit =
  | { ok: true; lines: string[]; size: "default" | "long"; baseScale: number }
  | { ok: false; sentence: typeof QUOTE_TOO_LONG };

/**
 * Q12 / Q16. Wrap once at 18. More than 4 lines, or a line wider than 824 px,
 * wraps again at 24. Five lines of 24 is the box. Nothing is trimmed.
 */
export function fitQuote(text: string): QuoteFit {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return { ok: false, sentence: QUOTE_TOO_LONG };
  const standard = wrapAt(flat, profile.charsPerLine);
  if (standard.length <= profile.maxLines && linesFit(standard, "default")) {
    return { ok: true, lines: standard, size: "default", baseScale: 1 };
  }
  const long = wrapAt(flat, profile.long.charsPerLine);
  if (long.length <= profile.long.maxLines && linesFit(long, "long")) {
    return { ok: true, lines: long, size: "long", baseScale: 0.75 };
  }
  return { ok: false, sentence: QUOTE_TOO_LONG };
}
