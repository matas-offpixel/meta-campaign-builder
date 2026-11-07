/**
 * List an artist's best recent Instagram clips. Nothing is downloaded
 * and no clip row is written. media_url is never requested or stored.
 * A thumbnail is read in memory for its pixel size, then discarded.
 */

import { igThumbObjectPath } from "./ig-import.ts";
import type { ServiceRoleDb } from "./load.ts";

const WINDOW_DAYS = 365;
const HALF_LIFE_DAYS = 90;
const TOP_N = 8;
const MAX_POSTS = 150;

/** Own-edge and Business Discovery fields. media_url is deliberately absent. thumbnail_url is read and not stored. */
export const IG_MEDIA_FIELDS =
  "id,media_type,media_product_type,permalink,timestamp,like_count,comments_count,thumbnail_url,children{media_type,id,thumbnail_url}";

type Row = Record<string, unknown>;

export class IgDiscoveryError extends Error {
  readonly code: "not_cleared" | "no_instagram" | "no_token";
  constructor(code: "not_cleared" | "no_instagram" | "no_token", message: string) {
    super(message);
    this.name = "IgDiscoveryError";
    this.code = code;
  }
}

export type IgAspect = "9:16" | "4:5" | "1:1" | "landscape" | "unknown";

export type IgPost = {
  id: string;
  mediaType: string;
  mediaProductType: string | null;
  permalink: string | null;
  postedAt: string | null;
  likes: number | null;
  comments: number | null;
  thumbnailUrl: string | null;
  thumbWidth: number | null;
  thumbHeight: number | null;
  children: { id: string; mediaType: string; thumbnailUrl: string | null }[];
};

export type IgRead = {
  profile(igUserId: string): Promise<{ ok: true; username: string | null; followers: number | null } | { ok: false; message: string }>;
  media(igUserId: string, maxPosts: number): Promise<{ ok: true; posts: IgPost[] } | { ok: false; message: string }>;
  discovery(businessId: string, username: string, maxPosts: number): Promise<{ ok: true; followers: number | null; posts: IgPost[] } | { ok: false; message: string }>;
  copyright(mediaId: string): Promise<boolean | null>;
  thumb?(url: string): Promise<{ width: number; height: number; bytes?: Uint8Array } | null>;
};

export type IgCandidate = {
  igMediaId: string;
  /** Other video slides of the same carousel, in order. Empty for a reel. */
  slideIds: string[];
  permalink: string | null;
  mediaType: string;
  mediaProductType: string | null;
  postedAt: string;
  likes: number | null;
  comments: number | null;
  followersAtFetch: number | null;
  score: number;
  aspect: IgAspect;
  thumbWidth: number | null;
  thumbHeight: number | null;
  hasFile: boolean;
  fileSource: "own_edge" | "none";
  audioMatch: boolean | null;
  status: "candidate";
};

export type IgFindResult = {
  candidates: IgCandidate[];
  error: string | null;
  source: "own_edge" | "none" | null;
};

const HELD = new Set(["requested", "imported", "skipped"]);

function text(row: Row | null | undefined, key: string): string {
  return String(row?.[key] ?? "").trim();
}

export function plainIgMessage(message: string): string {
  return message
    .replace(/https?:\/\/\S+/g, "")
    .replace(/access_token=[^&\s]+/gi, "")
    .replace(/EAA[A-Za-z0-9]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500) || "Instagram could not be read.";
}

export function igScore(args: { likes: number | null; comments: number | null; followers: number | null; ageDays: number }): number {
  const followers = args.followers ?? 0;
  if (followers <= 0) return 0;
  const age = Math.max(0, args.ageDays);
  return (((args.likes ?? 0) + 3 * (args.comments ?? 0)) / followers) * 2 ** -(age / HALF_LIFE_DAYS);
}

const ASPECT_MULTIPLIER: Record<IgAspect, number> = {
  "9:16": 1,
  "4:5": 0.7,
  "1:1": 0.55,
  landscape: 0.3,
  unknown: 0.6,
};

