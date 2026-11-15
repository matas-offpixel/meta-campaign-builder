/**
 * lib/tiktok/thumbnail-cache.ts
 *
 * Durable TikTok creative thumbnails in the `creative-thumbnails` Storage
 * bucket (migration 068e), under `tiktok/`. TikTok's cover and image URLs
 * are signed (`x-expires` about six hours after the read), so the snapshot
 * column `tiktok_active_creatives_snapshots.thumbnail_url` goes dark within
 * a day. This module stores the bytes once and serves the public URL.
 *
 *   tiktok/video/{advertiser_id}/{video_id}.jpg
 *   tiktok/image/{advertiser_id}/{image_id}.jpg   ("/" in an image id → "__")
 *   tiktok/item/{advertiser_id}/{tiktok_item_id}.jpg
 *
 * Spark ads carry only tiktok_item_id. The cover is read two ways. First,
 * page GET /tt_video/list/ per identity (video_info.poster_url) until every
 * wanted item is found, the list ends, or the shared call cap is spent.
 * Item ids that list does not contain are then read with GET
 * /identity/video/info/ (Marketing API doc 1738958351620097), up to 20
 * item_ids a call. A video's cover is video_info.poster_url; a carousel's
 * is the first image_info.image_url. BC_AUTH_TT sends
 * identity_authorized_bc_id when /identity/get/ has it. An identity whose
 * list or info read is unauthorised, or whose Spark auth has ended, is
 * skipped once.
 *
 * Same contract as `lib/meta/video-thumbnail-cache.ts`:
 *   1. Storage first. A cached id costs no TikTok call.
 *   2. TikTok only on a genuine miss: `/file/video/ad/info/` (video
 *      `video_cover_url`) or `/file/image/ad/info/` (`image_url`), batched
 *      by advertiser, then the bytes are downloaded and uploaded. The signed
 *      URL is never stored as the durable value.
 *   3. In-process in-flight map: an id is claimed before any await, so two
 *      concurrent callers never both call TikTok for it.
 *
 * Writers: the snapshot cron and `scripts/backfill-tiktok-thumbnails.mts`.
 * Reader: `resolveSnapshotThumbnailUrls` (Storage list only, no TikTok call),
 * used by `readActiveTikTokCreativesSnapshot`.
 *
 * `ENABLE_TIKTOK_THUMBNAIL_FETCH` (default "1"): "0" makes no TikTok call
 * and downloads nothing; cache hits still serve.
 */

import {
  CREATIVE_THUMBNAIL_BUCKET,
  CREATIVE_THUMB_CACHE_SEC,
} from "../meta/creative-thumbnail-pure.ts";
import { tiktokGet } from "./client.ts";
import { fetchTikTokImageInfo, fetchTikTokVideoInfo } from "./creative.ts";
import {
  extractIdentityRows,
  IDENTITY_BC_ID_CANDIDATE_KEYS,
  type TikTokIdentityGetRow,
} from "./identity.ts";
import {
  fetchTikTokSparkPosts,
  isTikTokSparkAuthExpired,
  isTikTokSparkListDenied,
} from "./spark-posts.ts";

type TikTokGet = typeof tiktokGet;

export type TikTokThumbnailKind = "video" | "image" | "item";

export const TIKTOK_THUMB_PREFIX = "tiktok";
/** `/file/video/ad/info/` accepts at most 60 `video_ids`. */
export const TIKTOK_VIDEO_INFO_BATCH = 60;
/** `/file/image/ad/info/` accepts at most 100 `image_ids`. */
export const TIKTOK_IMAGE_INFO_BATCH = 100;
/** Info calls per run, across every advertiser. Spark list pages count too. */
export const TIKTOK_THUMB_MAX_CALLS_PER_RUN = 20;
/** `/tt_video/list/` page size. The helper clamps this to 50. */
export const TIKTOK_SPARK_PAGE_SIZE = 50;

const LIST_PAGE = 1000;
const LIST_MAX_PAGES = 20;

