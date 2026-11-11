/**
 * Overlay templates issue 15 (docs/design-record/2026-11-11-overlay-templates-15.html):
 * O95 video is one 9:16, O96 the band, O99 the UGC caption box, O102
 * existing 4:5 and 1:1 video. Pure rules only.
 *
 * The callers are in Cursor's files, which rule 3 keeps off limits on
 * 11 Nov (surface.ts, render.ts, propose.ts, launch.ts, selection.ts,
 * lib/plan/from-lab-server.ts, scripts/t1-video-drafts.mts). The caption's
 * own files (caption-facts.ts, CaptionOnClip.tsx, caption-overlay.tsx and
 * the hashed v1.json) are Cursor's too. The wiring is the PR's follow-up list.
 * T1's slots (O97) are in t1-video.ts; T2's (O98) in t2-photo.ts (#1177).
 */

import advancesJson from "./caption-advances.json" with { type: "json" };
import { captionLimits, profile, type CaptionSize } from "../../src/remotion/caption-style/profile.ts";
import type { ClipLayout } from "./t1-video.ts";

// ─── O96: the band ──────────────────────────────────────────────────────────

/**
 * Feed's centre 4:5 (y 285–1635) ∩ the Reels / Stories safe area (O43,
 * x 120–960, y 269–1248), on 1080 × 1920. Type ink starts no higher than
 * 353 (0.05 of the 4:5 view below Feed's crop edge) and the last line's
 * baseline is on 1238 or above, so a descender still ends by 1248. Bands
 * and backings may run outside it; they aren't type.
 */
export const VIDEO_BAND = { left: 120, right: 960, top: 285, bottom: 1248, firstInk: 353, lastBaseline: 1238 } as const;

export type InkBox = { left: number; top: number; width: number; height: number };
/** One type slot: its ink box and, for a line of type, its baseline. */
export type BandSlot = { slot: string; box: InkBox; baseline?: number };
export type BandCheck = { slot: string; ok: boolean; why: string | null };

/** H94: each slot inside the band, or the first edge it crosses. Half a pixel of rounding is allowed. */
export function bandChecks(slots: readonly BandSlot[], tolerance = 0.5): BandCheck[] {
  const B = VIDEO_BAND;
  const px = (v: number) => Math.round(v * 10) / 10;
  return slots.map(({ slot, box, baseline }) => {
    const right = box.left + box.width;
    const bottom = box.top + box.height;
    const why =
      box.left < B.left - tolerance
        ? `left ${px(box.left)} < ${B.left}`
        : right > B.right + tolerance
          ? `right ${px(right)} > ${B.right}`
          : box.top < B.firstInk - tolerance
            ? `top ${px(box.top)} above ${B.firstInk}`
            : baseline != null && baseline > B.lastBaseline + tolerance
              ? `baseline ${px(baseline)} below ${B.lastBaseline}`
              : bottom > B.bottom + tolerance
                ? `bottom ${px(bottom)} below ${B.bottom}`
                : null;
    return { slot, ok: why == null, why };
  });
}

/** The report's band column: ✓ with the count, or ✗ naming each slot out of the band. */
export function bandWord(checks: readonly BandCheck[]): string {
  const off = checks.filter((c) => !c.ok);
  return off.length ? `✗ ${off.map((c) => `${c.slot}: ${c.why}`).join("; ")}` : `✓ (${checks.length} in the band)`;
}

/** T1 on a clip (O97): the lockup, the name, the date and each claim line as band slots. 9:16 only. */
export function t1BandSlots(layout: ClipLayout): BandSlot[] {
  if (layout.format !== "9:16") throw new Error("the band is the 9:16's (O95)");
  const { lockup, name, date } = layout.pieces;
  const line = (slot: string, at: { left: number; top: number; width: number }, capPx: number): BandSlot => ({
    slot,
    box: { left: at.left, top: at.top, width: at.width, height: capPx },
    baseline: at.top + capPx,
  });
  return [
    ...(lockup ? [{ slot: "lockup", box: lockup.at }] : []),
    line("name", name.at, name.piece.capPx * name.at.scale),
    line(`date (${layout.arrangement})`, date.at, date.piece.capPx * date.at.scale),
    ...layout.claim.map((c, i) => line(`claim line ${i + 1}`, { left: (layout.size.width - c.widthPx) / 2, top: c.capTop, width: c.widthPx }, c.capPx)),
  ];
}

// ─── O99: the UGC caption box ───────────────────────────────────────────────

/** x 120–944: 824 px, the widest box centred on the measured 0.493 W that stays inside x 120. */
export const CAPTION_BAND_BOX = { left: 120, right: 944, width: 824 } as const;

/** The band as the caption profile's 9:16 safeRect would hold it (fractions of 1080 × 1920); v1.json still holds the old 4:5. */
export const CAPTION_SAFE_RECT_BAND = {
  x: VIDEO_BAND.left / 1080,
  y: VIDEO_BAND.top / 1920,
  w: (VIDEO_BAND.right - VIDEO_BAND.left) / 1080,
  h: (VIDEO_BAND.bottom - VIDEO_BAND.top) / 1920,
} as const;

