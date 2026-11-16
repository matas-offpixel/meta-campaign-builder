/**
 * PH7 (docs/design-record/2026-11-15-dashboard-v2-presale-creatives-budget.html):
 * dates in Europe/London. The current year is `nowMs`'s, never the clock
 * read inside a frame.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Frames and their tests. 15 Nov 2026, so 2026 is the current year. */
export const FRAME_NOW_MS = Date.parse("2026-11-15T12:00:00Z");

export function londonParts(iso: string | number): { year: string; month: string; day: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function londonYear(iso: string | number): string | null {
  return londonParts(iso)?.year ?? null;
}

/** "14 Nov", or "14 Nov 2025" when that day is not in the current year. */
export function dayText(day: string, nowMs: number): string {
  const [year, month, date] = day.split("-");
  const words = `${Number(date)} ${MONTHS[Number(month) - 1] ?? ""}`.trim();
  return year && year !== londonYear(nowMs) ? `${words} ${year}` : words;
}

/** An instant as a London day and 24-hour time: "9 Sep, 11:30". */
export function instantText(iso: string, nowMs: number): string {
  const parts = londonParts(iso);
  if (!parts) return "—";
  const day = dayText(`${parts.year}-${parts.month}-${parts.day}`, nowMs);
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  return `${day}, ${clock}`;
}

function words(day: string): string {
  return `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1] ?? ""}`.trim();
}

/**
 * A period. No start: "Since launch · to 14 Nov".
 * Across years, both years. An earlier year, once at the end.
 */
export function periodText(from: string | null, to: string, nowMs: number): string {
  const now = londonYear(nowMs);
  const end = words(to);
  const endYear = to.slice(0, 4);
  const endText = endYear !== now ? `${end} ${endYear}` : end;
  if (!from) return `Since launch · to ${endText}`;
  const start = words(from);
  const startYear = from.slice(0, 4);
  if (startYear !== endYear) return `${start} ${startYear} – ${end} ${endYear}`;
  if (from === to) return endText;
  return endYear !== now ? `${start} – ${end} ${endYear}` : `${start} – ${end}`;
}
