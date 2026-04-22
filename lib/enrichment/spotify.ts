import "server-only";

/**
 * lib/enrichment/spotify.ts
 *
 * Thin Spotify Web API wrapper for the artist-enrichment pipeline.
 * Uses the public client-credentials flow (no user login, public data
 * only) — Matas just wants name → genres + popularity + image to pull
 * an artist record into shape, and that scope of data doesn't need a
 * user-authorised OAuth flow.
 *
 * Token caching: the bearer is held in module scope for ~3500s
 * (Spotify issues 3600s tokens; we expire 100s early to avoid the
 * "401 just as it expires" race). One Spotify call per cold module
 * lifetime in the steady state.
 *
 * If the env creds are missing, every exported function throws
 * SpotifyDisabledError so the API route can map it to a typed 503
 * instead of a generic 500. The route handler logs the disabled
 * state once per process (see logSpotifyDisabledOnce below) so we
 * don't spam Vercel logs with one warn per request.
 */

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API = "https://api.spotify.com/v1";

const TOKEN_TTL_MS = 3_500_000;

export class SpotifyDisabledError extends Error {
  constructor(reason: string) {
    super(`Spotify enrichment disabled: ${reason}`);
    this.name = "SpotifyDisabledError";
  }
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
let disabledLogged = false;

function logSpotifyDisabledOnce(reason: string): void {
  if (disabledLogged) return;
  disabledLogged = true;
  console.warn(`[enrichment/spotify] disabled: ${reason}`);
}

function readCreds(): { id: string; secret: string } | null {
  const id = process.env.SPOTIFY_CLIENT_ID?.trim();
  const secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!id || !secret) return null;
  return { id, secret };
}

export function isSpotifyConfigured(): boolean {
  return readCreds() != null;
}

export async function getAppToken(): Promise<string> {
  const creds = readCreds();
  if (!creds) {
    logSpotifyDisabledOnce("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET missing");
    throw new SpotifyDisabledError("missing client credentials");
  }
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.token;
  }

  const basic = Buffer.from(`${creds.id}:${creds.secret}`).toString("base64");
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Spotify token request failed: HTTP ${res.status} ${text.slice(0, 200)}`,
    );
  }
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) {
    throw new Error("Spotify token response missing access_token");
  }
  cachedToken = {
    token: j.access_token,
    expiresAt: now + Math.min((j.expires_in ?? 3600) * 1000, TOKEN_TTL_MS),
  };
  return cachedToken.token;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
  image_url: string | null;
  external_url: string | null;
  followers: number | null;
}

interface RawSpotifyArtist {
  id: string;
  name: string;
  genres?: string[];
  popularity?: number;
  images?: { url: string; width?: number; height?: number }[];
  external_urls?: { spotify?: string };
  followers?: { total?: number };
}

function pickImage(images: RawSpotifyArtist["images"]): string | null {
  if (!images || images.length === 0) return null;
  // Spotify returns largest first, but we explicitly grab the largest
  // ≤ 640px to keep the populate UI snappy without a bandwidth hit.
  const sorted = [...images].sort(
    (a, b) => (b.width ?? 0) - (a.width ?? 0),
  );
  const preferred = sorted.find((i) => (i.width ?? 0) <= 640) ?? sorted[0];
  return preferred?.url ?? null;
}

function normalise(raw: RawSpotifyArtist): SpotifyArtist {
  return {
    id: raw.id,
    name: raw.name,
    genres: raw.genres ?? [],
    popularity: typeof raw.popularity === "number" ? raw.popularity : 0,
    image_url: pickImage(raw.images),
    external_url: raw.external_urls?.spotify ?? null,
    followers: raw.followers?.total ?? null,
  };
}

async function spotifyGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const token = await getAppToken();
  const url = new URL(`${SPOTIFY_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 401) {
    // Token rotated under us (rare on client-credentials but not
    // impossible). Drop the cache and let the next call re-fetch.
    cachedToken = null;
    throw new Error("Spotify 401 — token rejected (cache cleared)");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Spotify ${path} failed: HTTP ${res.status} ${text.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

export async function searchArtists(
  q: string,
  options: { limit?: number } = {},
): Promise<SpotifyArtist[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
  const j = await spotifyGet<{ artists?: { items?: RawSpotifyArtist[] } }>(
    "/search",
    { q: trimmed, type: "artist", limit: String(limit) },
  );
  return (j.artists?.items ?? []).map(normalise);
}

export async function getArtist(id: string): Promise<SpotifyArtist | null> {
  if (!id.trim()) return null;
  try {
    const raw = await spotifyGet<RawSpotifyArtist>(`/artists/${encodeURIComponent(id)}`, {});
    return normalise(raw);
  } catch (err) {
    // 404 surfaces as a thrown error from spotifyGet; treat as null
    // for the "this id no longer resolves" path so the caller can
    // fall back to a name search.
    if (err instanceof Error && /HTTP 404/.test(err.message)) return null;
    throw err;
  }
}
