/**
 * Slug for organiser URLs — venue city lowercased with spaces → dashes.
 */
export function slugifyVenueCity(venueCity: string): string {
  return venueCity
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const ORGANISER_BASE_BY_CLIENT_SLUG: Record<string, string> = {
  "4thefans": "https://4thefans.tv/organiser",
};

/**
 * Build a client-specific organiser landing URL from venue city.
 * Returns null when the client has no known pattern or city is missing.
 */
export function resolveOrganiserDestinationUrl(
  clientSlug: string | null | undefined,
  venueCity: string | null | undefined,
): string | null {
  if (!venueCity?.trim()) return null;

  const normalizedSlug = (clientSlug ?? "").trim().toLowerCase();
  const base = ORGANISER_BASE_BY_CLIENT_SLUG[normalizedSlug];
  if (!base) return null;

  const venueSlug = slugifyVenueCity(venueCity);
  if (!venueSlug) return null;

  return `${base}/${venueSlug}/`;
}
