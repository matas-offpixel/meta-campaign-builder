/**
 * lib/landing-pages/format-datetime.ts
 *
 * Pure, testable date-formatting helpers for the Supreme renderer (PR 7,
 * extended PR 8). Extracted out of the component tree (unlike the
 * PR-6-era formatters still living inline in landing-page.tsx) specifically
 * because these strings are copy-sensitive — Matas's specs call out EXACT
 * formats that are easy to regress silently inside JSX. Always Europe/London
 * — this is a UK agency.
 */

function londonParts(
  iso: string,
  options: Intl.DateTimeFormatOptions,
): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    ...options,
    timeZone: "Europe/London",
  }).formatToParts(new Date(iso));
  return Object.fromEntries(
    parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
}

/** Shared "HH:mm EEE d MMMM" piece behind both header labels below. */
function fullDateTimeLabel(iso: string): string {
  const p = londonParts(iso, {
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${p.hour}:${p.minute} ${p.weekday} ${p.day} ${p.month}`;
}

/**
 * "Presale: HH:mm EEE d MMMM" — e.g. "Presale: 11:00 Wed 8 July". PR 8:
 * replaces the countdown block's old "PRESALE OPENS IN" + ticket-icon
 * header with this static line, formatted from the SAME `targetAt` the
 * ticker below counts down to (component-level concern — this module
 * only formats whatever ISO string it's given).
 *
 * "Presale" is a literal capitalised label, not a page-wide Title Case
 * rule — matches the sentence-case spec (contrast the historical
 * PR-7 "On sale:" header label this superseded, which is now removed).
 */
export function formatPresaleHeaderLabel(iso: string): string {
  return `Presale: ${fullDateTimeLabel(iso)}`;
}

/**
 * "d MMM at HH:mm" — e.g. "10 Jul at 12:00". Used inside the post-signup
 * confirmation sentence, which stays lowercase like the rest of the form
 * copy.
 */
export function formatPresaleNotifyDate(iso: string): string {
  const p = londonParts(iso, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${p.day} ${p.month} at ${p.hour}:${p.minute}`;
}

/**
 * "EEE d MMM" — e.g. "Sun 16 Aug". PR 8's header meta row: the event date
 * (from events.event_start_at), paired with view.venueShort. No year, no
 * time — this is a short "when" label, not a receipt.
 */
export function formatEventDateShort(iso: string): string {
  const p = londonParts(iso, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return `${p.weekday} ${p.day} ${p.month}`;
}
