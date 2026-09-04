import { formatVizDay, formatVizMoment } from "../viz/format-moment.ts";

/** A date-only or datetime string the operator reads on canvas / details. */
export function formatPlanScheduleInstant(
  date: string | null | undefined,
  time?: string | null,
): string {
  if (!date) return "—";
  if (/T/.test(date)) return formatVizMoment(date);
  if (time) {
    const clock = time.length === 5 ? `${time}:00` : time;
    return formatVizMoment(`${date}T${clock}`);
  }
  return formatVizDay(date);
}

export function formatPlanScheduleRange(
  start: string | null | undefined,
  end?: string | null,
  startTime?: string | null,
  endTime?: string | null,
): string | null {
  if (!start) return null;
  const left = formatPlanScheduleInstant(start, startTime);
  if (!end) return left;
  return `${left} → ${formatPlanScheduleInstant(end, endTime)}`;
}
