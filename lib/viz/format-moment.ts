/**
 * "Fri 6 Sep · 23:00", Europe/London, always. This is a UK agency and
 * every plan window, moment and schedule row is read in London time.
 * Deliberately NOT shared with lib/landing-pages/format-datetime.ts —
 * that module is fan-facing and its formats are copy-locked.
 *
 * Month comes from a fixed table: en-GB `month: "short"` renders
 * September as "Sept". Day is re-numbered: `day: "numeric"` alongside
 * `hour: "2-digit"` zero-pads ("06").
 */

const VIZ_MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const TZ = "Europe/London";

function londonParts(input: string | Date): Record<string, string> | null {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
}

function formatDayParts(input: string | Date): string | null {
  const parts = londonParts(input);
  if (!parts) return null;
  const month = VIZ_MONTH[Number(parts.month) - 1];
  if (!month) return null;
  return `${parts.weekday} ${Number(parts.day)} ${month}`;
}

/** "Fri 6 Sep · 23:00" */
export function formatVizMoment(iso: string | Date): string {
  const day = formatDayParts(iso);
  const parts = londonParts(iso);
  if (!day || !parts) return "—";
  return `${day} · ${parts.hour}:${parts.minute}`;
}

/** "Fri 6 Sep" */
export function formatVizDay(iso: string | Date): string {
  return formatDayParts(iso) ?? "—";
}

/** "in 29d" · "2h ago" · "now". Invalid input is "—", never the input string. */
export function formatVizRelative(iso: string | Date, now: Date = new Date()): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) return "—";
  const ms = date.getTime() - now.getTime();
  const abs = Math.abs(ms);
  const day = 86_400_000;
  const hour = 3_600_000;
  if (abs < hour) return "now";
  if (abs < day) {
    const hours = Math.round(abs / hour);
    return ms >= 0 ? `in ${hours}h` : `${hours}h ago`;
  }
  const days = Math.round(abs / day);
  return ms >= 0 ? `in ${days}d` : `${days}d ago`;
}
