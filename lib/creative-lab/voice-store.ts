/**
 * Read and write the voice corpus. Captions only. No media.
 * A missing table (migration 215 not applied) is a no-op, not a failure.
 */

import type { ServiceRoleDb } from "./load.ts";
import {
  VOICE_FLOOR,
  VOICE_SAMPLE_CAP,
  extractTraits,
  traitsReady,
  type VoiceSample,
  type VoiceTraits,
} from "./voice-traits.ts";

type Row = Record<string, unknown>;

export type VoicePost = {
  id: string;
  permalink: string | null;
  caption: string | null;
  postedAt: string | null;
  likes: number | null;
  comments: number | null;
};

export type StoredVoice = {
  samples: VoiceSample[];
  traits: VoiceTraits | null;
  error: string | null;
  handle: string | null;
  hashtagsEnabled: boolean;
  fetchedAt: string | null;
};

function text(row: Row | null, key: string): string {
  return String(row?.[key] ?? "").trim();
}

function missing(message: string): boolean {
  return /does not exist|schema cache|voice_hashtags_enabled|column/i.test(message);
}

export function postsForVoice(posts: readonly VoicePost[], now: Date): VoicePost[] {
  return [...posts]
    .filter((post) => (post.caption ?? "").trim().length > 0 && post.id.trim().length > 0)
    .sort((a, b) => String(b.postedAt ?? "").localeCompare(String(a.postedAt ?? "")))
    .slice(0, VOICE_SAMPLE_CAP)
    .map((post) => ({ ...post, caption: post.caption?.trim() ?? "" }));
}

export async function saveVoiceSamples(
  db: ServiceRoleDb,
  args: {
    userId: string;
    pageKind: "promoter" | "artist";
    clientId: string;
    artistId: string | null;
    posts: readonly VoicePost[];
    now: Date;
    venueNames?: readonly string[];
  },
): Promise<{ sampleN: number; traits: VoiceTraits | null }> {
  const nowIso = args.now.toISOString();
  const posts = postsForVoice(args.posts, args.now);
  if (posts.length > 0) {
    const saved = await db.from("voice_samples").upsert(
      posts.map((post) => ({
        user_id: args.userId,
        page_kind: args.pageKind,
        client_id: args.clientId,
        artist_id: args.artistId,
        ig_media_id: post.id,
        permalink: post.permalink,
        posted_at: post.postedAt,
        likes: post.likes,
        comments: post.comments,
        caption: post.caption,
        fetched_at: nowIso,
      })),
      { onConflict: "client_id,artist_id,ig_media_id" },
    );
    if (saved.error) {
      if (missing(saved.error.message)) return { sampleN: 0, traits: null };
      throw new Error(saved.error.message);
    }
  }

  const loaded = await loadStoredVoice(db, args.pageKind, args.clientId, args.artistId);
  const samples = loaded.samples;
  if (!traitsReady(samples.length)) return { sampleN: samples.length, traits: null };
  const traits = extractTraits(samples, args.venueNames ?? []);
  return { sampleN: traits.sampleN, traits };
}

export async function loadStoredVoice(
  db: ServiceRoleDb,
  pageKind: "promoter" | "artist",
  clientId: string,
  artistId: string | null,
): Promise<StoredVoice> {
  const empty: StoredVoice = { samples: [], traits: null, error: null, handle: null, hashtagsEnabled: false, fetchedAt: null };
  let query = db
    .from("voice_samples")
    .select("*")
    .eq("page_kind", pageKind)
    .eq("client_id", clientId)
    .order("posted_at", { ascending: false })
    .limit(VOICE_SAMPLE_CAP);
  // PostgREST turns `.eq(column, null)` into `column = 'null'`. On a uuid
  // column that is `invalid input syntax for type uuid: "null"`, and the
  // promoter page (artist_id is null) never loads.
  query = artistId ? query.eq("artist_id", artistId) : query.is("artist_id", null);
  const samplesRes = await query;
  if (samplesRes.error) {
    if (missing(samplesRes.error.message)) return empty;
    throw new Error(samplesRes.error.message);
  }
  const rows = (samplesRes.data ?? []) as Row[];
  const samples: VoiceSample[] = rows
    .map((row) => ({
      caption: text(row, "caption"),
      postedAt: text(row, "posted_at") || null,
      likes: row.likes == null ? null : Number(row.likes),
      comments: row.comments == null ? null : Number(row.comments),
      permalink: text(row, "permalink") || null,
    }))
    .filter((row) => row.caption.length > 0);
  const fetchedAt = rows.map((row) => text(row, "fetched_at")).filter(Boolean).sort().at(-1) ?? null;
  return { samples, traits: null, error: null, handle: null, hashtagsEnabled: false, fetchedAt };
}

