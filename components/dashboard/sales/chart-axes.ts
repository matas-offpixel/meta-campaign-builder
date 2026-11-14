/** N1 axis maths. Pure, so the chart can stay a render of these numbers. */

export const AXIS_MANTISSAS = [1, 1.5, 2, 2.5, 3, 4, 5] as const;
export const DATE_STEPS = [1, 2, 3, 7, 14, 21, 28] as const;
/** "12 Nov" at 10.5px is about 35px. Labels must clear by 6px. */
export const DATE_LABEL_PX = 35;
export const DATE_CLEAR_PX = 6;

export type DateAnchor = "start" | "center" | "end";
export type DateCandidate = { index: number; x: number; label: string };
export type FittedDateLabel = DateCandidate & { anchor: DateAnchor; left: number; right: number };

/**
 * A date label's width as drawn, from per-character advances of the UI sans
 * at `fontPx`, rounded up so the 6 px check errs wide. The browser measures
 * the real text instead (`measureDateLabel`); this is the fallback (tests,
 * the server render).
 */
export function estimateDateLabelWidth(label: string, fontPx: number): number {
  let em = 0;
  for (const ch of label) {
    // Measured against the 375 frames: "13 Nov" is about 40 px and "6 Nov" about 30 px at 11 px.
    if (/[0-9]/.test(ch)) em += 0.62;
    else if (ch === " " || ch === "\u00a0") em += 0.32;
    else if (/[A-Z]/.test(ch)) em += 0.78;
    else em += 0.6;
  }
  return Math.ceil(em * fontPx) + 1;
}

let canvas: HTMLCanvasElement | null = null;

/** The label's real rendered width in the page's own font, else the estimate. */
export function measureDateLabel(label: string, fontPx: number): number {
  try {
    if (typeof document === "undefined") return estimateDateLabelWidth(label, fontPx);
    canvas ??= document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return estimateDateLabelWidth(label, fontPx);
    ctx.font = `${fontPx}px ${getComputedStyle(document.body).fontFamily}`;
    const width = ctx.measureText(label).width;
    return width > 0 ? Math.ceil(width) : estimateDateLabelWidth(label, fontPx);
  } catch {
    return estimateDateLabelWidth(label, fontPx);
  }
}

/** Where a label sits on its x: the last day end-anchored; a label whose centred box would cross an edge, anchored to that edge; else centred. */
export function dateAnchor(index: number, lastIndex: number, x: number, rowWidth: number, width: number): DateAnchor {
  if (index === lastIndex) return "end";
  if (x - width / 2 < 0) return "start";
  if (x + width / 2 > rowWidth) return "end";
  return "center";
}

/**
 * N1's 6 px rule on where labels really land (design-ruled, 14 Nov). Labels
 * are placed by the step first (the caller's candidates); then, from the end
 * leftwards, a label whose rendered box comes within `gap` of the label to
 * its right is not drawn. The end label always stays, end-anchored at the
 * last day; it is never stepped inward and the step never varies. In a scroll
 * window, a label the window's edge would cut is not drawn either.
 */
export function fitDateLabels(
  candidates: readonly DateCandidate[],
  lastIndex: number,
  opts: {
    rowWidth: number;
    width: (label: string) => number;
    gap?: number;
    viewLeft?: number;
    viewRight?: number;
    /** The desktop chart draws every label centred (1280 is unchanged); the check still runs on those boxes. */
    centred?: boolean;
  },
): FittedDateLabel[] {
  const gap = opts.gap ?? DATE_CLEAR_PX;
  const kept: FittedDateLabel[] = [];
  for (const c of [...candidates].sort((a, b) => b.x - a.x)) {
    const w = opts.width(c.label);
    const anchor = opts.centred ? "center" : dateAnchor(c.index, lastIndex, c.x, opts.rowWidth, w);
    const left = anchor === "start" ? c.x : anchor === "end" ? c.x - w : c.x - w / 2;
    const box = { ...c, anchor, left, right: left + w };
    if (c.index !== lastIndex) {
      const next = kept[kept.length - 1];
      if (next && box.right + gap > next.left) continue;
      if (opts.viewLeft != null && box.left < opts.viewLeft) continue;
      if (opts.viewRight != null && box.right > opts.viewRight) continue;
    }
    kept.push(box);
  }
  return kept.reverse();
}

/** Smallest step from the mantissa set whose `intervals` cover `peak`. */
export function axisStep(peak: number, intervals: number): number {
  if (!(peak > 0) || intervals < 1) return 1;
  const raw = peak / intervals;
  const exp = Math.floor(Math.log10(raw));
  const pow = 10 ** exp;
  for (const mantissa of AXIS_MANTISSAS) {
    const step = roundStep(mantissa * pow);
    if (step * intervals >= peak - 1e-9) return step;
  }
  return roundStep(10 * pow);
}

export function axisCeiling(peak: number, intervals: number): number {
  return axisStep(peak, intervals) * intervals;
}

export function axisTicks(peak: number, intervals: number): number[] {
  const step = axisStep(peak, intervals);
  return Array.from({ length: intervals + 1 }, (_, index) => roundStep(step * index));
}

function roundStep(step: number): number {
  if (!Number.isFinite(step) || step === 0) return 0;
  const digits = Math.max(0, 8 - Math.ceil(Math.log10(Math.abs(step))));
  return Number(step.toFixed(Math.min(8, digits)));
}

export function formatMoneyTick(value: number, narrow: boolean): string {
  if (narrow && Math.abs(value) >= 1000) return `£${compact(value)}`;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

export function formatCountTick(value: number, narrow: boolean): string {
  if (narrow && Math.abs(value) >= 1000) return compact(value);
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);
}

function compact(value: number): string {
  const k = value / 1000;
  return `${Number.isInteger(k) ? k : Number(k.toFixed(1))}k`;
}

/**
 * Smallest day step whose labels clear each other. Anchored to the last
 * day by the caller. Since launch across ~98 days is every 7 days at a
 * wide plot and every 21 at 393.
 */
export function dateStepDays(spanDays: number, plotWidthPx: number, labelPx = DATE_LABEL_PX): number {
  const span = Math.max(1, spanDays);
  const need = labelPx + DATE_CLEAR_PX;
  for (const step of DATE_STEPS) {
    if ((step / span) * plotWidthPx >= need) return step;
  }
  return DATE_STEPS[DATE_STEPS.length - 1];
}

/** Indexes whose day is a whole number of `stepDays` back from the last day. */
export function anchoredDateIndexes(days: readonly string[], stepDays: number): number[] {
  if (days.length === 0) return [];
  const end = Date.parse(`${days[days.length - 1]}T00:00:00Z`);
  const indexes: number[] = [];
  days.forEach((day, index) => {
    const delta = Math.round((end - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
    if (delta >= 0 && delta % stepDays === 0) indexes.push(index);
  });
  return indexes;
}

export function daySpan(days: readonly string[]): number {
  if (days.length < 2) return 1;
  const start = Date.parse(`${days[0]}T00:00:00Z`);
  const end = Date.parse(`${days[days.length - 1]}T00:00:00Z`);
  return Math.max(1, Math.round((end - start) / 86_400_000));
}
