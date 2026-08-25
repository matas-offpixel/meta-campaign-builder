/**
 * Server-derived coarse geo from Vercel IP headers. Same convention as
 * event_signups (PR 6) — never read from a request body.
 */

export interface LandingPageGeo {
  country: string | null;
  region: string | null;
  city: string | null;
}

function decodeHeader(value: string | null): string | null {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded.length > 0 ? decoded.slice(0, 80) : null;
  } catch {
    return value.trim().slice(0, 80) || null;
  }
}

export function geoFromHeaders(headers: {
  get(name: string): string | null;
}): LandingPageGeo {
  const country = headers.get("x-vercel-ip-country");
  return {
    country:
      country && /^[A-Za-z]{2}$/.test(country.trim())
        ? country.trim().toUpperCase()
        : null,
    region: decodeHeader(headers.get("x-vercel-ip-country-region")),
    city: decodeHeader(headers.get("x-vercel-ip-city")),
  };
}
