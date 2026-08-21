/**
 * Duplicate-name helper for ads / ad sets (and, later, TikTok library copies).
 *
 * Matas names ads `Artist - Type of Asset - number` (e.g. "DJ EZ - Artwork
 * Motion 1"). Duplicating should yield the next unused number in scope
 * ("… Motion 2"), not "… Motion 1 (copy)".
 *
 * Trailing numbers of **any magnitude** are treated as counters — including
 * years ("Ibiza 2026" → "Ibiza 2027"). A year-window or "below 100" cutoff
 * would silently refuse to increment a real high-volume counter and is
 * harder to explain than "edit the name if it guessed wrong". The duplicate
 * is always immediately editable. See
 * `lib/__tests__/duplicate-name.test.ts` ("non-counter trailing numbers").
 */

/** Capture the stem, the exact whitespace (if any) before the number, and the digits. */
const TRAILING_NUMBER = /^(.*?)(\s*)(\d+)$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type ParsedTrailingNumber = {
  prefix: string;
  separator: string;
  number: number;
};

export function parseTrailingNumber(name: string): ParsedTrailingNumber | null {
  const match = TRAILING_NUMBER.exec(name);
  if (!match) return null;
  const prefix = match[1];
  const separator = match[2];
  const digits = match[3];
  // A name that is only digits ("1") still counts; an empty prefix with a
  // separator (" 1") is a trailing number on a blank stem.
  if (digits === undefined || prefix === undefined || separator === undefined) {
    return null;
  }
  return { prefix, separator, number: Number(digits) };
}

/**
 * Next unused duplicate name within `existingNames` (the ads on this ad set
 * / the ad sets on this campaign / whatever scope the caller passes).
 *
 * - Name ends with a number → increment from that number until unused.
 * - Name does not end with a number → append `" 2"`, then the same unused
 *   walk (so "Motion" when "Motion 2" exists becomes "Motion 3").
 * - Separator and spacing before the number are preserved verbatim.
 * - Never appends " (copy)"; duplicating a duplicate cannot produce "2 2".
 */
export function nextDuplicateName(
  sourceName: string,
  existingNames: readonly string[],
): string {
  const parsed = parseTrailingNumber(sourceName);
  const prefix = parsed ? parsed.prefix : sourceName;
  const separator = parsed ? parsed.separator : " ";
  let candidate = parsed ? parsed.number + 1 : 2;

  const sibling = new RegExp(
    `^${escapeRegExp(prefix)}${escapeRegExp(separator)}(\\d+)$`,
  );
  const occupied = new Set<number>();
  for (const name of existingNames) {
    const hit = sibling.exec(name);
    if (hit) occupied.add(Number(hit[1]));
  }

  while (occupied.has(candidate)) candidate += 1;
  return `${prefix}${separator}${candidate}`;
}
