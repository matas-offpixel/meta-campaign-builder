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
    pageRef: string;
    posts: readonly VoicePost[];
    now: Date;
    venueNames?: readonly string[];
    error?: string | null;
  },
): Promise<{ sampleN: number; traits: VoiceTraits | null }> {
  const nowIso = args.now.toISOString();
  const posts = postsForVoice(args.posts, args.now);
  if (posts.length > 0) {
    const saved = await db.from("voice_samples").upsert(
      posts.map((post) => ({
        user_id: args.userId,
        page_kind: args.pageKind,
        page_ref: args.pageRef,
        ig_media_id: post.id,
        permalink: post.permalink,
        posted_at: post.postedAt,
        likes: post.likes,
        comments: post.comments,
        caption: post.caption,
        fetched_at: nowIso,
      })),
      { onConflict: "page_kind,page_ref,ig_media_id" },
    );
    if (saved.error) {
      if (missing(saved.error.message)) return { sampleN: 0, traits: null };
      throw new Error(saved.error.message);
    }
  }

  const loaded = await loadStoredVoice(db, args.pageKind, args.pageRef);
  const samples = loaded.samples;
  const error = args.error?.trim() || null;
  if (error && samples.length === 0) {
    await writeTraits(db, args, 0, { error }, nowIso);
    return { sampleN: 0, traits: null };
  }
  if (!traitsReady(samples.length)) return { sampleN: samples.length, traits: null };
  const traits = extractTraits(samples, args.venueNames ?? []);
  await writeTraits(db, args, traits.sampleN, traits, nowIso);
  return { sampleN: traits.sampleN, traits };
}

async function writeTraits(
  db: ServiceRoleDb,
  args: { userId: string; pageKind: "promoter" | "artist"; pageRef: string },
  sampleN: number,
  traits: VoiceTraits | { error: string },
  nowIso: string,
): Promise<void> {
  const saved = await db.from("voice_traits").upsert(
    {
      user_id: args.userId,
      page_kind: args.pageKind,
      page_ref: args.pageRef,
      sample_n: sampleN,
      traits,
      computed_at: nowIso,
    },
    { onConflict: "page_kind,page_ref" },
  );
  if (saved.error && !missing(saved.error.message)) throw new Error(saved.error.message);
}

export async function loadStoredVoice(db: ServiceRoleDb, pageKind: "promoter" | "artist", pageRef: string): Promise<StoredVoice> {
  const empty: StoredVoice = { samples: [], traits: null, error: null, handle: null, hashtagsEnabled: false, fetchedAt: null };
  const samplesRes = await db
    .from("voice_samples")
    .select("*")
    .eq("page_kind", pageKind)
    .eq("page_ref", pageRef)
    .order("posted_at", { ascending: false })
    .limit(VOICE_SAMPLE_CAP);
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
  const traitsRes = await db.from("voice_traits").select("*").eq("page_kind", pageKind).eq("page_ref", pageRef).maybeSingle();
  if (traitsRes.error) {
    if (missing(traitsRes.error.message)) return { ...empty, samples, fetchedAt };
    throw new Error(traitsRes.error.message);
  }
  const traitsRow = traitsRes.data as Row | null;
  const raw = traitsRow?.traits;
  const error = raw && typeof raw === "object" && "error" in raw && typeof (raw as { error?: unknown }).error === "string"
    ? (raw as { error: string }).error
    : null;
  const traits = raw && typeof raw === "object" && "sampleN" in raw ? raw as VoiceTraits : null;
  return { samples, traits: traitsReady(samples.length) ? traits : null, error, handle: null, hashtagsEnabled: false, fetchedAt };
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

export function voicePageRef(style: string, clientId: string, artistId: string | null): { pageKind: "promoter" | "artist"; pageRef: string } | null {
  if (style === "artist_first_person") return artistId ? { pageKind: "artist", pageRef: artistId } : null;
  return { pageKind: "promoter", pageRef: clientId };
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
  const promoter = await loadStoredVoice(db, "promoter", clientId);
  const pages = await Promise.all(artists.map(async (artist) => {
    const stored = await loadStoredVoice(db, "artist", artist.id);
    return {
      id: artist.id,
      handle: artist.handle,
      sampleN: stored.samples.length,
      error: stored.error || (stored.samples.length === 0 ? artist.error : null),
      fetchedAt: stored.fetchedAt,
      traits: stored.traits,
      exemplars: stored.samples,
    };
  }));
  return {
    clientId,
    hashtagsEnabled,
    promoter: {
      handle: promoterHandle,
      sampleN: promoter.samples.length,
      error: promoter.error,
      fetchedAt: promoter.fetchedAt,
      traits: promoter.traits,
      exemplars: promoter.samples,
    },
    artists: pages,
  };
}

export { VOICE_FLOOR };