export async function voiceHashtagsEnabled(db: ServiceRoleDb, clientId: string): Promise<boolean> {
  const res = await db.from("clients").select("voice_hashtags_enabled").eq("id", clientId).maybeSingle();
  if (res.error) return false;
  return (res.data as { voice_hashtags_enabled?: boolean } | null)?.voice_hashtags_enabled === true;
}

export async function setVoiceHashtags(db: ServiceRoleDb, clientId: string, enabled: boolean): Promise<void> {
  const res = await db.from("clients").update({ voice_hashtags_enabled: enabled }).eq("id", clientId);
  if (res.error) throw new Error(res.error.message);
}

export async function venueNamesForClient(db: ServiceRoleDb, clientId: string): Promise<string[]> {
  const res = await db.from("events").select("venue_name").eq("client_id", clientId);
  if (res.error) return [];
  const names = new Set<string>();
  for (const row of (res.data ?? []) as Row[]) {
    const name = text(row, "venue_name");
    if (name) names.add(name);
  }
  return [...names];
}

export const VOICE_REFRESH_DAYS = 30;

export function voicePageRef(
  style: string,
  clientId: string,
  artistId: string | null,
): { pageKind: "promoter" | "artist"; clientId: string; artistId: string | null } | null {
  if (style === "artist_first_person") return artistId ? { pageKind: "artist", clientId, artistId } : null;
  return { pageKind: "promoter", clientId, artistId: null };
}

export type CardVoicePage = {
  handle: string | null;
  sampleN: number;
  error: string | null;
  fetchedAt: string | null;
  traits: VoiceTraits | null;
  exemplars: VoiceSample[];
};

export type CardVoice = {
  clientId: string;
  hashtagsEnabled: boolean;
  promoter: CardVoicePage;
  artists: (CardVoicePage & { id: string })[];
};

export async function loadCardVoice(
  db: ServiceRoleDb,
  clientId: string,
  artists: readonly { id: string; handle: string | null; error: string | null }[],
  promoterHandle: string | null,
): Promise<CardVoice> {
  const hashtagsEnabled = await voiceHashtagsEnabled(db, clientId);
  const venues = await venueNamesForClient(db, clientId);
  const promoterError = await promoterReadError(db, clientId);
  const promoter = await loadStoredVoice(db, "promoter", clientId, null);
  const taken = (samples: VoiceSample[]) => (traitsReady(samples.length) ? extractTraits(samples, venues) : null);
  const pages = await Promise.all(artists.map(async (artist) => {
    const stored = await loadStoredVoice(db, "artist", clientId, artist.id);
    return {
      id: artist.id,
      handle: artist.handle,
      sampleN: stored.samples.length,
      error: stored.samples.length === 0 ? artist.error : null,
      fetchedAt: stored.fetchedAt,
      traits: taken(stored.samples),
      exemplars: stored.samples,
    };
  }));
  return {
    clientId,
    hashtagsEnabled,
    promoter: {
      handle: promoterHandle,
      sampleN: promoter.samples.length,
      error: promoter.samples.length === 0 ? promoterError : null,
      fetchedAt: promoter.fetchedAt,
      traits: taken(promoter.samples),
      exemplars: promoter.samples,
    },
    artists: pages,
  };
}

async function promoterReadError(db: ServiceRoleDb, clientId: string): Promise<string | null> {
  const res = await db.from("clients").select("ig_last_error").eq("id", clientId).maybeSingle();
  if (res.error) return null;
  const value = text(res.data as Row | null, "ig_last_error");
  return value || null;
}

export { VOICE_FLOOR };