/** Pixel size when we have one. Otherwise a reel is 9:16 and anything else is unknown. */
export function classifyAspect(width: number | null, height: number | null, mediaProductType: string | null): { aspect: IgAspect; multiplier: number; width: number | null; height: number | null } {
  if (width == null || height == null || width <= 0 || height <= 0) {
    const aspect: IgAspect = mediaProductType === "REELS" ? "9:16" : "unknown";
    return { aspect, multiplier: ASPECT_MULTIPLIER[aspect], width: null, height: null };
  }
  const ratio = width / height;
  let aspect: IgAspect = "unknown";
  if (ratio >= 0.5 && ratio <= 0.6) aspect = "9:16";
  else if (ratio >= 0.76 && ratio <= 0.84) aspect = "4:5";
  else if (ratio >= 0.95 && ratio <= 1.05) aspect = "1:1";
  else if (width > height) aspect = "landscape";
  return { aspect, multiplier: ASPECT_MULTIPLIER[aspect], width, height };
}

/** JPEG or PNG pixel size from the file header. Anything else is unread. */
export function imageHeaderSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = readU32(bytes, 16);
    const height = readU32(bytes, 20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes);
  return null;
}

function ageDays(postedAt: string, now: Date): number {
  return (now.getTime() - Date.parse(postedAt)) / 86_400_000;
}

/** One slot per post. A carousel keeps its first video slide and lists the rest as alternates. */
function carouselUnit(post: IgPost): { id: string; slideIds: string[] } | null {
  if (post.mediaType === "VIDEO") return post.id ? { id: post.id, slideIds: [] } : null;
  if (post.mediaType !== "CAROUSEL_ALBUM") return null;
  const videos = post.children.filter((child) => child.mediaType === "VIDEO" && child.id).map((child) => child.id);
  const [first, ...rest] = videos;
  return first ? { id: first, slideIds: rest } : null;
}

export function rankIgPosts(
  posts: readonly IgPost[],
  args: { now: Date; followers: number | null; exclude: ReadonlySet<string>; limit?: number },
): Omit<IgCandidate, "followersAtFetch" | "hasFile" | "fileSource" | "audioMatch" | "status">[] {
  const ranked: Omit<IgCandidate, "followersAtFetch" | "hasFile" | "fileSource" | "audioMatch" | "status">[] = [];
  const seen = new Set<string>();
  for (const post of posts) {
    if (!post.postedAt || Number.isNaN(Date.parse(post.postedAt))) continue;
    const age = ageDays(post.postedAt, args.now);
    if (age > WINDOW_DAYS) continue;
    const unit = carouselUnit(post);
    if (!unit) continue;
    const ids = [unit.id, ...unit.slideIds];
    if (ids.some((id) => args.exclude.has(id) || seen.has(id))) continue;
    for (const id of ids) seen.add(id);
    const shape = classifyAspect(post.thumbWidth, post.thumbHeight, post.mediaProductType);
    ranked.push({
      igMediaId: unit.id,
      slideIds: unit.slideIds,
      permalink: post.permalink,
      mediaType: "VIDEO",
      mediaProductType: post.mediaProductType,
      postedAt: new Date(Date.parse(post.postedAt)).toISOString(),
      likes: post.likes,
      comments: post.comments,
      score: igScore({ likes: post.likes, comments: post.comments, followers: args.followers, ageDays: age }) * shape.multiplier,
      aspect: shape.aspect,
      thumbWidth: shape.width,
      thumbHeight: shape.height,
    });
  }
  ranked.sort((a, b) => b.score - a.score || a.igMediaId.localeCompare(b.igMediaId));
  return ranked.slice(0, args.limit ?? TOP_N);
}

function graphVersion(): string {
  const version = process.env.META_API_VERSION?.trim() || "v21.0";
  return version.startsWith("v") ? version : `v${version}`;
}

async function graphGet(token: string, path: string, params: Record<string, string>): Promise<{ ok: true; json: Row } | { ok: false; message: string }> {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("access_token", token);
  try {
    const res = await fetch(url, { cache: "no-store" });
    const json = (await res.json()) as Row & { error?: { message?: string } };
    if (!res.ok || json.error) return { ok: false, message: plainIgMessage(json.error?.message || "Instagram could not be read.") };
    return { ok: true, json };
  } catch {
    return { ok: false, message: "Instagram could not be read." };
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 8 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (i + 4 > bytes.length) return null;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) {
      if (i + 9 >= bytes.length) return null;
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + length;
  }
  return null;
}

