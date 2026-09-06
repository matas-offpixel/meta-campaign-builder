/**
 * events.venue_key — audit two §6 item 1.
 * Lower, trim, collapse spaces, strip a leading "the ", strip a trailing
 * city suffix from the 4theFans spellings.
 */

export const VENUE_CITY_SUFFIXES = [
  "birmingham",
  "glasgow",
  "leeds",
  "islington",
] as const;

export function venueKey(name: string | null | undefined): string | null {
  if (!name) return null;
  let value = name.toLowerCase().trim().replace(/\s+/g, " ");
  value = value.replace(/^the\s+/, "");
  for (const city of VENUE_CITY_SUFFIXES) {
    const suffix = new RegExp(`\\s+${city}$`);
    if (suffix.test(value)) {
      value = value.replace(suffix, "").trim();
      break;
    }
  }
  return value || null;
}
