/**
 * WindowBar — timeline maths. Moments are facts; start/end are the
 * two handles. Snap within 8px of a moment; clamp when a handle lands
 * on one. Keyboard: 1h, shift = 1d.
 */

import { formatVizRelative } from "./format-moment.ts";

export const WINDOW_SNAP_PX = 8;
export const WINDOW_ARROW_MS = 60 * 60 * 1000;
export const WINDOW_SHIFT_ARROW_MS = 24 * 60 * 60 * 1000;

export type WindowMomentKind = "now" | "presale" | "gen sale" | "show";

export type WindowMoment = {
  id: string;
  label: string;
  at: Date;
};

export type WindowHandle = "start" | "end";

export const WINDOW_MOMENT_GLYPH: Record<string, string> = {
  now: "◐",
  presale: "⊙",
  "gen sale": "★",
  show: "▲",
};

export const WINDOW_PLACEHOLDER_KINDS = ["presale", "gen sale"] as const;
export type WindowPlaceholderKind = (typeof WINDOW_PLACEHOLDER_KINDS)[number];

export type WindowPlaceholder = {
  id: string;
  label: WindowPlaceholderKind;
  ratio: number;
  tip: string;
};

function momentMatches(moment: WindowMoment, kind: string): boolean {
  return moment.label === kind || moment.id === kind || moment.id === kind.replace(" ", "-");
}

function existingRatio(
  moments: WindowMoment[],
  kind: string,
  from: number,
  to: number,
): number | null {
  const found = moments.find((moment) => momentMatches(moment, kind));
  return found ? dateToRatio(found.at, from, to) : null;
}

export function placeholderRatio(
  kind: WindowPlaceholderKind,
  moments: WindowMoment[],
  from: number,
  to: number,
): number {
  const now = existingRatio(moments, "now", from, to);
  const show = existingRatio(moments, "show", from, to);
  const presale = existingRatio(moments, "presale", from, to);
  const genSale = existingRatio(moments, "gen sale", from, to);
  if (kind === "presale") {
    if (now == null && genSale == null && show == null) return 1 / 3;
    return ((now ?? 0) + (genSale ?? show ?? 1)) / 2;
  }
  if (presale == null && now == null && show == null) return 2 / 3;
  return ((presale ?? now ?? 0) + (show ?? 1)) / 2;
}

export function windowPlaceholders(
  moments: WindowMoment[],
  from: number,
  to: number,
): WindowPlaceholder[] {
  return WINDOW_PLACEHOLDER_KINDS.filter(
    (kind) => !moments.some((moment) => momentMatches(moment, kind)),
  ).map((kind) => ({
    id: `placeholder-${kind.replace(" ", "-")}`,
    label: kind,
    ratio: placeholderRatio(kind, moments, from, to),
    tip:
      kind === "presale"
        ? "this event has no presale time set — add it on the event to snap the window to it"
        : "this event has no gen-sale time set — add it on the event to snap the window to it",
  }));
}

export function momentGlyph(label: string): string {
  return WINDOW_MOMENT_GLYPH[label] ?? "○";
}

export function windowSpanMs(start: Date, end: Date, min?: Date): { from: number; to: number } {
  const from = Math.min(start.getTime(), min?.getTime() ?? start.getTime());
  const to = Math.max(end.getTime(), from + 1);
  return { from, to };
}

export function dateToRatio(at: Date, from: number, to: number): number {
  const span = to - from;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, (at.getTime() - from) / span));
}

export function ratioToDate(ratio: number, from: number, to: number): Date {
  const clamped = Math.max(0, Math.min(1, ratio));
  return new Date(from + clamped * (to - from));
}

export function snapToMoments(
  at: Date,
  moments: WindowMoment[],
  from: number,
  to: number,
  trackPx: number,
): { at: Date; clamped: boolean; momentId: string | null } {
  if (trackPx <= 0 || moments.length === 0) {
    return { at, clamped: false, momentId: null };
  };
  const pxPerMs = trackPx / Math.max(1, to - from);
  let nearest: WindowMoment | null = null;
  let nearestPx = Infinity;
  for (const moment of moments) {
    const px = Math.abs(moment.at.getTime() - at.getTime()) * pxPerMs;
    if (px < nearestPx) {
      nearestPx = px;
      nearest = moment;
    }
  }
  if (nearest && nearestPx <= WINDOW_SNAP_PX) {
    return { at: nearest.at, clamped: true, momentId: nearest.id };
  }
  return { at, clamped: false, momentId: null };
}

export function applyWindowHandle(
  handle: WindowHandle,
  next: Date,
  current: { start: Date; end: Date },
  min?: Date,
): { start: Date; end: Date } {
  const floor = min ?? current.start;
  if (handle === "start") {
    const start = next.getTime() < floor.getTime() ? floor : next;
    const end = current.end.getTime() < start.getTime() ? start : current.end;
    return { start, end };
  }
  const end = next.getTime() < current.start.getTime() ? current.start : next;
  return { start: current.start, end };
}

export function nudgeWindowHandle(
  handle: WindowHandle,
  current: { start: Date; end: Date },
  direction: -1 | 1,
  shift: boolean,
  min?: Date,
): { start: Date; end: Date } {
  const delta = (shift ? WINDOW_SHIFT_ARROW_MS : WINDOW_ARROW_MS) * direction;
  const base = handle === "start" ? current.start : current.end;
  return applyWindowHandle(handle, new Date(base.getTime() + delta), current, min);
}

/** Relative time under a moment — delegates to formatVizRelative. */
export function relativeMomentLabel(at: Date, now: Date): string {
  return formatVizRelative(at, now);
}

export type WindowBarState = "default" | "dragging" | "clamped";