function slideThumb(post: IgPost): string | null {
  if (post.mediaType === "CAROUSEL_ALBUM") {
    const slide = post.children.find((child) => child.mediaType === "VIDEO" && child.id);
    return slide?.thumbnailUrl || null;
  }
  return post.thumbnailUrl;
}

async function measureThumbs(
  posts: IgPost[],
  exclude: ReadonlySet<string>,
  thumb: (url: string) => Promise<{ width: number; height: number; bytes?: Uint8Array } | null>,
): Promise<Map<string, Uint8Array>> {
  const stored = new Map<string, Uint8Array>();
  const jobs = posts.filter((post) => {
    const unit = carouselUnit(post);
    if (!unit || !slideThumb(post)) return false;
    return ![unit.id, ...unit.slideIds].some((id) => exclude.has(id));
  });
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const post = jobs[cursor];
      cursor += 1;
      const url = post ? slideThumb(post) : null;
      if (!post || !url) continue;
      const size = await thumb(url);
      if (!size) continue;
      post.thumbWidth = size.width;
      post.thumbHeight = size.height;
      if (size.bytes) stored.set(post.id, size.bytes);
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, jobs.length) }, () => worker()));
  return stored;
}

export async function readThumbSize(url: string): Promise<{ width: number; height: number; bytes: Uint8Array } | null> {
  if (!url.startsWith("https://")) return null;
  try {
    const res = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < 1_500_000) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
    }
    await reader.cancel().catch(() => undefined);
    const bytes = concatBytes(chunks, total);
    const size = imageHeaderSize(bytes);
    return size ? { ...size, bytes } : null;
  } catch {
    return null;
  }
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function parseIgPost(raw: Row): IgPost {
  const children = ((raw.children as { data?: Row[] } | undefined)?.data ?? []).map((child) => ({
    id: text(child, "id"),
    mediaType: text(child, "media_type"),
    thumbnailUrl: text(child, "thumbnail_url") || null,
  }));
  return {
    id: text(raw, "id"),
    mediaType: text(raw, "media_type"),
    mediaProductType: text(raw, "media_product_type") || null,
    permalink: text(raw, "permalink") || null,
    postedAt: text(raw, "timestamp") || null,
    likes: numberOrNull(raw.like_count),
    comments: numberOrNull(raw.comments_count),
    thumbnailUrl: text(raw, "thumbnail_url") || null,
    thumbWidth: null,
    thumbHeight: null,
    children,
  };
}

function usernameOk(username: string): boolean {
  return /^[A-Za-z0-9._]{1,30}$/.test(username);
}

function afterCursor(paging: unknown): string {
  if (!paging || typeof paging !== "object") return "";
  const after = (paging as { cursors?: { after?: unknown } }).cursors?.after;
  return typeof after === "string" ? after.trim() : "";
}

async function readProfile(token: string, igUserId: string): Promise<Awaited<ReturnType<IgRead["profile"]>>> {
  const res = await graphGet(token, igUserId, { fields: "followers_count,username" });
  if (!res.ok) return res;
  return { ok: true, username: text(res.json, "username") || null, followers: numberOrNull(res.json.followers_count) };
}

async function readPages(token: string, path: string, params: Record<string, string>, maxPosts: number): Promise<{ ok: true; posts: IgPost[] } | { ok: false; message: string }> {
  const posts: IgPost[] = [];
  let after = "";
  while (posts.length < maxPosts) {
    const res = await graphGet(token, path, { ...params, limit: "50", ...(after ? { after } : {}) });
    if (!res.ok) return res;
    const data = (res.json.data as Row[] | undefined) ?? [];
    posts.push(...data.map(parseIgPost));
    after = afterCursor(res.json.paging);
    if (!after || data.length === 0) break;
  }
  return { ok: true, posts: posts.slice(0, maxPosts) };
}

async function readMedia(token: string, igUserId: string, maxPosts: number) {
  return readPages(token, `${igUserId}/media`, { fields: IG_MEDIA_FIELDS }, maxPosts);
}

