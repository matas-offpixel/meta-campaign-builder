/**
 * Europe/London calendar text with a normal space.
 * Server and browser Intl disagree on the separator, which hydrates as React #418.
 */

export function londonDayMonth(input: string | Date): string {
  const raw = typeof input === "string" ? input.trim() : "";
  const date = typeof input === "string"
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw)
    : input;
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
  }).formatToParts(date);
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  if (!day || !month) return "";
  return `${day} ${month}`;
}

/** "Today · 10 Nov". The frame default stays on the panel; the event page passes this. */
export function todayMark(nowIso: string): string {
  const label = londonDayMonth(nowIso);
  return label ? `Today · ${label}` : "Today";
}
