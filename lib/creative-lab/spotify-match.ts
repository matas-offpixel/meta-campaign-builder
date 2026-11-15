/**
 * Match a library artist to Spotify search hits by name.
 * One exact name is safe to write. Several exact names need a person
 * to pick. Anything else is left alone.
 */

export type NamedHit = { name: string };

export function normaliseArtistName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export type SpotifyNameMatch<T extends NamedHit> =
  | { kind: "one"; match: T }
  | { kind: "several"; matches: T[] }
  | { kind: "none" };

export function spotifyNameMatch<T extends NamedHit>(name: string, hits: readonly T[]): SpotifyNameMatch<T> {
  const wanted = normaliseArtistName(name);
  if (!wanted) return { kind: "none" };
  const exact = hits.filter((hit) => normaliseArtistName(hit.name) === wanted);
  if (exact.length === 1) return { kind: "one", match: exact[0] as T };
  if (exact.length > 1) return { kind: "several", matches: exact };
  return { kind: "none" };
}
