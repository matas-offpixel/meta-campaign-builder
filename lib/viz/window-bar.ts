/**
 * WindowBar — timeline maths. Moments are facts; start/end are the
 * two handles. Snap within 8px of a moment; clamp when a handle lands
 * on one. Keyboard: 1h, shift = 1d.
 */

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
  now: "●",
  presale: "○",
  "gen sale": "○",
  show: "◆",
};

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

/** Relative time under a moment — "in 2d" / "2d ago", tabular-nums ready. */
export function relativeMomentLabel(at: Date, now: Date): string {
  const ms = at.getTime() - now.getTime();
  const abs = Math.abs(ms);
  const day = 86_400_000;
  const hour = 3_600_000;
  if (abs < hour) return ms >= 0 ? "now" : "now";
  if (abs < day) {
    const hours = Math.round(abs / hour);
    return ms >= 0 ? `in ${hours}h` : `${hours}h ago`;
  }
  const days = Math.round(abs / day);
  return ms >= 0 ? `in ${days}d` : `${days}d ago`;
}

export type WindowBarState = "default" | "dragging" | "clamped";
