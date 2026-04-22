import "server-only";

/**
 * lib/enrichment/google-places.ts
 *
 * Google Places API (New) wrapper for the venue-enrichment pipeline.
 * Uses the v1 endpoints (`places.googleapis.com`) with a FieldMask
 * header so we only pay for the fields the populate UI actually
 * shows — keeps us deep in the free tier.
 *
 * The default location bias is the UK rectangle (49.9-60.8 N,
 * -8.2 to 1.8 E) because Matas works UK events. Callers can pass
 * an explicit `locationBias` to override (useful when the user has
 * already typed a city name into the venue form).
 *
 * The disabled-state contract mirrors lib/enrichment/spotify.ts:
 * missing API key throws PlacesDisabledError so the route handler
 * can return a typed 503. We log the disabled state once per
 * process to keep Vercel logs quiet.
 */

const PLACES_BASE = "https://places.googleapis.com/v1";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.websiteUri",
  "places.internationalPhoneNumber",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.photos",
].join(",");

const SINGLE_PLACE_FIELD_MASK = FIELD_MASK.replaceAll("places.", "");

const UK_LOCATION_BIAS: PlacesLocationBias = {
  rectangle: {
    low: { latitude: 49.9, longitude: -8.2 },
    high: { latitude: 60.8, longitude: 1.8 },
  },
};

export class PlacesDisabledError extends Error {
  constructor(reason: string) {
    super(`Google Places enrichment disabled: ${reason}`);
    this.name = "PlacesDisabledError";
  }
}

let disabledLogged = false;

function logPlacesDisabledOnce(reason: string): void {
  if (disabledLogged) return;
  disabledLogged = true;
  console.warn(`[enrichment/google-places] disabled: ${reason}`);
}

function readKey(): string | null {
  const k = process.env.GOOGLE_PLACES_API_KEY?.trim();
  return k && k.length > 0 ? k : null;
}

export function isGooglePlacesConfigured(): boolean {
  return readKey() != null;
}

export interface PlacesLocationBias {
  rectangle?: {
    low: { latitude: number; longitude: number };
    high: { latitude: number; longitude: number };
  };
  circle?: {
    center: { latitude: number; longitude: number };
    radius: number;
  };
}

export interface PlaceCandidate {
  id: string;
  name: string;
  address_full: string | null;
  latitude: number | null;
  longitude: number | null;
  website: string | null;
  phone: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  google_maps_url: string | null;
  photo_reference: string | null;
  raw: RawPlace;
}

interface RawPlacePhoto {
  name?: string;
}

interface RawPlace {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  websiteUri?: string;
  internationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  photos?: RawPlacePhoto[];
}

function normalisePlace(raw: RawPlace): PlaceCandidate {
  return {
    id: raw.id ?? "",
    name: raw.displayName?.text ?? "",
    address_full: raw.formattedAddress ?? null,
    latitude: raw.location?.latitude ?? null,
    longitude: raw.location?.longitude ?? null,
    website: raw.websiteUri ?? null,
    phone: raw.internationalPhoneNumber ?? null,
    rating: typeof raw.rating === "number" ? raw.rating : null,
    user_ratings_total:
      typeof raw.userRatingCount === "number" ? raw.userRatingCount : null,
    google_maps_url: raw.googleMapsUri ?? null,
    photo_reference: raw.photos?.[0]?.name ?? null,
    raw,
  };
}

async function placesPost<T>(
  path: string,
  body: Record<string, unknown>,
  fieldMask: string,
): Promise<T> {
  const key = readKey();
  if (!key) {
    logPlacesDisabledOnce("GOOGLE_PLACES_API_KEY missing");
    throw new PlacesDisabledError("missing API key");
  }
  const res = await fetch(`${PLACES_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Google Places ${path} failed: HTTP ${res.status} ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

async function placesGet<T>(path: string, fieldMask: string): Promise<T> {
  const key = readKey();
  if (!key) {
    logPlacesDisabledOnce("GOOGLE_PLACES_API_KEY missing");
    throw new PlacesDisabledError("missing API key");
  }
  const res = await fetch(`${PLACES_BASE}${path}`, {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": fieldMask,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Google Places ${path} failed: HTTP ${res.status} ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

export async function searchText(args: {
  q: string;
  locationBias?: PlacesLocationBias;
  limit?: number;
}): Promise<PlaceCandidate[]> {
  const q = args.q.trim();
  if (!q) return [];
  const limit = Math.min(Math.max(args.limit ?? 5, 1), 20);
  const body: Record<string, unknown> = {
    textQuery: q,
    maxResultCount: limit,
    locationBias: args.locationBias ?? UK_LOCATION_BIAS,
  };
  const j = await placesPost<{ places?: RawPlace[] }>(
    "/places:searchText",
    body,
    FIELD_MASK,
  );
  return (j.places ?? []).map(normalisePlace);
}

export async function getPlaceDetails(
  placeId: string,
): Promise<PlaceCandidate | null> {
  const id = placeId.trim();
  if (!id) return null;
  try {
    const raw = await placesGet<RawPlace>(
      `/places/${encodeURIComponent(id)}`,
      SINGLE_PLACE_FIELD_MASK,
    );
    return normalisePlace(raw);
  } catch (err) {
    if (err instanceof Error && /HTTP 404/.test(err.message)) return null;
    throw err;
  }
}
