/**
 * lib/dashboard/sales-calc/days.ts
 *
 * Calendar-day arithmetic on ISO days (yyyy-mm-dd), in UTC so a day is
 * always 24 hours. London days are worked out once, at the edge
 * (`londonDay`), and everything after that is a plain calendar day.
 */

const DAY_MS = 86_400_000;

function ms(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export function addDays(day: string, n: number): string {
  return new Date(ms(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b − a). */
export function dayDiff(a: string, b: string): number {
  return Math.round((ms(b) - ms(a)) / DAY_MS);
}

/** Every day from `a` to `b`, both included. Empty when b < a. */
export function daysBetween(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "12 Nov". */
export function shortDay(day: string): string {
  return new Date(ms(day)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "Sat 21 Nov". */
export function weekdayDay(day: string): string {
  const d = new Date(ms(day));
  const weekday = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  return `${weekday} ${shortDay(day)}`;
}

/** The London calendar day of an instant. */
export function londonDay(at: Date | string): string {
  const instant = typeof at === "string" ? new Date(at) : at;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}