interface ThumbnailBucket {
  list(
    path: string,
    options?: { limit?: number; offset?: number },
  ): Promise<{
    data: Array<{ name: string }> | null;
    error: { message: string } | null;
  }>;
  upload(
    path: string,
    body: Buffer,
    options?: { contentType?: string; upsert?: boolean; cacheControl?: string },
  ): Promise<{ data: unknown; error: { message: string } | null }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
}

export interface TikTokThumbnailCacheClient {
  storage: { from(bucket: string): ThumbnailBucket };
}

export function isTikTokThumbnailFetchEnabled(): boolean {
  return process.env.ENABLE_TIKTOK_THUMBNAIL_FETCH !== "0";
}

/** Storage file stem for a TikTok id, or null when the id can't be keyed safely. */
export function tiktokThumbnailStem(id: string): string | null {
  const stem = id.trim().replace(/\//g, "__");
  if (!stem || stem.length > 200 || !/^[A-Za-z0-9_.-]+$/.test(stem)) return null;
  return stem;
}

function folder(kind: TikTokThumbnailKind, advertiserId: string): string {
  return `${TIKTOK_THUMB_PREFIX}/${kind}/${advertiserId}`;
}

export function tiktokThumbnailPath(
  kind: TikTokThumbnailKind,
  advertiserId: string,
  id: string,
): string | null {
  const stem = tiktokThumbnailStem(id);
  if (!stem || !/^[0-9]+$/.test(advertiserId)) return null;
  return `${folder(kind, advertiserId)}/${stem}.jpg`;
}

/** A signed TikTok URL that has not passed its `x-expires`; an unsigned URL as is. */
export function unexpiredTikTokSignedUrl(
  url: string | null | undefined,
  now: Date,
): string | null {
  if (!url) return null;
  const match = /[?&]x-expires=(\d+)/i.exec(url);
  if (match && Number(match[1]) * 1000 <= now.getTime()) return null;
  return url;
}

/** File stems already stored under one advertiser's `kind` folder. */
export async function listCachedTikTokThumbnailStems(
  admin: TikTokThumbnailCacheClient,
  kind: TikTokThumbnailKind,
  advertiserId: string,
): Promise<Set<string>> {
  const bucket = admin.storage.from(CREATIVE_THUMBNAIL_BUCKET);
  const stems = new Set<string>();
  for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
    const { data, error } = await bucket.list(folder(kind, advertiserId), {
      limit: LIST_PAGE,
      offset: page * LIST_PAGE,
    });
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const row of rows) {
      if (row.name.endsWith(".jpg")) stems.add(row.name.slice(0, -4));
    }
    if (rows.length < LIST_PAGE) break;
  }
  return stems;
}

export interface SnapshotThumbnailRow {
  video_id?: string | null;
  image_ids?: string[] | null;
  tiktok_item_id?: string | null;
  thumbnail_url: string | null;
}

/**
 * Display URL per row: the Storage object for its video, else for its first
 * stored image, else — for a row with neither — the `tiktok/item/` object.
 * An item-only row with no object is null. Any other row falls through to
 * the snapshot's signed URL while it is unexpired. Storage lists only;
 * never calls TikTok.
 */
