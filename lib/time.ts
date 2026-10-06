/**
 * Wall-clock conversions. The wizard stores datetime-local strings with no
 * offset; the zone lives on the draft (`budgetSchedule.timezone`).
 */

export function zoneParts(instant: Date, timezone: string): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
} {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    year: parts.year ?? "0000",
    month: parts.month ?? "01",
    day: parts.day ?? "01",
    hour: parts.hour === "24" ? "00" : (parts.hour ?? "00"),
    minute: parts.minute ?? "00",
    second: parts.second ?? "00",
  };
}

/** Local datetime-local string → the UTC instant that clock shows in `timezone`. */
export function zonedLocalToUtc(local: string, timezone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const want = Date.UTC(year, month - 1, day, hour, minute);
  let utc = want;
  for (let pass = 0; pass < 2; pass++) {
    const seen = zoneParts(new Date(utc), timezone);
    const seenUtc = Date.UTC(
      Number(seen.year),
      Number(seen.month) - 1,
      Number(seen.day),
      Number(seen.hour),
      Number(seen.minute),
    );
    const delta = want - seenUtc;
    if (delta === 0) return new Date(utc);
    utc += delta;
  }
  return new Date(utc);
}
