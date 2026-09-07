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

export const WINDOW_PLACEHOLDER_KINDS = ["announcement", "presale", "gen sale"] as const;
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
  if (kind === "announcement") {
    if (now == null && presale == null && genSale == null && show == null) return 1 / 6;
    return ((now ?? 0) + (presale ?? genSale ?? show ?? 1)) / 2;
  }
  if (kind === "presale") {
    if (now == null && genSale == null && show == null) return 1 / 3;
    return ((now ?? 0) + (genSale ?? show ?? 1)) / 2;
  }
  if (presale == null && now == null && show == null) return 2 / 3;
  return ((presale ?? now ?? 0) + (show ?? 1)) / 2;
}

export const WINDOW_MISSING_TIP = "not set on the event";

/** Operator order on the missing line — not announcement-first. */
const WINDOW_MISSING_LINE_ORDER: readonly WindowPlaceholderKind[] = [
  "presale",
  "announcement",
  "gen sale",
];

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
    tip: WINDOW_MISSING_TIP,
  }));
}

/**
 * Moments the event does not have — one dashed line beneath the rail,
 * never marks on it. `presale · announcement — not set on the event`.
 */
export function windowMissingMomentsLine(
  moments: readonly WindowMoment[],
): { kinds: WindowPlaceholderKind[]; sentence: string } | null {
  const missing = WINDOW_MISSING_LINE_ORDER.filter(
    (kind) => !moments.some((moment) => momentMatches(moment, kind)),
  );
  if (missing.length === 0) return null;
  return {
    kinds: missing,
    sentence: `${missing.join(" · ")} — ${WINDOW_MISSING_TIP}`,
  };
}

export function momentGlyph(label: string): string {
  if (WINDOW_MOMENT_GLYPH[label]) return WINDOW_MOMENT_GLYPH[label];
  const kinds = Object.keys(WINDOW_MOMENT_GLYPH).sort((a, b) => b.length - a.length);
  for (const kind of kinds) {
    if (label === kind || label.startsWith(`${kind} `) || label.startsWith(`${kind} ·`)) {
      return WINDOW_MOMENT_GLYPH[kind] ?? "○";
    }
  }
  return "○";
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

/** Unclamped — < 0 is before the rail, > 1 is past the end. */
export function dateToRatioRaw(at: Date, from: number, to: number): number {
  const span = to - from;
  if (span <= 0) return 0;
  return (at.getTime() - from) / span;
}

/** Moments whose date sits outside `[start, end]` never draw on the rail. */
export function windowMomentsOnRail(
  moments: readonly WindowMoment[],
  start: Date,
  end: Date,
  min?: Date,
): WindowMoment[] {
  const { from, to } = windowSpanMs(start, end, min);
  return moments.filter((moment) => {
    const ratio = dateToRatioRaw(moment.at, from, to);
    return ratio >= 0 && ratio <= 1;
  });
}

export function windowNowAtEnd(now: Date, start: Date, end: Date, min?: Date): boolean {
  const { from, to } = windowSpanMs(start, end, min);
  const nowPct = dateToRatio(now, from, to) * 100;
  const endPct = dateToRatio(end, from, to) * 100;
  return Math.abs(nowPct - endPct) <= WINDOW_GLYPH_COLLISION_PCT * 100;
}

/** Handle + moment nouns, left-to-right on the rail then the end handle. */
export const WINDOW_RAIL_NOUN_ORDER = [
  "start",
  "end",
  "now",
  "announcement",
  "presale",
  "gen sale",
  "show",
] as const;

export type WindowRailMark = {
  id: string;
  noun: string;
  ratio: number;
  at?: Date;
  placeholder?: boolean;
};

export type WindowRailView = {
  nowAtEnd: boolean;
  endNoun: string;
  startNoun: string;
  moments: WindowMoment[];
  /** Printed nouns on the rail, including the end handle. */
  labels: string[];
  hideGlyphIds: Set<string>;
  hideNounIds: Set<string>;
  joinedLabel: Map<string, string>;
};

const START_MARK_ID = "__start";
const END_MARK_ID = "__end";

export function railNounKind(noun: string, id?: string): string {
  if (id === START_MARK_ID || id === "start") return "start";
  if (id === END_MARK_ID || id === "end") return "end";
  if (id === "now" || noun === "now" || noun.startsWith("now ·")) return "now";
  const kinds = [...WINDOW_RAIL_NOUN_ORDER].sort((a, b) => b.length - a.length);
  for (const kind of kinds) {
    if (noun === kind || noun.startsWith(`${kind} `) || noun.startsWith(`${kind} ·`)) {
      return kind;
    }
  }
  return noun;
}

export function joinRailNouns(marks: readonly { noun: string; id: string }[]): string {
  const used = new Set<string>();
  const ordered: string[] = [];
  for (const kind of WINDOW_RAIL_NOUN_ORDER) {
    const mark = marks.find((item) => railNounKind(item.noun, item.id) === kind);
    if (!mark || used.has(kind)) continue;
    used.add(kind);
    ordered.push(mark.noun);
  }
  for (const mark of marks) {
    const kind = railNounKind(mark.noun, mark.id);
    if (used.has(kind)) continue;
    used.add(kind);
    ordered.push(mark.noun);
  }
  return ordered.join(" · ");
}

/** Union-find: any two marks within 2% of the same position share a cluster. */
export function clusterMarksWithinPct<T extends { ratio: number }>(
  marks: readonly T[],
  pct: number = WINDOW_GLYPH_COLLISION_PCT,
): T[][] {
  const items = [...marks];
  const parent = items.map((_, index) => index);
  const find = (index: number): number => {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]!]!;
      cursor = parent[cursor]!;
    }
    return cursor;
  };
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (Math.abs(items[i]!.ratio - items[j]!.ratio) <= pct) {
        parent[find(j)] = find(i);
      }
    }
  }
  const groups = new Map<number, T[]>();
  for (let i = 0; i < items.length; i += 1) {
    const root = find(i);
    const group = groups.get(root) ?? [];
    group.push(items[i]!);
    groups.set(root, group);
  }
  return [...groups.values()].sort((a, b) => (a[0]?.ratio ?? 0) - (b[0]?.ratio ?? 0));
}

