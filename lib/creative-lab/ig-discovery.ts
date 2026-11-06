/**
 * List an artist's best recent Instagram clips. Nothing is downloaded
 * and no clip row is written. media_url is never requested or stored.
 */

import type { ServiceRoleDb } from "./load.ts";

const WINDOW_DAYS = 365;
const HALF_LIFE_DAYS = 90;
const TOP_N = 8;
const MAX_POSTS = 150;

/** Own-edge and Business Discovery fields. media_url is deliberately absent. */
export const IG_MEDIA_FIELDS =
  "id,media_type,media_product_type,permalink,timestamp,like_count,comments_count,children{media_type,id}";

type Row = Record<string, unknown>;

export class IgDiscoveryError extends Error {
  readonly code: "not_cleared" | "no_instagram" | "no_token";
  constructor(code: "not_cleared" | "no_instagram" | "no_token", message: string) {
    super(message);
    this.name = "IgDiscoveryError";
    this.code = code;
  }
}

export type IgPost = {
  id: string;
  mediaType: string;
  mediaProductType: string | null;
  permalink: string | null;
  postedAt: string | null;
  likes: number | null;
  comments: number | null;
  children: { id: string; mediaType: string }[];
};

export type IgRead = {
  profile(igUserId: string): Promise<{ ok: true; username: string | null; followers: number | null } | { ok: false; message: string }>;
  media(igUserId: string, maxPosts: number): Promise<{ ok: true; posts: IgPost[] } | { ok: false; message: string }>;
  discovery(businessId: string, username: string, maxPosts: number): Promise<{ ok: true; followers: number | null; posts: IgPost[] } | { ok: false; message: string }>;
  copyright(mediaId: string): Promise<boolean | null>;
};

export type IgCandidate = {
  igMediaId: string;
  permalink: string | null;
  mediaType: string;
  mediaProductType: string | null;
  postedAt: string;
  likes: number | null;
  comments: number | null;
  followersAtFetch: number | null;
  score: number;
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

function ageDays(postedAt: string, now: Date): number {
  return (now.getTime() - Date.parse(postedAt)) / 86_400_000;
}

/** Video posts and carousel video slides, scored and capped. */
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
    const units = post.mediaType === "VIDEO"
      ? [{ id: post.id }]
      : post.mediaType === "CAROUSEL_ALBUM"
        ? post.children.filter((child) => child.mediaType === "VIDEO" && child.id).map((child) => ({ id: child.id }))
        : [];
    for (const unit of units) {
      if (args.exclude.has(unit.id) || seen.has(unit.id)) continue;
      seen.add(unit.id);
      ranked.push({
        igMediaId: unit.id,
        permalink: post.permalink,
        mediaType: "VIDEO",
        mediaProductType: post.mediaProductType,
        postedAt: new Date(Date.parse(post.postedAt)).toISOString(),
        likes: post.likes,
        comments: post.comments,
        score: igScore({ likes: post.likes, comments: post.comments, followers: args.followers, ageDays: age }),
      });
    }
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

export function parseIgPost(raw: Row): IgPost {
  const children = ((raw.children as { data?: Row[] } | undefined)?.data ?? []).map((child) => ({
    id: text(child, "id"),
    mediaType: text(child, "media_type"),
  }));
  return {
    id: text(raw, "id"),
    mediaType: text(raw, "media_type"),
    mediaProductType: text(raw, "media_product_type") || null,
    permalink: text(raw, "permalink") || null,
    postedAt: text(raw, "timestamp") || null,
    likes: numberOrNull(raw.like_count),
    comments: numberOrNull(raw.comments_count),
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
  };
}

async function writeArtist(db: ServiceRoleDb, artistId: string, userId: string, patch: Row): Promise<string | null> {
  const updated = await db.from("creative_lab_artists").update(patch).eq("id", artistId).eq("user_id", userId);
  return updated.error ? plainIgMessage(updated.error.message) : null;
}

export async function findArtistClips(
  db: ServiceRoleDb,
  args: { artistId: string; now?: Date; read?: IgRead },
): Promise<IgFindResult> {
  const now = args.now ?? new Date();
  const artistRes = await db.from("creative_lab_artists").select("*").eq("id", args.artistId).maybeSingle();
  if (artistRes.error) throw new Error(plainIgMessage(artistRes.error.message));
  const artist = artistRes.data as Row | null;
  if (!artist) throw new Error("No artist with that id.");
  const userId = text(artist, "user_id");
  if (!text(artist, "approved_at")) {
    const message = "Tick this artist as cleared before finding clips.";
    await writeArtist(db, args.artistId, userId, { ig_last_error: message });
    throw new IgDiscoveryError("not_cleared", message);
  }

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
    }
  }

  const ranked = rankIgPosts(posts, { now, followers, exclude, limit: TOP_N });
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
        permalink: row.permalink,
        media_type: row.mediaType,
        media_product_type: row.mediaProductType,
        posted_at: row.postedAt,
        likes: row.likes,
        comments: row.comments,
        followers_at_fetch: row.followersAtFetch,
        score: row.score,
        has_file: row.hasFile,
        file_source: row.fileSource,
        audio_match: row.audioMatch,
        status: "candidate",
        reason: null,
        fetched_at: now.toISOString(),
      })),
      { onConflict: "artist_id,ig_media_id" },
    );
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
