import "server-only";

/**
 * lib/enrichment/musicbrainz.ts
 *
 * MusicBrainz lookup for the artist-enrichment pipeline. No API key
 * is required but a descriptive User-Agent is mandatory per MB's
 * terms of service — `User-Agent: offpixel-dashboard/1.0
 * (matt.liebus@gmail.com)` per the task brief.
 *
 * Rate limit: MB enforces 1 request/second on its public endpoints.
 * We obey it with a tiny in-memory token bucket so a parallel fan-out
 * across 3 Spotify candidates can't accidentally hammer them.
 *
 * The relations parser is deliberately tolerant: MB's `relations[]`
 * payload mixes `social network`, `streaming music`, `purchase for
 * download`, etc. with subtype hints in the URL. We classify by URL
 * host first, fall back to `type`, and skip anything we don't
 * recognise rather than crashing.
 */

const MB_API = "https://musicbrainz.org/ws/2";
const USER_AGENT = "offpixel-dashboard/1.0 (matt.liebus@gmail.com)";

const RATE_LIMIT_INTERVAL_MS = 1000;

let nextAllowedAt = 0;

function reserveSlot(): Promise<void> {
  const now = Date.now();
  const waitMs = Math.max(0, nextAllowedAt - now);
  nextAllowedAt = Math.max(now, nextAllowedAt) + RATE_LIMIT_INTERVAL_MS;
  if (waitMs === 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, waitMs));
}

async function mbGet<T>(path: string, params: Record<string, string>): Promise<T> {
  await reserveSlot();
  const url = new URL(`${MB_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!url.searchParams.has("fmt")) url.searchParams.set("fmt", "json");
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `MusicBrainz ${path} failed: HTTP ${res.status} ${text.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

export interface MusicBrainzCandidate {
  id: string;
  name: string;
  /**
   * MusicBrainz' own confidence score (0-100) for `query=` searches.
   * Returned as `score` on each artist entity. We surface it so the
   * merger can prefer high-score MB hits over cosmetic name matches.
   */
  score: number;
  country: string | null;
  disambiguation: string | null;
}

interface RawMbArtist {
  id: string;
  name: string;
  score?: number;
  country?: string | null;
  disambiguation?: string | null;
}

export async function searchArtists(
  q: string,
  options: { limit?: number } = {},
): Promise<MusicBrainzCandidate[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 25);
  const j = await mbGet<{ artists?: RawMbArtist[] }>("/artist/", {
    query: trimmed,
    limit: String(limit),
  });
  return (j.artists ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    score: typeof a.score === "number" ? a.score : 0,
    country: a.country ?? null,
    disambiguation: a.disambiguation ?? null,
  }));
}

export interface MusicBrainzUrls {
  instagram_handle: string | null;
  facebook_page_url: string | null;
  tiktok_handle: string | null;
  soundcloud_url: string | null;
  bandcamp_url: string | null;
  beatport_url: string | null;
  website: string | null;
  spotify_id: string | null;
  youtube_url: string | null;
}

interface RawMbRelation {
  type?: string;
  url?: { resource?: string };
}

interface RawMbArtistDetail extends RawMbArtist {
  relations?: RawMbRelation[];
}

const EMPTY_URLS: MusicBrainzUrls = {
  instagram_handle: null,
  facebook_page_url: null,
  tiktok_handle: null,
  soundcloud_url: null,
  bandcamp_url: null,
  beatport_url: null,
  website: null,
  spotify_id: null,
  youtube_url: null,
};

function extractInstagramHandle(url: string): string | null {
  const m = url.match(/instagram\.com\/([^/?#]+)/i);
  if (!m) return null;
  const handle = m[1].replace(/^@/, "").trim();
  return handle ? `@${handle}` : null;
}

function extractTiktokHandle(url: string): string | null {
  const m = url.match(/tiktok\.com\/(?:@)?([^/?#]+)/i);
  if (!m) return null;
  const handle = m[1].replace(/^@/, "").trim();
  return handle ? `@${handle}` : null;
}

function extractSpotifyArtistId(url: string): string | null {
  const m = url.match(/open\.spotify\.com\/artist\/([A-Za-z0-9]+)/i);
  return m ? m[1] : null;
}

function classifyUrl(url: string, urls: MusicBrainzUrls): MusicBrainzUrls {
  const lower = url.toLowerCase();
  if (lower.includes("instagram.com")) {
    return { ...urls, instagram_handle: urls.instagram_handle ?? extractInstagramHandle(url) };
  }
  if (lower.includes("facebook.com")) {
    return { ...urls, facebook_page_url: urls.facebook_page_url ?? url };
  }
  if (lower.includes("tiktok.com")) {
    return { ...urls, tiktok_handle: urls.tiktok_handle ?? extractTiktokHandle(url) };
  }
  if (lower.includes("soundcloud.com")) {
    return { ...urls, soundcloud_url: urls.soundcloud_url ?? url };
  }
  if (lower.includes("bandcamp.com")) {
    return { ...urls, bandcamp_url: urls.bandcamp_url ?? url };
  }
  if (lower.includes("beatport.com")) {
    return { ...urls, beatport_url: urls.beatport_url ?? url };
  }
  if (lower.includes("open.spotify.com/artist")) {
    const id = extractSpotifyArtistId(url);
    return { ...urls, spotify_id: urls.spotify_id ?? id };
  }
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) {
    return { ...urls, youtube_url: urls.youtube_url ?? url };
  }
  return urls;
}

export async function getArtistWithUrls(
  mbid: string,
): Promise<{ artist: MusicBrainzCandidate; urls: MusicBrainzUrls } | null> {
  if (!mbid.trim()) return null;
  let raw: RawMbArtistDetail;
  try {
    raw = await mbGet<RawMbArtistDetail>(`/artist/${encodeURIComponent(mbid)}`, {
      inc: "url-rels",
    });
  } catch (err) {
    if (err instanceof Error && /HTTP 404/.test(err.message)) return null;
    throw err;
  }

  const relations = raw.relations ?? [];
  let urls: MusicBrainzUrls = { ...EMPTY_URLS };
  let officialHomepage: string | null = null;
  for (const rel of relations) {
    const resource = rel.url?.resource;
    if (!resource) continue;
    if (rel.type === "official homepage" && !officialHomepage) {
      officialHomepage = resource;
    }
    urls = classifyUrl(resource, urls);
  }
  if (!urls.website && officialHomepage) {
    urls = { ...urls, website: officialHomepage };
  }

  return {
    artist: {
      id: raw.id,
      name: raw.name,
      score: typeof raw.score === "number" ? raw.score : 100,
      country: raw.country ?? null,
      disambiguation: raw.disambiguation ?? null,
    },
    urls,
  };
}