function markTime<T extends { at?: Date; id: string; noun: string }>(mark: T): number {
  if (mark.at) return mark.at.getTime();
  // A mark without a date: `now` is the present; others yield.
  return railNounKind(mark.noun, mark.id) === "now" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
}

function newestRailMark<T extends { at?: Date; id: string; noun: string }>(marks: readonly T[]): T {
  return marks.reduce((best, mark) => {
    const bestAt = markTime(best);
    const nextAt = markTime(mark);
    if (nextAt !== bestAt) return nextAt > bestAt ? mark : best;
    const bestKind = WINDOW_RAIL_NOUN_ORDER.indexOf(
      railNounKind(best.noun, best.id) as (typeof WINDOW_RAIL_NOUN_ORDER)[number],
    );
    const nextKind = WINDOW_RAIL_NOUN_ORDER.indexOf(
      railNounKind(mark.noun, mark.id) as (typeof WINDOW_RAIL_NOUN_ORDER)[number],
    );
    return nextKind > bestKind ? mark : best;
  });
}

/**
 * What the rail prints. Marks within 2% of the same position collapse
 * into one label, nouns in rail order, newest moment's glyph. A show
 * past the window is not a mark. Round 4 (`end === now`, show outside)
 * is still `end · now`.
 */
export function windowRailView(input: {
  start: Date;
  end: Date;
  now: Date;
  moments: readonly WindowMoment[];
  min?: Date;
}): WindowRailView {
  const { from, to } = windowSpanMs(input.start, input.end, input.min);
  const onRail = windowMomentsOnRail(input.moments, input.start, input.end, input.min);
  const marks: WindowRailMark[] = [
    { id: START_MARK_ID, noun: "start", ratio: dateToRatio(input.start, from, to), at: input.start },
    ...onRail.map((moment) => ({
      id: moment.id,
      noun: moment.label,
      ratio: dateToRatio(moment.at, from, to),
      at: moment.at,
    })),
    { id: END_MARK_ID, noun: "end", ratio: dateToRatio(input.end, from, to), at: input.end },
  ];
  const hideGlyphIds = new Set<string>();
  const hideNounIds = new Set<string>();
  const joinedLabel = new Map<string, string>();
  const visible: WindowMoment[] = [];
  const momentNouns: string[] = [];
  let startNoun = "start";
  let endNoun = "end";
  for (const cluster of clusterMarksWithinPct(marks)) {
    const text = joinRailNouns(cluster);
    const hasStart = cluster.some((mark) => mark.id === START_MARK_ID);
    const hasEnd = cluster.some((mark) => mark.id === END_MARK_ID);
    const moments = cluster.filter((mark) => mark.id !== START_MARK_ID && mark.id !== END_MARK_ID);
    if (hasEnd) {
      endNoun = text;
      for (const mark of moments) {
        hideGlyphIds.add(mark.id);
        hideNounIds.add(mark.id);
      }
      continue;
    }
    if (hasStart) {
      startNoun = text;
      for (const mark of moments) {
        hideGlyphIds.add(mark.id);
        hideNounIds.add(mark.id);
      }
      continue;
    }
    if (moments.length === 0) continue;
    const newest = newestRailMark(moments);
    const source = onRail.find((moment) => moment.id === newest.id);
    if (source) visible.push(source);
    if (moments.length > 1) joinedLabel.set(newest.id, text);
    for (const mark of moments) {
      if (mark.id === newest.id) continue;
      hideGlyphIds.add(mark.id);
      hideNounIds.add(mark.id);
    }
    momentNouns.push(text);
  }
  return {
    nowAtEnd: /\bnow\b/.test(endNoun),
    endNoun,
    startNoun,
    moments: visible,
    labels: [...momentNouns, endNoun],
    hideGlyphIds,
    hideNounIds,
    joinedLabel,
  };
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

/**
 * Moment-lane + rail + handle-label lane. The label row is in-flow so
 * the B→C gutter is measured from beneath the labels, not the rail.
 */
export const WINDOW_BAR_HEIGHT_PX = 80;
export const WINDOW_MOMENT_LANE_PX = 28;
export const WINDOW_RAIL_LANE_PX = 16;
export const WINDOW_HANDLE_LABEL_LANE_PX = 36;
export const WINDOW_MOMENT_LABEL_WIDTH = 56;
/** Within 2% of the rail the older yields its glyph (§4.4 / item 23). */
export const WINDOW_GLYPH_COLLISION_PCT = 0.02;

export function boxesIntersect(
  a: { x: number; w: number },
  b: { x: number; w: number },
): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2;
}

