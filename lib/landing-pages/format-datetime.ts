/**
 * lib/landing-pages/format-datetime.ts
 *
 * Pure, testable date-formatting helpers for the Supreme renderer (PR 7).
 * Extracted out of the component tree (unlike the PR-6-era formatters
 * still living inline in landing-page.tsx) specifically because these two
 * strings are copy-sensitive — Matas's spec calls out an EXACT format
 * (including a deliberate Title Case exception) that is easy to regress
 * silently inside JSX. Always Europe/London — this is a UK agency (same
 * rule as the header timestamp it replaces).
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

/**
 * "On sale: HH:mm EEE d MMMM" — e.g. "On sale: 12:00 Fri 10 July".
 *
 * Title Case here is a DELIBERATE, one-line exception to the page's
 * lowercase-everywhere convention (Matas's explicit spec) — do not
 * lowercase this string.
 */
export function formatOnSaleHeaderLabel(iso: string): string {
  const p = londonParts(iso, {
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `On sale: ${p.hour}:${p.minute} ${p.weekday} ${p.day} ${p.month}`;
}

/**
 * "d MMM at HH:mm" — e.g. "10 Jul at 12:00". Used inside the post-signup
 * confirmation sentence, which stays lowercase like the rest of the form
 * copy (the header label above is the only Title Case exception).
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
