/** N1 axis maths. Pure, so the chart can stay a render of these numbers. */

export const AXIS_MANTISSAS = [1, 1.5, 2, 2.5, 3, 4, 5] as const;
export const DATE_STEPS = [1, 2, 3, 7, 14, 21, 28] as const;
/** "12 Nov" at 10.5px is about 35px. Labels must clear by 6px. */
export const DATE_LABEL_PX = 35;
export const DATE_CLEAR_PX = 6;

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