async function readDiscovery(token: string, businessId: string, username: string, maxPosts: number): Promise<Awaited<ReturnType<IgRead["discovery"]>>> {
  if (!usernameOk(username)) return { ok: false, message: "The Instagram username is not valid." };
  const posts: IgPost[] = [];
  let after = "";
  let followers: number | null = null;
  while (posts.length < maxPosts) {
    const media = after ? `media.limit(50).after(${after}){${IG_MEDIA_FIELDS}}` : `media.limit(50){${IG_MEDIA_FIELDS}}`;
    const res = await graphGet(token, businessId, { fields: `business_discovery.username(${username}){followers_count,${media}}` });
    if (!res.ok) return res;
    const found = (res.json.business_discovery ?? {}) as Row & { media?: { data?: Row[]; paging?: { cursors?: Row } } };
    if (followers == null) followers = numberOrNull(found.followers_count);
    const data = found.media?.data ?? [];
    posts.push(...data.map(parseIgPost));
    after = afterCursor(found.media?.paging);
    if (!after || !/^[A-Za-z0-9+/=_-]+$/.test(after) || data.length === 0) break;
  }
  return { ok: true, followers, posts: posts.slice(0, maxPosts) };
}

async function readCopyright(token: string, mediaId: string): Promise<boolean | null> {
  const res = await graphGet(token, mediaId, { fields: "copyright_check_information" });
  if (!res.ok) return null;
  const info = res.json.copyright_check_information as { status?: { matches_found?: unknown } } | undefined;
  return typeof info?.status?.matches_found === "boolean" ? info.status.matches_found : null;
}

/** The file URL is read at import and never written down. */
export async function readOwnMediaUrl(db: ServiceRoleDb, userId: string, igMediaId: string): Promise<string> {
  const token = await loadToken(db, userId);
  const res = await graphGet(token, igMediaId, { fields: "media_url" });
  if (!res.ok) throw new Error(res.message);
  const url = text(res.json, "media_url");
  if (!url.startsWith("https://")) throw new Error("Instagram did not return a file.");
  return url;
}

async function loadToken(db: ServiceRoleDb, userId: string): Promise<string> {
  const res = await db.from("user_facebook_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (res.error) throw new IgDiscoveryError("no_token", "Connect Facebook in Account Setup.");
  const token = text(res.data as Row | null, "provider_token");
  if (token) return token;
  const env = process.env.META_ACCESS_TOKEN?.trim() ?? "";
  if (env) return env;
  throw new IgDiscoveryError("no_token", "Connect Facebook in Account Setup.");
}

async function defaultRead(db: ServiceRoleDb, userId: string): Promise<IgRead> {
  const token = await loadToken(db, userId);
  return {
    profile: (igUserId) => readProfile(token, igUserId),
    media: (igUserId, maxPosts) => readMedia(token, igUserId, maxPosts),
    discovery: (businessId, username, maxPosts) => readDiscovery(token, businessId, username, maxPosts),
    copyright: (mediaId) => readCopyright(token, mediaId),
    thumb: (url) => readThumbSize(url),
  };
}

async function writeArtist(db: ServiceRoleDb, artistId: string, userId: string, patch: Row): Promise<string | null> {
  const updated = await db.from("creative_lab_artists").update(patch).eq("id", artistId).eq("user_id", userId);
  return updated.error ? plainIgMessage(updated.error.message) : null;
}

async function storeThumbBytes(db: ServiceRoleDb, path: string, bytes: Uint8Array): Promise<void> {
  const storage = (db as unknown as { storage?: { from: (bucket: string) => { upload: (path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }) => Promise<{ error: { message: string } | null }> } } }).storage;
  if (!storage) return;
  const saved = await storage.from("creative-thumbnails").upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (saved.error) throw new Error(saved.error.message);
}

