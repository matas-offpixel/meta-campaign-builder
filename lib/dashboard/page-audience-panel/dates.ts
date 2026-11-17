/**
 * lib/dashboard/page-audience-panel/dates.ts
 *
 * PH7 (docs/design-record/2026-11-15-dashboard-v2-presale-creatives-budget.html)
 * for the HE2 panel's dated words: Europe/London; within the current year,
 * no year; a day from an earlier year carries it. The current year is the
 * caller's `nowMs`, so frames and tests never move on 1 January.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Frames and their tests: 16 Nov 2026, the day the fixture was read. */
export const PANEL_FRAME_NOW_MS = Date.parse("2026-11-16T12:00:00Z");

/** The calendar day of an instant in a zone, YYYY-MM-DD. */
export function dayInZone(instant: string | number, timeZone = "Europe/London"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "16 Nov", or "1 Dec 2022" when the day isn't in `nowMs`'s London year. */
export function dayWords(day: string, nowMs: number): string {
  const [year, month, date] = day.split("-");
  const words = `${Number(date)} ${MONTHS[Number(month) - 1] ?? ""}`.trim();
  return year && year !== dayInZone(nowMs).slice(0, 4) ? `${words} ${year}` : words;
}

/** Whole days between two YYYY-MM-DD days. */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