export async function resolveSnapshotThumbnailUrls<T extends SnapshotThumbnailRow>(
  admin: TikTokThumbnailCacheClient,
  advertiserId: string | null,
  rows: readonly T[],
  now: Date,
): Promise<T[]> {
  const itemOnly = (row: T) => !row.video_id && !(row.image_ids?.length) && !!row.tiktok_item_id;
  let videos = new Set<string>();
  let images = new Set<string>();
  let items = new Set<string>();
  if (advertiserId) {
    try {
      const needVideo = rows.some((r) => r.video_id);
      const needImage = rows.some((r) => r.image_ids?.length);
      const needItem = rows.some(itemOnly);
      [videos, images, items] = await Promise.all([
        needVideo
          ? listCachedTikTokThumbnailStems(admin, "video", advertiserId)
          : Promise.resolve(new Set<string>()),
        needImage
          ? listCachedTikTokThumbnailStems(admin, "image", advertiserId)
          : Promise.resolve(new Set<string>()),
        needItem
          ? listCachedTikTokThumbnailStems(admin, "item", advertiserId)
          : Promise.resolve(new Set<string>()),
      ]);
    } catch (err) {
      console.warn(
        `[tiktok-thumbnail-cache] storage list failed advertiser=${advertiserId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  const durable = (kind: TikTokThumbnailKind, id: string, set: Set<string>) => {
    const stem = tiktokThumbnailStem(id);
    if (!advertiserId || !stem || !set.has(stem)) return null;
    const path = tiktokThumbnailPath(kind, advertiserId, id);
    return path
      ? admin.storage.from(CREATIVE_THUMBNAIL_BUCKET).getPublicUrl(path).data.publicUrl
      : null;
  };
  return rows.map((row) => {
    const fromVideo = row.video_id ? durable("video", row.video_id, videos) : null;
    const fromImage =
      fromVideo ??
      (row.image_ids ?? []).map((id) => durable("image", id, images)).find(Boolean) ??
      null;
    if (itemOnly(row)) {
      const fromItem = row.tiktok_item_id
        ? durable("item", row.tiktok_item_id, items)
        : null;
      return { ...row, thumbnail_url: fromItem };
    }
    return {
      ...row,
      thumbnail_url: fromImage ?? unexpiredTikTokSignedUrl(row.thumbnail_url, now),
    };
  });
}

export interface CacheTikTokThumbnailsInput {
  admin: TikTokThumbnailCacheClient;
  advertiserId: string;
  token: string;
  videoIds: readonly string[];
  imageIds: readonly string[];
  /** Info calls this invocation may make. Shared budgets pass a counter object. */
  budget?: { callsLeft: number };
  /** Read TikTok, download nothing, write nothing. */
  dryRun?: boolean;
  request?: TikTokGet;
  fetchImage?: typeof fetch;
}

export interface CacheTikTokThumbnailsResult {
  /** TikTok info calls made. */
  calls: number;
  /** Ids already in Storage. */
  cached: number;
  /** Ids stored this run (dry run: ids TikTok returned a source URL for). */
  stored: number;
  /** Ids still without an object: no source URL, a failed download, the cap, or the killswitch. */
  missing: number;
  /** `${kind}:${id}` → public Storage URL, for cached and stored ids. */
  urls: Map<string, string>;
  /** `${kind}:${id}` → what happened to it. */
  outcomes: Map<string, Outcome>;
}

export type TikTokThumbnailMissingReason =
  | "no_source"
  | "store_failed"
  | "call_cap"
  | "killswitch"
  | "spark_post_not_found"
  | "spark_auth_expired"
  | "spark_identity_missing";

export type Outcome = {
  kind: "cached" | "stored" | "missing";
  url: string | null;
  reason?: TikTokThumbnailMissingReason;
};

const missing = (reason: TikTokThumbnailMissingReason): Outcome => ({
  kind: "missing",
  url: null,
  reason,
});

const inFlight = new Map<string, Promise<Outcome>>();

function deferred(): {
  promise: Promise<Outcome>;
  resolve: (o: Outcome) => void;
} {
  let resolve!: (o: Outcome) => void;
  const promise = new Promise<Outcome>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function readSourceUrls(
  kind: TikTokThumbnailKind,
  input: CacheTikTokThumbnailsInput,
  ids: string[],
): Promise<Map<string, string>> {
  const request = input.request ?? tiktokGet;
  const out = new Map<string, string>();
  if (kind === "video") {
    const rows = await fetchTikTokVideoInfo({
      advertiserId: input.advertiserId,
      token: input.token,
      videoIds: ids,
      request,
    });
    for (const row of rows) if (row.thumbnail_url) out.set(row.video_id, row.thumbnail_url);
  } else {
    const rows = await fetchTikTokImageInfo({
      advertiserId: input.advertiserId,
      token: input.token,
      imageIds: ids,
      request,
    });
    for (const row of rows) out.set(row.image_id, row.image_url);
  }
  return out;
}

async function storeFromSource(
  input: { admin: TikTokThumbnailCacheClient; fetchImage?: typeof fetch },
  path: string,
  sourceUrl: string,
): Promise<string | null> {
  const bucket = input.admin.storage.from(CREATIVE_THUMBNAIL_BUCKET);
  try {
    const res = await (input.fetchImage ?? fetch)(sourceUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType =
      res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
    // `fetchTikTokVideoInfo` falls back to `preview_url`, which is a video.
    if (!contentType.startsWith("image/")) {
      throw new Error(`not an image (${contentType || "no content-type"})`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const { error } = await bucket.upload(path, buffer, {
      contentType,
      upsert: true,
      cacheControl: `${CREATIVE_THUMB_CACHE_SEC}`,
    });
    if (error) throw new Error(error.message);
    return bucket.getPublicUrl(path).data.publicUrl;
  } catch (err) {
    console.warn(
      `[tiktok-thumbnail-cache] store failed path=${path}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

async function resolveOwned(
  kind: TikTokThumbnailKind,
  input: CacheTikTokThumbnailsInput,
  owned: Map<string, (o: Outcome) => void>,
  budget: { callsLeft: number },
  counters: { calls: number },
): Promise<void> {
  if (owned.size === 0) return;
  const bucket = input.admin.storage.from(CREATIVE_THUMBNAIL_BUCKET);
  const pathOf = (id: string) => tiktokThumbnailPath(kind, input.advertiserId, id)!;

  let stems: Set<string>;
  try {
    stems = await listCachedTikTokThumbnailStems(input.admin, kind, input.advertiserId);
  } catch (err) {
    console.warn(
      `[tiktok-thumbnail-cache] storage list failed advertiser=${input.advertiserId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    stems = new Set();
  }

  const misses: string[] = [];
  for (const [id, resolve] of owned) {
    if (stems.has(tiktokThumbnailStem(id)!)) {
      resolve({ kind: "cached", url: bucket.getPublicUrl(pathOf(id)).data.publicUrl });
    } else {
      misses.push(id);
    }
  }

  if (!isTikTokThumbnailFetchEnabled()) {
    for (const id of misses) owned.get(id)!(missing("killswitch"));
    return;
  }

  const size = kind === "video" ? TIKTOK_VIDEO_INFO_BATCH : TIKTOK_IMAGE_INFO_BATCH;
  for (let i = 0; i < misses.length; i += size) {
    const chunk = misses.slice(i, i + size);
    if (budget.callsLeft <= 0) {
      for (const id of chunk) owned.get(id)!(missing("call_cap"));
      continue;
    }
    budget.callsLeft -= 1;
    counters.calls += 1;
    let sources = new Map<string, string>();
    try {
      sources = await readSourceUrls(kind, input, chunk);
    } catch (err) {
      console.warn(
        `[tiktok-thumbnail-cache] ${kind} info failed advertiser=${input.advertiserId} ids=${chunk.length}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    await Promise.all(
      chunk.map(async (id) => {
        const source = sources.get(id);
        if (!source) return owned.get(id)!(missing("no_source"));
        if (input.dryRun) return owned.get(id)!({ kind: "stored", url: null });
        const url = await storeFromSource(input, pathOf(id), source);
        owned.get(id)!(url ? { kind: "stored", url } : missing("store_failed"));
      }),
    );
  }
}

/**
 * Make sure every id has a Storage object, calling TikTok only for misses.
 * Never throws; a failure leaves the id missing.
 */
export async function cacheTikTokThumbnails(
  input: CacheTikTokThumbnailsInput,
): Promise<CacheTikTokThumbnailsResult> {
  const budget = input.budget ?? { callsLeft: TIKTOK_THUMB_MAX_CALLS_PER_RUN };
  const counters = { calls: 0 };
  const waits: Array<Promise<[TikTokThumbnailKind, string, Outcome]>> = [];
  const owned: Record<TikTokThumbnailKind, Map<string, (o: Outcome) => void>> = {
    video: new Map(),
    image: new Map(),
    item: new Map(),
  };
  const claimed: string[] = [];

  // Claim before any await so a concurrent caller reuses these promises.
  const claim = (kind: TikTokThumbnailKind, ids: readonly string[]) => {
    for (const id of new Set(ids)) {
      if (!tiktokThumbnailPath(kind, input.advertiserId, id)) continue;
      const key = `${kind}:${input.advertiserId}:${id}:${input.dryRun ? "dry" : "apply"}`;
      let promise = inFlight.get(key);
      if (!promise) {
        const d = deferred();
        inFlight.set(key, d.promise);
        claimed.push(key);
        owned[kind].set(id, d.resolve);
        promise = d.promise;
      }
      waits.push(promise.then((o) => [kind, id, o]));
    }
  };
  claim("video", input.videoIds);
  claim("image", input.imageIds);

  try {
    await Promise.all([
      resolveOwned("video", input, owned.video, budget, counters),
      resolveOwned("image", input, owned.image, budget, counters),
    ]);
  } finally {
    for (const map of Object.values(owned)) {
      for (const resolve of map.values()) resolve(missing("store_failed"));
    }
    for (const key of claimed) inFlight.delete(key);
  }

  const result: CacheTikTokThumbnailsResult = {
    calls: counters.calls,
    cached: 0,
    stored: 0,
    missing: 0,
    urls: new Map(),
    outcomes: new Map(),
  };
  for (const [kind, id, outcome] of await Promise.all(waits)) {
    result[outcome.kind] += 1;
    result.outcomes.set(`${kind}:${id}`, outcome);
    if (outcome.url) result.urls.set(`${kind}:${id}`, outcome.url);
  }
  return result;
}

export interface SparkThumbnailItem {
  itemId: string;
  identityId: string | null;
  identityType: string | null;
  identityBcId?: string | null;
}

export interface CacheTikTokSparkThumbnailsResult {
  /** TikTok calls made, including a Business Center id lookup. */
  calls: number;
  /** `/tt_video/list/` pages fetched. */
  pages: number;
  cached: number;
  stored: number;
  missing: number;
  /** Identities skipped because the list was denied or Spark auth had ended. */
  identitiesSkipped: number;
  outcomes: Map<string, Outcome>;
}

function identityBcId(row: TikTokIdentityGetRow): string | null {
  const record = row as Record<string, unknown>;
  for (const key of IDENTITY_BC_ID_CANDIDATE_KEYS) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return null;
}

async function lookupBcIds(
  input: CacheTikTokSparkInput,
  needed: readonly string[],
  budget: { callsLeft: number },
  counters: { calls: number },
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const request = input.request ?? tiktokGet;
  const ingest = (res: unknown) => {
    for (const row of extractIdentityRows(res)) {
      const id = row.identity_id?.trim();
      const bc = identityBcId(row);
      if (id && bc) found.set(id, bc);
    }
  };
  const stillNeeded = () => needed.some((id) => !found.has(id));
  const pull = async (identityType?: string) => {
    if (!stillNeeded() || budget.callsLeft <= 0) return;
    budget.callsLeft -= 1;
    counters.calls += 1;
    const params: Record<string, string> = { advertiser_id: input.advertiserId };
    if (identityType) params.identity_type = identityType;
    try {
      ingest(await request("/identity/get/", params, input.token));
    } catch (err) {
      console.warn(
        `[tiktok-thumbnail-cache] identity list failed advertiser=${input.advertiserId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };
  await pull();
  await pull("BC_AUTH_TT");
  return found;
}

interface CacheTikTokSparkInput {
  admin: TikTokThumbnailCacheClient;
  advertiserId: string;
  token: string;
  items: readonly SparkThumbnailItem[];
  budget?: { callsLeft: number };
  dryRun?: boolean;
  request?: TikTokGet;
  fetchImage?: typeof fetch;
  now?: Date;
}

/**
 * Store Spark covers at `tiktok/item/{advertiser}/{item}.jpg`.
 * Storage first. TikTok only for misses: page GET /tt_video/list/ per
 * identity, then GET /identity/video/info/ for item ids the list does not
 * contain. Both share the run's call cap. One in-flight promise per item.
 * Never throws.
 */
export async function cacheTikTokSparkItemThumbnails(
  input: CacheTikTokSparkInput,
): Promise<CacheTikTokSparkThumbnailsResult> {
  const budget = input.budget ?? { callsLeft: TIKTOK_THUMB_MAX_CALLS_PER_RUN };
  const counters = { calls: 0, pages: 0, identitiesSkipped: 0 };
  const waits: Array<Promise<[string, Outcome]>> = [];
  const owned = new Map<string, (o: Outcome) => void>();
  const claimed: string[] = [];
  const itemById = new Map<string, SparkThumbnailItem>();

  for (const item of input.items) {
    if (!item.itemId.trim() || !tiktokThumbnailPath("item", input.advertiserId, item.itemId)) continue;
    if (!itemById.has(item.itemId)) itemById.set(item.itemId, item);
  }
  for (const item of itemById.values()) {
    const key = `item:${input.advertiserId}:${item.itemId}:${input.dryRun ? "dry" : "apply"}`;
    let promise = inFlight.get(key);
    if (!promise) {
      const d = deferred();
      inFlight.set(key, d.promise);
      claimed.push(key);
      owned.set(item.itemId, d.resolve);
      promise = d.promise;
    }
    waits.push(promise.then((o) => [item.itemId, o]));
  }

  try {
    await resolveSparkItems(input, owned, itemById, budget, counters);
  } finally {
    for (const resolve of owned.values()) resolve(missing("store_failed"));
    for (const key of claimed) inFlight.delete(key);
  }

  const result: CacheTikTokSparkThumbnailsResult = {
    calls: counters.calls,
    pages: counters.pages,
    cached: 0,
    stored: 0,
    missing: 0,
    identitiesSkipped: counters.identitiesSkipped,
    outcomes: new Map(),
  };
  for (const [id, outcome] of await Promise.all(waits)) {
    result[outcome.kind] += 1;
    result.outcomes.set(`item:${id}`, outcome);
  }
  console.log(`[tiktok-thumbnail-cache] tiktok_spark_pages=${result.pages}`);
  return result;
}

async function resolveSparkItems(
  input: CacheTikTokSparkInput,
  owned: Map<string, (o: Outcome) => void>,
  itemById: Map<string, SparkThumbnailItem>,
  budget: { callsLeft: number },
  counters: { calls: number; pages: number; identitiesSkipped: number },
): Promise<void> {
  if (owned.size === 0) return;
  const bucket = input.admin.storage.from(CREATIVE_THUMBNAIL_BUCKET);
  const pathOf = (id: string) => tiktokThumbnailPath("item", input.advertiserId, id)!;
  let stems = new Set<string>();
  try {
    stems = await listCachedTikTokThumbnailStems(input.admin, "item", input.advertiserId);
  } catch (err) {
    console.warn(
      `[tiktok-thumbnail-cache] storage list failed advertiser=${input.advertiserId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const misses: SparkThumbnailItem[] = [];
  for (const [id, resolve] of owned) {
    if (stems.has(tiktokThumbnailStem(id)!)) {
      resolve({ kind: "cached", url: bucket.getPublicUrl(pathOf(id)).data.publicUrl });
    } else {
      const item = itemById.get(id);
      if (item) misses.push(item);
    }
  }
  if (!isTikTokThumbnailFetchEnabled()) {
    for (const item of misses) owned.get(item.itemId)!(missing("killswitch"));
    return;
  }

  const groups = new Map<string, { item: SparkThumbnailItem; ids: string[] }>();
  for (const item of misses) {
    if (!item.identityId || !item.identityType) {
      owned.get(item.itemId)!(missing("spark_identity_missing"));
      continue;
    }
    const key = `${item.identityType}\0${item.identityId}\0${item.identityBcId ?? ""}`;
    const group = groups.get(key) ?? { item, ids: [] };
    group.ids.push(item.itemId);
    groups.set(key, group);
  }

  const bcNeeded = [...groups.values()]
    .filter((group) => group.item.identityType === "BC_AUTH_TT" && !group.item.identityBcId)
    .map((group) => group.item.identityId!)
    .filter((id, index, all) => all.indexOf(id) === index);
  const bcIds = bcNeeded.length > 0 ? await lookupBcIds(input, bcNeeded, budget, counters) : new Map<string, string>();

  for (const group of groups.values()) {
    const bcId = group.item.identityBcId || bcIds.get(group.item.identityId!) || null;
    const left = await pageSparkIdentity(
      input,
      owned,
      group.ids,
      { ...group.item, identityBcId: bcId },
      budget,
      counters,
    );
    if (left.length > 0) {
      await fetchSparkItemInfo(input, owned, left, { ...group.item, identityBcId: bcId }, budget, counters);
    }
  }
}

async function pageSparkIdentity(
  input: CacheTikTokSparkInput,
  owned: Map<string, (o: Outcome) => void>,
  ids: readonly string[],
  identity: SparkThumbnailItem,
  budget: { callsLeft: number },
  counters: { calls: number; pages: number; identitiesSkipped: number },
): Promise<string[]> {
  const wanted = new Set(ids);
  const now = input.now ?? new Date();
  let page = 1;
  let totalPage = 1;
  const finish = (reason: TikTokThumbnailMissingReason) => {
    for (const id of wanted) owned.get(id)!(missing(reason));
    wanted.clear();
  };
  while (wanted.size > 0 && page <= totalPage) {
    if (budget.callsLeft <= 0) {
      finish("call_cap");
      return [];
    }
    budget.callsLeft -= 1;
    counters.calls += 1;
    counters.pages += 1;
    let listed;
    try {
      listed = await fetchTikTokSparkPosts({
        advertiserId: input.advertiserId,
        token: input.token,
        page,
        pageSize: TIKTOK_SPARK_PAGE_SIZE,
        identityId: identity.identityId,
        identityType: identity.identityType,
        identityBcId: identity.identityBcId,
        request: input.request,
        now,
      });
    } catch (err) {
      if (isTikTokSparkListDenied(err)) {
        counters.identitiesSkipped += 1;
        finish("spark_auth_expired");
        return [];
      }
      console.warn(
        `[tiktok-thumbnail-cache] spark list failed advertiser=${input.advertiserId} identity=${identity.identityId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [...wanted];
    }
    totalPage = listed.totalPage > 0 ? listed.totalPage : listed.posts.length > 0 ? page : page - 1;
    if (listed.posts.length === 0) break;
    if (listed.posts.every((post) => isTikTokSparkAuthExpired(post, now.getTime()))) {
      counters.identitiesSkipped += 1;
      finish("spark_auth_expired");
      return [];
    }
    for (const post of listed.posts) {
      if (!wanted.has(post.item_id)) continue;
      wanted.delete(post.item_id);
      await deliverSparkCover(
        input,
        owned,
        post.item_id,
        post.poster_url,
        isTikTokSparkAuthExpired(post, now.getTime()),
      );
    }
    if (wanted.size === 0) return [];
    page += 1;
  }
  return [...wanted];
}

const TIKTOK_SPARK_INFO_PATH = "/identity/video/info/";
const TIKTOK_SPARK_INFO_BATCH = 20;

interface IdentityVideoDetail {
  item_id?: string;
  auth_info?: { ad_auth_status?: string; auth_end_time?: string };
  video_info?: { poster_url?: string };
  carousel_info?: { image_info?: Array<{ image_url?: string }> };
}

function sparkDetailCover(detail: IdentityVideoDetail): string | null {
  const poster = detail.video_info?.poster_url?.trim();
  if (poster) return poster;
  for (const image of detail.carousel_info?.image_info ?? []) {
    const url = image.image_url?.trim();
    if (url) return url;
  }
  return null;
}

/**
 * By-item-id read for posts GET /tt_video/list/ did not contain.
 * Marketing API doc 1738958351620097. One call carries up to 20 item ids.
 * A denied identity is skipped for the rest of its items.
 */
async function fetchSparkItemInfo(
  input: CacheTikTokSparkInput,
  owned: Map<string, (o: Outcome) => void>,
  ids: readonly string[],
  identity: SparkThumbnailItem,
  budget: { callsLeft: number },
  counters: { calls: number; identitiesSkipped: number },
): Promise<void> {
  const request = input.request ?? tiktokGet;
  const now = input.now ?? new Date();
  const wanted = new Set(ids);
  const finish = (reason: TikTokThumbnailMissingReason) => {
    for (const id of wanted) owned.get(id)!(missing(reason));
    wanted.clear();
  };
  const pending = [...wanted];
  for (let index = 0; index < pending.length; index += TIKTOK_SPARK_INFO_BATCH) {
    if (wanted.size === 0) return;
    const chunk = pending.slice(index, index + TIKTOK_SPARK_INFO_BATCH).filter((id) => wanted.has(id));
    if (chunk.length === 0) continue;
    if (budget.callsLeft <= 0) {
      finish("call_cap");
      return;
    }
    budget.callsLeft -= 1;
    counters.calls += 1;
    const params: Record<string, string | string[]> = {
      advertiser_id: input.advertiserId,
      identity_type: identity.identityType ?? "",
      identity_id: identity.identityId ?? "",
      item_ids: chunk,
    };
    if (identity.identityBcId) params.identity_authorized_bc_id = identity.identityBcId;
    let details: IdentityVideoDetail[] = [];
    try {
      const res = await request<{ video_detail?: IdentityVideoDetail; video_details?: IdentityVideoDetail[] }>(
        TIKTOK_SPARK_INFO_PATH,
        params,
        input.token,
      );
      details = [...(res.video_details ?? [])];
      if (res.video_detail?.item_id) details.push(res.video_detail);
    } catch (err) {
      if (isTikTokSparkListDenied(err)) {
        counters.identitiesSkipped += 1;
        finish("spark_auth_expired");
        return;
      }
      console.warn(
        `[tiktok-thumbnail-cache] spark info failed advertiser=${input.advertiserId} identity=${identity.identityId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      for (const id of chunk) {
        wanted.delete(id);
        owned.get(id)!(missing("spark_post_not_found"));
      }
      continue;
    }
    const byId = new Map(details.filter((detail) => detail.item_id).map((detail) => [detail.item_id!, detail]));
    for (const id of chunk) {
      wanted.delete(id);
      const detail = byId.get(id);
      if (!detail) {
        owned.get(id)!(missing("spark_post_not_found"));
        continue;
      }
      const expired = isTikTokSparkAuthExpired(
        {
          ad_auth_status: detail.auth_info?.ad_auth_status ?? null,
          auth_end_time: detail.auth_info?.auth_end_time ?? null,
        },
        now.getTime(),
      );
      await deliverSparkCover(input, owned, id, sparkDetailCover(detail), expired);
    }
  }
}

async function deliverSparkCover(
  input: CacheTikTokSparkInput,
  owned: Map<string, (o: Outcome) => void>,
  id: string,
  cover: string | null,
  expired: boolean,
): Promise<void> {
  if (expired || !cover) {
    owned.get(id)!(missing(expired ? "spark_auth_expired" : "spark_post_not_found"));
    return;
  }
  if (input.dryRun) {
    owned.get(id)!({ kind: "stored", url: null });
    return;
  }
  const url = await storeFromSource(input, pathOfItem(input, id), cover);
  owned.get(id)!(url ? { kind: "stored", url } : missing("store_failed"));
}

function pathOfItem(input: CacheTikTokSparkInput, id: string): string {
  return tiktokThumbnailPath("item", input.advertiserId, id)!;
}

/**
 * Ids a set of snapshot rows needs cached: the video for a video ad, else
 * its image ids. A Spark ad with only `tiktok_item_id` is not in this
 * result; `cacheTikTokSparkItemThumbnails` reads it.
 */
export function thumbnailIdsForRows(
  rows: ReadonlyArray<{ video_id?: string | null; image_ids?: string[] | null }>,
): { videoIds: string[]; imageIds: string[] } {
  const videoIds = new Set<string>();
  const imageIds = new Set<string>();
  for (const row of rows) {
    if (row.video_id) videoIds.add(row.video_id);
    else for (const id of row.image_ids ?? []) imageIds.add(id);
  }
  return { videoIds: [...videoIds], imageIds: [...imageIds] };
}
