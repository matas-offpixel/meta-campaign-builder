/**
 * lib/d2c/orchestration/tags.ts
 *
 * Tag taxonomy for D2C audiences: `{brand}_{event_code}`, lower-kebab within
 * each segment (e.g. "jackies_j26-mallorca-pdm"). The tag is the Mailchimp
 * static-segment name and the Bird audience key that ties a subscriber to an
 * event campaign.
 */

function slugSegment(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Build the canonical `{brand}_{event_code}` tag. */
export function buildEventTag(brand: string, eventCode: string): string {
  const b = slugSegment(brand);
  const e = slugSegment(eventCode);
  if (!b || !e) throw new Error(`buildEventTag needs non-empty brand+eventCode (got "${brand}"/"${eventCode}")`);
  return `${b}_${e}`;
}

/** Parse a tag back into {brand, eventCode}. Returns null if malformed. */
export function parseEventTag(tag: string): { brand: string; eventCode: string } | null {
  const i = tag.indexOf("_");
  if (i <= 0 || i === tag.length - 1) return null;
  return { brand: tag.slice(0, i), eventCode: tag.slice(i + 1) };
}
