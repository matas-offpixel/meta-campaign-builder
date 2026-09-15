/**
 * Cirqlin `daily[].day` is a Europe/London calendar date. Sentinel
 * rows must use the same zone or they land on a different day key
 * around midnight BST.
 */
export function londonCalendarDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
