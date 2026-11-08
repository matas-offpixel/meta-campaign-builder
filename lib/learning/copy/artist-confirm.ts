/**
 * Is this name an artist? Spotify says. An exact-name artist hit with
 * at least one follower is a yes (spotify-match.ts decides what exact
 * means; several exact hits → the most followed). No credentials → every
 * answer is "unavailable", and the caller writes nothing that needed one.
 *
 * Client-credentials flow, public data only. lib/enrichment/spotify.ts
 * is server-only, so this file has its own small client that a script
 * can import.
 */

import { spotifyNameMatch } from "../../creative-lab/spotify-match.ts";

export type ArtistHit = {
  id: string;
  name: string;
  followers: number | null;
  popularity: number | null;
  genres: string[];
  imageUrl: string | null;
};

export type Confirmation =
  | { kind: "yes"; hit: ArtistHit }
  | { kind: "no"; reason: "no exact name" | "no followers" }
  | { kind: "unavailable"; reason: string };

export type ArtistConfirmer = (name: string) => Promise<Confirmation>;

export const MIN_FOLLOWERS = 1;

export function confirmFromHits(name: string, hits: readonly ArtistHit[]): Confirmation {
  const match = spotifyNameMatch(name, hits);
  if (match.kind === "none") return { kind: "no", reason: "no exact name" };
  const exact = match.kind === "one" ? [match.match] : match.matches;
  const followed = exact.filter((hit) => (hit.followers ?? 0) >= MIN_FOLLOWERS).sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0));
  if (!followed.length) return { kind: "no", reason: "no followers" };
  return { kind: "yes", hit: followed[0]! };
}

type Fetch = typeof fetch;

export function spotifyCredentials(env: Record<string, string | undefined>): { id: string; secret: string } | null {
  const id = env.SPOTIFY_CLIENT_ID?.trim();
  const secret = env.SPOTIFY_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

function asHit(row: Record<string, unknown>): ArtistHit | null {
  const id = String(row.id ?? "").trim();
  const name = String(row.name ?? "").trim();
  if (!id || !name) return null;
  const followers = row.followers && typeof row.followers === "object" ? (row.followers as { total?: unknown }).total : null;
  const images = Array.isArray(row.images) ? (row.images as { url?: string }[]) : [];
  return {
    id,
    name,
    followers: typeof followers === "number" ? followers : null,
    popularity: typeof row.popularity === "number" ? row.popularity : null,
    genres: Array.isArray(row.genres) ? row.genres.map(String) : [],
    imageUrl: images[0]?.url ?? null,
  };
}

/**
 * A confirmer over the Spotify Web API, or null when the credentials
 * are not set. One token per confirmer; one search per name, cached
 * for the confirmer's lifetime so a name shared by two events costs
 * one call.
 */
export function spotifyConfirmer(env: Record<string, string | undefined>, fetchImpl: Fetch = fetch): ArtistConfirmer | null {
  const creds = spotifyCredentials(env);
  if (!creds) return null;
  let token: Promise<string> | null = null;
  const cache = new Map<string, Promise<Confirmation>>();
  const getToken = () =>
    (token ??= (async () => {
      const basic = Buffer.from(`${creds.id}:${creds.secret}`).toString("base64");
      const res = await fetchImpl("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials" }),
      });
      if (!res.ok) throw new Error(`Spotify token HTTP ${res.status}`);
      const body = (await res.json()) as { access_token?: string };
      if (!body.access_token) throw new Error("Spotify token missing");
      return body.access_token;
    })());
  return (name: string) => {
    const key = name.trim().toLowerCase();
    const have = cache.get(key);
    if (have) return have;
    const pending = (async (): Promise<Confirmation> => {
      try {
        const access = await getToken();
        const url = new URL("https://api.spotify.com/v1/search");
        url.searchParams.set("type", "artist");
        url.searchParams.set("q", name.trim());
        url.searchParams.set("limit", "10");
        const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${access}` } });
        if (res.status === 429) return { kind: "unavailable", reason: "rate limited" };
        if (!res.ok) return { kind: "unavailable", reason: `HTTP ${res.status}` };
        const body = (await res.json()) as { artists?: { items?: Record<string, unknown>[] } };
        const hits = (body.artists?.items ?? []).map(asHit).filter((hit): hit is ArtistHit => hit != null);
        return confirmFromHits(name, hits);
      } catch (err) {
        return { kind: "unavailable", reason: err instanceof Error ? err.message : String(err) };
      }
    })();
    cache.set(key, pending);
    return pending;
  };
}