export async function findArtistClips(
  db: ServiceRoleDb,
  args: { artistId: string; now?: Date; read?: IgRead; storeThumb?: (path: string, bytes: Uint8Array) => Promise<void> },
): Promise<IgFindResult> {
  const now = args.now ?? new Date();
  const artistRes = await db.from("creative_lab_artists").select("*").eq("id", args.artistId).maybeSingle();
  if (artistRes.error) throw new Error(plainIgMessage(artistRes.error.message));
  const artist = artistRes.data as Row | null;
  if (!artist) throw new Error("No artist with that id.");
  const userId = text(artist, "user_id");

  const clientRes = await db.from("clients").select("*").eq("id", text(artist, "client_id")).maybeSingle();
  if (clientRes.error) throw new Error(plainIgMessage(clientRes.error.message));
  const businessId = text(clientRes.data as Row | null, "instagram_business_id");
  let read: IgRead;
  try {
    read = args.read ?? (await defaultRead(db, userId));
  } catch (err) {
    if (err instanceof IgDiscoveryError) {
      await writeArtist(db, args.artistId, userId, { ig_last_error: err.message });
    }
    throw err;
  }

  const actorId = text(artist, "instagram_actor_id");
  let username = text(artist, "ig_username");
  let followers: number | null = null;
  let posts: IgPost[] | null = null;
  let source: "own_edge" | "none" | null = null;
  let mediaError = "";

  if (actorId) {
    const profile = await read.profile(actorId);
    if (profile.ok) {
      username = profile.username || username;
      followers = profile.followers;
    }
    const media = await read.media(actorId, MAX_POSTS);
    if (media.ok) {
      posts = media.posts;
      source = "own_edge";
    } else {
      mediaError = media.message;
    }
  }

  if (!posts) {
    if (!username) {
      const message = mediaError || "Add this artist's Instagram account first.";
      await writeArtist(db, args.artistId, userId, { ig_last_error: message });
      if (!actorId) throw new IgDiscoveryError("no_instagram", message);
      return { candidates: [], error: message, source: null };
    }
    if (!businessId) {
      const message = "Add this client's Instagram business account.";
      await writeArtist(db, args.artistId, userId, { ig_last_error: message });
      return { candidates: [], error: message, source: null };
    }
    const found = await read.discovery(businessId, username, MAX_POSTS);
    if (!found.ok) {
      const message = plainIgMessage(found.message);
      await writeArtist(db, args.artistId, userId, { ig_last_error: message });
      return { candidates: [], error: message, source: null };
    }
    posts = found.posts;
    followers = found.followers;
    source = "none";
  }

  const clipRes = await db.from("creative_lab_clips").select("*").eq("artist_id", args.artistId);
  if (clipRes.error) throw new Error(plainIgMessage(clipRes.error.message));
  const heldRes = await db.from("creative_lab_ig_candidates").select("*").eq("artist_id", args.artistId);
  if (heldRes.error) {
    const message = /does not exist|schema cache/i.test(heldRes.error.message)
      ? "Instagram clips can't be listed until the database update is applied."
      : plainIgMessage(heldRes.error.message);
    await writeArtist(db, args.artistId, userId, { ig_last_error: message });
    return { candidates: [], error: message, source };
  }
  const exclude = new Set<string>();
  for (const clip of (clipRes.data ?? []) as Row[]) {
    const external = text(clip, "external_id");
    const sourceFile = text(clip, "source_file_id");
    if (external) exclude.add(external);
    if (sourceFile) exclude.add(sourceFile);
  }
  for (const row of (heldRes.data ?? []) as Row[]) {
    if (HELD.has(text(row, "status"))) {
      const id = text(row, "ig_media_id");
      if (id) exclude.add(id);
      if (Array.isArray(row.slide_ids)) {
        for (const slide of row.slide_ids) {
          const slideId = String(slide).trim();
          if (slideId) exclude.add(slideId);
        }
      }
    }
  }

  const thumbBytes = read.thumb ? await measureThumbs(posts, exclude, read.thumb) : new Map<string, Uint8Array>();
  const ranked = rankIgPosts(posts, { now, followers, exclude, limit: TOP_N });
  const thumbPaths = new Map<string, string>();
  const store = args.storeThumb ?? ((path: string, bytes: Uint8Array) => storeThumbBytes(db, path, bytes));
  for (const row of ranked) {
    const bytes = thumbBytes.get(row.igMediaId);
    if (!bytes) continue;
    const path = igThumbObjectPath(args.artistId, row.igMediaId);
    try {
      await store(path, bytes);
      thumbPaths.set(row.igMediaId, path);
    } catch {
      // The listing still saves. The next run stores the thumbnail.
    }
  }
  const candidates: IgCandidate[] = [];
  for (const row of ranked) {
    const audioMatch = source === "own_edge" ? await read.copyright(row.igMediaId) : null;
    candidates.push({
      ...row,
      followersAtFetch: followers,
      hasFile: source === "own_edge",
      fileSource: source === "own_edge" ? "own_edge" : "none",
      audioMatch,
      status: "candidate",
    });
  }

  if (candidates.length > 0) {
    const saved = await db.from("creative_lab_ig_candidates").upsert(
      candidates.map((row) => ({
        user_id: userId,
        artist_id: args.artistId,
        ig_media_id: row.igMediaId,
        slide_ids: row.slideIds,
        permalink: row.permalink,
        media_type: row.mediaType,
        media_product_type: row.mediaProductType,
        posted_at: row.postedAt,
        likes: row.likes,
        comments: row.comments,
        followers_at_fetch: row.followersAtFetch,
        score: row.score,
        aspect: row.aspect,
        thumb_width: row.thumbWidth,
        thumb_height: row.thumbHeight,
        has_file: row.hasFile,
        file_source: row.fileSource,
        audio_match: row.audioMatch,
        status: "candidate",
        reason: null,
        fetched_at: now.toISOString(),
        ...(thumbPaths.get(row.igMediaId) ? { thumbnail_path: thumbPaths.get(row.igMediaId) } : {}),
      })),
      { onConflict: "artist_id,ig_media_id" },
    );
    if (saved.error && /thumbnail_path/i.test(saved.error.message)) {
      const retry = await db.from("creative_lab_ig_candidates").upsert(
        candidates.map((row) => ({
          user_id: userId,
          artist_id: args.artistId,
          ig_media_id: row.igMediaId,
          slide_ids: row.slideIds,
          permalink: row.permalink,
          media_type: row.mediaType,
          media_product_type: row.mediaProductType,
          posted_at: row.postedAt,
          likes: row.likes,
          comments: row.comments,
          followers_at_fetch: row.followersAtFetch,
          score: row.score,
          aspect: row.aspect,
          thumb_width: row.thumbWidth,
          thumb_height: row.thumbHeight,
          has_file: row.hasFile,
          file_source: row.fileSource,
          audio_match: row.audioMatch,
          status: "candidate",
          reason: null,
          fetched_at: now.toISOString(),
        })),
        { onConflict: "artist_id,ig_media_id" },
      );
      if (!retry.error) {
        const patch: Row = { ig_synced_at: now.toISOString(), ig_last_error: null };
        if (username) patch.ig_username = username;
        const writeError = await writeArtist(db, args.artistId, userId, patch);
        if (writeError) return { candidates: [], error: writeError, source };
        return { candidates, error: null, source };
      }
    }
    if (saved.error) {
      const message = /does not exist|schema cache/i.test(saved.error.message)
        ? "Instagram clips can't be listed until the database update is applied."
        : plainIgMessage(saved.error.message);
      await writeArtist(db, args.artistId, userId, { ig_last_error: message });
      return { candidates: [], error: message, source };
    }
  }

  const patch: Row = { ig_synced_at: now.toISOString(), ig_last_error: null };
  if (username) patch.ig_username = username;
  const writeError = await writeArtist(db, args.artistId, userId, patch);
  if (writeError) return { candidates: [], error: writeError, source };
  return { candidates, error: null, source };
}

export async function requestArtistClip(
  db: ServiceRoleDb,
  args: { userId: string; artistId: string; igMediaId: string },
): Promise<void> {
  const artistRes = await db.from("creative_lab_artists").select("*").eq("id", args.artistId).eq("user_id", args.userId).maybeSingle();
  if (artistRes.error) throw new Error(plainIgMessage(artistRes.error.message));
  if (!artistRes.data) throw new Error("No artist with that id.");
  const mediaId = args.igMediaId.trim();
  if (!mediaId) throw new Error("No clip with that id.");
  const rows = await db.from("creative_lab_ig_candidates").select("*").eq("artist_id", args.artistId).eq("ig_media_id", mediaId);
  if (rows.error) throw new Error(plainIgMessage(rows.error.message));
  const row = ((rows.data ?? []) as Row[])[0];
  if (!row) throw new Error("No clip with that id.");
  if (text(row, "status") !== "candidate") throw new Error("This clip is already marked.");
  const updated = await db.from("creative_lab_ig_candidates").update({ status: "requested" }).eq("artist_id", args.artistId).eq("ig_media_id", mediaId);
  if (updated.error) throw new Error(plainIgMessage(updated.error.message));
}