/** The caption box as the preview's insets (% of the frame width), replacing captionBoxInsets(0.493) = 7.3 / 8.7. */
export function captionBandInsetsPct(): { left: number; right: number } {
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return { left: round((CAPTION_BAND_BOX.left / 1080) * 100), right: round(((1080 - CAPTION_BAND_BOX.right) / 1080) * 100) };
}

type Advances = { unitsPerEm: number; axes: Record<string, number>; advances: Record<string, number> };
const ADV = advancesJson as Advances;

/** One character's advance in em, TikTok Sans at the caption's axes (opsz 36, wdth 120, wght 400). A glyph the face lacks (emoji) is one em. */
export function captionCharEm(char: string): number {
  const cp = char.codePointAt(0);
  if (cp == null) return 0;
  const units = ADV.advances[String(cp)];
  return units == null ? 1 : units / ADV.unitsPerEm;
}

/** A line's width at the render's size: the advances plus the outside stroke on both ends. */
export function captionLineInkPx(text: string, size: CaptionSize = "default", outputWidth = 1080): number {
  const fontPx = captionLimits(size).fontSizePctOfWidth * outputWidth;
  const strokePx = profile.strokeWidthPctOfFontSize * fontPx;
  let em = 0;
  for (const char of text) em += captionCharEm(char);
  return em * fontPx + 2 * strokePx;
}

/** The same words the Lab shows for a caption that doesn't fit (surface.ts's too-long line). */
export const CAPTION_TOO_LONG = "This caption is too long — shorten it.";

export type CaptionBandSize =
  | { ok: true; size: CaptionSize; widestPx: number }
  | { ok: false; line: typeof CAPTION_TOO_LONG; widestPx: number };

/**
 * O99: a caption keeps the size the character check gave it when every line
 * measures ≤ 824 px. A default line wider than that moves the caption to
 * the long profile (its lines as wrapped for long). If a long line is still
 * wider, the caption is refused with the existing words.
 */
export function captionSizeInBand(lines: { default: readonly string[]; long: readonly string[] }, chosen: CaptionSize = "default"): CaptionBandSize {
  const widest = (ls: readonly string[], size: CaptionSize) => Math.max(0, ...ls.map((l) => captionLineInkPx(l, size)));
  if (chosen === "default") {
    const w = widest(lines.default, "default");
    if (w <= CAPTION_BAND_BOX.width + 1e-6) return { ok: true, size: "default", widestPx: w };
  }
  const w = widest(lines.long, "long");
  if (w <= CAPTION_BAND_BOX.width + 1e-6) return { ok: true, size: "long", widestPx: w };
  return { ok: false, line: CAPTION_TOO_LONG, widestPx: w };
}

/**
 * A caption's line boxes on the 9:16 (centred on 0.493 W and its block
 * centre, one line-height each) as band slots: the caption box's edges
 * (x 120–944) and the band's top and bottom.
 */
export function captionBandSlots(lines: readonly string[], size: CaptionSize, centerY: number, outputWidth = 1080): BandSlot[] {
  const fontPx = captionLimits(size).fontSizePctOfWidth * outputWidth;
  const lineHeight = fontPx * profile.lineHeight;
  const centerX = profile.horizontalCenterPctOfWidth * outputWidth;
  const top = centerY - (lines.length * lineHeight) / 2;
  return lines.map((text, i) => {
    const width = captionLineInkPx(text, size, outputWidth);
    return { slot: `caption line ${i + 1}`, box: { left: centerX - width / 2, top: top + i * lineHeight, width, height: lineHeight } };
  });
}

/** O99's box edges for caption slots: a line passes when it's inside x 120–944 as well as the band. */
export function captionBoxChecks(slots: readonly BandSlot[]): BandCheck[] {
  return bandChecks(slots).map((c, i) => {
    if (!c.ok) return c;
    const b = slots[i]!.box;
    const right = b.left + b.width;
    return right > CAPTION_BAND_BOX.right + 0.5 ? { slot: c.slot, ok: false, why: `right ${Math.round(right * 10) / 10} > ${CAPTION_BAND_BOX.right}` } : c;
  });
}

// ─── O95, O102: one 9:16 ────────────────────────────────────────────────────

/** O95: what a T1 clip, T2 clip or caption render makes. Photo statics keep their three formats. */
export const VIDEO_RENDER_FORMATS = ["9:16"] as const;

/**
 * O102: a render row is offered (proposed, re-rendered, at launch, in
 * "From the Lab") only when it is a 9:16 video, or a static. A 4:5 or 1:1
 * video row is kept for the record and never deleted. A missing kind is a
 * video row from before migration 199.
 */
export function isOfferedRender(row: { kind?: unknown; aspect: unknown }): boolean {
  const kind = row.kind == null ? "video" : row.kind;
  if (kind === "static") return true;
  return kind === "video" && String(row.aspect) === "9:16";
}

/** O102: split rows into the ones offered and the ones only kept. Nothing is dropped. */
export function splitOfferedRenders<T extends { kind?: unknown; aspect: unknown }>(rows: readonly T[]): { offered: T[]; kept: T[] } {
  const offered: T[] = [];
  const kept: T[] = [];
  for (const row of rows) (isOfferedRender(row) ? offered : kept).push(row);
  return { offered, kept };
}