/** Hide later moment nouns when their label boxes intersect an earlier kept one. */
export function collapseOverlappingMomentLabels(
  marks: { id: string; x: number; width: number }[],
): Set<string> {
  const hidden = new Set<string>();
  const sorted = [...marks].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
  let kept: { x: number; w: number } | null = null;
  for (const mark of sorted) {
    if (kept && boxesIntersect({ x: kept.x, w: kept.w }, { x: mark.x, w: mark.width })) {
      hidden.add(mark.id);
      continue;
    }
    kept = { x: mark.x, w: mark.width };
  }
  return hidden;
}

/**
 * Left edge of a nowrap handle-label box. Start left-aligns on the handle;
 * end right-aligns. Both clamp so the box stays inside `[0, barWidth]`.
 */
export function handleLabelLeftPx(input: {
  handlePx: number;
  labelWidth: number;
  barWidth: number;
  align: "start" | "end";
}): number {
  const width = Math.min(input.labelWidth, input.barWidth);
  const raw = input.align === "end" ? input.handlePx - width : input.handlePx;
  const maxLeft = Math.max(0, input.barWidth - width);
  return Math.max(0, Math.min(raw, maxLeft));
}

export function estimateHandleLabelWidth(text: string): number {
  return Math.ceil(text.length * 8) + 16;
}

/** Last mark at the rail end right-aligns so the full date stays inside. */
export function momentMarkAlign(ratio: number): "start" | "center" | "end" {
  if (ratio >= 1 - 1e-6) return "end";
  if (ratio <= 1e-6) return "start";
  return "center";
}

export type WindowCollisionMark = {
  id: string;
  noun: string;
  ratio: number;
  extra?: string;
  at?: Date;
  x?: number;
  width?: number;
  /** Placeholder (`not set on the event`) — never joins a cluster. */
  placeholder?: boolean;
};

function markNoun(mark: WindowCollisionMark): string {
  return mark.extra ? `${mark.noun} ${mark.extra}` : mark.noun;
}

/**
 * All marks within 2% of the same position collapse into one label,
 * nouns in rail order, newest moment keeps the glyph. Placeholders
 * stay out of the cluster.
 */
export function resolveMomentGlyphCollision(
  marks: WindowCollisionMark[],
): { hideGlyphIds: Set<string>; hideNounIds: Set<string>; joinedLabel: Map<string, string> } {
  const hideGlyphIds = new Set<string>();
  const hideNounIds = new Set<string>();
  const joinedLabel = new Map<string, string>();
  const real = marks
    .filter((mark) => !mark.placeholder)
    .map((mark) => ({ ...mark, noun: markNoun(mark) }));
  for (const cluster of clusterMarksWithinPct(real)) {
    if (cluster.length < 2) continue;
    const newest = newestRailMark(cluster);
    joinedLabel.set(newest.id, joinRailNouns(cluster));
    for (const mark of cluster) {
      if (mark.id === newest.id) continue;
      hideGlyphIds.add(mark.id);
      hideNounIds.add(mark.id);
    }
  }
  return { hideGlyphIds, hideNounIds, joinedLabel };
}
