/**
 * lib/admin/country-names.ts — ISO-3166-1 alpha-2 → English display name.
 *
 * OP909 Sprint 2: fan geo is stored as an ISO-2 code (Vercel geo header).
 * The admin surfaces show "United Kingdom (GB)" style labels — full name for
 * humans, code for disambiguation, NO flag emoji (deep-dive aesthetic call).
 *
 * Uses the platform Intl.DisplayNames (Node ≥ 14 / all evergreen browsers) so
 * there's no hand-maintained map and no new dependency. Pure + deterministic
 * → node:test-able. Unknown / malformed codes fall back gracefully.
 */

let regionNames: Intl.DisplayNames | null = null;
try {
  // fallback:"none" → unrecognised codes return undefined instead of echoing
  // the code back, so we can cleanly detect "no name available".
  regionNames = new Intl.DisplayNames(["en"], {
    type: "region",
    fallback: "none",
  });
} catch {
  regionNames = null;
}

const ISO2_RE = /^[A-Za-z]{2}$/;

/** Full English country name for an ISO-2 code, or null when unknown. */
export function countryName(iso: string | null | undefined): string | null {
  if (!iso || !ISO2_RE.test(iso)) return null;
  const code = iso.toUpperCase();
  if (!regionNames) return null;
  try {
    const name = regionNames.of(code);
    // Intl echoes the input back when it doesn't recognise the region.
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

/**
 * Human label for a fan table / panel: "United Kingdom (GB)". Falls back to
 * the bare code when the name is unknown, and to a dash for null/blank geo.
 */
export function formatCountry(iso: string | null | undefined): string {
  if (!iso || iso.trim().length === 0) return "—";
  const code = iso.toUpperCase();
  const name = countryName(code);
  return name ? `${name} (${code})` : code;
}
