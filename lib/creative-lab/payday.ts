/** Last Friday of the calendar month, then the days from a London today to the event. */

function londonDay(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

/** Day-of-month of the last Friday. `month` is 1–12. */
export function lastFridayOfMonth(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month, 0));
  let day = last.getUTCDate();
  let dow = last.getUTCDay();
  while (dow !== 5) {
    day -= 1;
    dow = (dow + 6) % 7;
  }
  return day;
}

export function nextPayday(now = new Date()): { iso: string; label: string } {
  const today = londonDay(now);
  let year = today.year;
  let month = today.month;
  let day = lastFridayOfMonth(year, month);
  if (day < today.day) {
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
    day = lastFridayOfMonth(year, month);
  }
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${iso}T12:00:00Z`));
  return { iso, label };
}

/** Whole London calendar days from today to the event. Negative once the date has passed. */
export function daysUntilEvent(eventDate: string | null | undefined, now = new Date()): number | null {
  const day = eventDate?.slice(0, 10);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const today = londonDay(now);
  const from = Date.parse(`${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}T00:00:00Z`);
  const to = Date.parse(`${day}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}
